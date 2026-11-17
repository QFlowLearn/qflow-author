import { and, eq, lt, or } from 'drizzle-orm';
import { db } from '../db.ts';
import {
  authIdentities,
  authLoginAttempts,
  organizationMemberships,
  passwordResetTokens,
  tenants,
  userPasswords,
  users,
} from '../db/schema.ts';
import type { Role } from '../roles.ts';
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from './auth_crypto.ts';
import {
  clearPasswordLoginFailures,
  preparePasswordLoginAttempt,
  recordPasswordLoginFailure,
} from './auth_rate_limit.ts';
import { type AccountTenantResolution, resolveAccountTenant } from './account_tenant.ts';
import { isValidEmail, normalizeEmail } from './email_address.ts';

const AUTH_STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH =
  'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export type AuthResult =
  | { ok: true; userId: string; tenantId: string; mustChangePassword: boolean }
  | { ok: false; code: 'sso_required'; tenantId: string }
  | {
    ok: false;
    code:
      | 'invalid'
      | 'locked'
      | 'no_membership'
      | 'tenant_mismatch'
      | 'ambiguous_membership'
      | 'unknown';
  };

/** Deterministic account and tenant lookup used by authentication orchestration. */
export type TenantForEmailResult =
  | {
    readonly ok: true;
    readonly userId: string;
    readonly tenantId: string;
    readonly loginPolicy: 'allow_password' | 'prefer_sso' | 'require_sso';
  }
  | {
    readonly ok: false;
    readonly code:
      | 'account_not_found'
      | 'no_membership'
      | 'tenant_mismatch'
      | 'ambiguous_membership';
  };

export type CreateTenantUserResult =
  | { ok: true; userId: string; tempPassword: string }
  | { ok: false; code: 'invalid_email' | 'exists' | 'unknown' };

export async function resolveTenantForEmail(
  email: string,
  hostTenantId: string | null,
): Promise<TenantForEmailResult> {
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) return { ok: false, code: 'account_not_found' };
  const rows = await db.select({ userId: users.id })
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1);
  const account = rows[0];
  if (!account) return { ok: false, code: 'account_not_found' };

  const resolution = await resolveAccountTenant(db, {
    userId: account.userId,
    hostTenantId,
  });
  if (!resolution.ok) return resolution;
  return {
    ok: true,
    userId: account.userId,
    tenantId: resolution.value.tenantId,
    loginPolicy: resolution.value.loginPolicy,
  };
}

function generateTempPassword(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const pool = letters + digits;
  const chars = [randomChar(letters), randomChar(digits)];
  for (let i = 0; i < 16; i++) chars.push(randomChar(pool));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(randomNumber() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function randomChar(source: string): string {
  const idx = Math.floor(randomNumber() * source.length);
  return source[idx] ?? source[0];
}

function randomNumber(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x100000000;
}

export async function createTenantUser(input: {
  tenantId: string;
  email: string;
  role: Role;
  displayName?: string | null;
}): Promise<CreateTenantUserResult> {
  const email = String(input.email ?? '').trim();
  const emailNormalized = normalizeEmail(email);
  if (!isValidEmail(emailNormalized)) return { ok: false, code: 'invalid_email' };

  const existing = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1);
  if (existing.length) return { ok: false, code: 'exists' };

  const userId = crypto.randomUUID();
  const displayName = input.displayName?.trim() || null;
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        email,
        emailNormalized,
        displayName,
        mustChangePassword: true,
        authProvider: 'local',
        authProviderId: emailNormalized,
      });
      await tx.insert(userPasswords).values({
        userId,
        passwordHash,
      });
      await tx.insert(authIdentities).values({
        id: crypto.randomUUID(),
        userId,
        provider: 'local',
        providerId: emailNormalized,
        email,
      });
      await tx.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId: input.tenantId,
        userId,
        role: input.role,
      });
    });
    return { ok: true, userId, tempPassword };
  } catch (_err) {
    return { ok: false, code: 'unknown' };
  }
}

export async function ensureTenantForUser(userId: string, name?: string): Promise<string> {
  const tenantId = crypto.randomUUID();
  const tenantName = name?.trim() || 'Workspace';
  const slug = `t-${tenantId.slice(0, 8)}`;

  await db.transaction(async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      slug,
      name: tenantName,
    });
    await tx.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });
  });

  return tenantId;
}

export async function authenticateWithPassword(input: {
  email: string;
  password: string;
  attemptOrigin: string;
  hostTenantId: string | null;
}): Promise<AuthResult> {
  const emailNormalized = normalizeEmail(input.email);
  const loginAttempt = await preparePasswordLoginAttempt({
    emailNormalized,
    attemptOrigin: input.attemptOrigin,
  });
  if (!loginAttempt.allowed) {
    return { ok: false, code: 'locked' };
  }

  if (passwordExceedsHashInputLimit(input.password)) {
    await recordPasswordLoginFailure(loginAttempt.attempt);
    return { ok: false, code: 'invalid' };
  }

  const userRows = await db.select({
    id: users.id,
    mustChangePassword: users.mustChangePassword,
    passwordHash: userPasswords.passwordHash,
  })
    .from(users)
    .leftJoin(userPasswords, eq(userPasswords.userId, users.id))
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1);
  const account = userRows[0];
  const currentPasswordHash = account?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordMatches = await verifyPassword(input.password, currentPasswordHash);
  if (!account || !account.passwordHash || !passwordMatches) {
    await recordPasswordLoginFailure(loginAttempt.attempt);
    return { ok: false, code: 'invalid' };
  }
  const userId = account.id;
  const mustChangePassword = account.mustChangePassword ?? false;
  const tenant = await resolveAccountTenant(db, {
    userId,
    hostTenantId: input.hostTenantId,
  });
  if (!tenant.ok) return tenant;
  if (tenant.value.loginPolicy === 'require_sso') {
    return { ok: false, code: 'sso_required', tenantId: tenant.value.tenantId };
  }
  await clearPasswordLoginFailures(loginAttempt.attempt);
  if (passwordHashNeedsUpgrade(currentPasswordHash)) {
    const passwordHash = await hashPassword(input.password);
    await db.update(userPasswords).set({ passwordHash, updatedAt: new Date() }).where(and(
      eq(userPasswords.userId, userId),
      eq(userPasswords.passwordHash, currentPasswordHash),
    ));
  }
  return { ok: true, userId, tenantId: tenant.value.tenantId, mustChangePassword };
}

/** Resolve a user's tenant without relying on membership row order. */
export function resolveTenantForUser(
  userId: string,
  hostTenantId: string | null,
): Promise<AccountTenantResolution> {
  return resolveAccountTenant(db, { userId, hostTenantId });
}

function passwordExceedsHashInputLimit(password: string): boolean {
  let codePoints = 0;
  for (const _codePoint of password) {
    codePoints += 1;
    if (codePoints > PASSWORD_MAX_LENGTH) return true;
  }
  return false;
}

/** Remove expired reset secrets and stale login-attempt state. */
export async function pruneAuthState(now = new Date()): Promise<void> {
  const retentionCutoff = new Date(now.getTime() - AUTH_STATE_RETENTION_MS);
  await db.transaction(async (tx) => {
    await tx.delete(passwordResetTokens).where(or(
      lt(passwordResetTokens.expiresAt, retentionCutoff),
      lt(passwordResetTokens.consumedAt, retentionCutoff),
    ));
    await tx.delete(authLoginAttempts).where(
      lt(authLoginAttempts.lastAttemptAt, retentionCutoff),
    );
  });
}

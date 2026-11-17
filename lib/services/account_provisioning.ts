import { db, type QflowDatabaseTransaction } from '../db.ts';
import {
  authIdentities,
  organizationMemberships,
  tenants,
  userPasswords,
  users,
  userSettingsTable,
} from '../db/schema.ts';
import type { Role } from '../roles.ts';
import { hashPassword, passwordIssues } from './auth_crypto.ts';
import { normalizeEmail } from './email_address.ts';
import { createInitialUserSettings } from '../settings.ts';
import type { InterfaceLocale } from '../i18n/locale.ts';

/** Result of provisioning a local user without a workspace. */
export type ProvisionLocalUserResult =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly code: 'email_exists' }
  | {
    readonly ok: false;
    readonly code: 'invalid_password';
    readonly issues: ReadonlyArray<string>;
  };

/** Result of atomically provisioning a local user and workspace membership. */
export type ProvisionLocalUserWithWorkspaceResult =
  | { readonly ok: true; readonly userId: string; readonly tenantId: string }
  | { readonly ok: false; readonly code: 'email_exists' }
  | {
    readonly ok: false;
    readonly code: 'invalid_password';
    readonly issues: ReadonlyArray<string>;
  };

type LocalUserInput = {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string | null;
  readonly interfaceLocale: InterfaceLocale;
};

type WorkspaceInput = {
  readonly name: string;
  readonly role: Role;
};

/** Provision a local credential, optionally attaching its first workspace in the same transaction. */
export function provisionLocalUser(
  input: LocalUserInput & { readonly workspace: WorkspaceInput },
): Promise<ProvisionLocalUserWithWorkspaceResult>;
/** Provision a local credential without creating a workspace. */
export function provisionLocalUser(
  input: LocalUserInput & { readonly workspace?: undefined },
): Promise<ProvisionLocalUserResult>;
export async function provisionLocalUser(
  input: LocalUserInput & { readonly workspace?: WorkspaceInput },
): Promise<ProvisionLocalUserResult | ProvisionLocalUserWithWorkspaceResult> {
  const issues = passwordIssues(input.password);
  if (issues.length) return { ok: false, code: 'invalid_password', issues };

  const email = input.email.trim();
  const emailNormalized = normalizeEmail(email);
  const displayName = input.displayName?.trim() || null;
  const passwordHash = await hashPassword(input.password);
  const userId = crypto.randomUUID();
  const tenantId = input.workspace ? crypto.randomUUID() : null;

  try {
    await db.transaction(async (tx) => {
      await insertLocalUser(tx, {
        userId,
        email,
        emailNormalized,
        displayName,
        passwordHash,
        interfaceLocale: input.interfaceLocale,
      });
      if (input.workspace && tenantId) {
        await attachWorkspace(tx, {
          tenantId,
          userId,
          name: input.workspace.name,
          role: input.workspace.role,
        });
      }
    });
  } catch (cause: unknown) {
    if (isUniqueViolation(cause)) return { ok: false, code: 'email_exists' };
    throw cause;
  }

  return tenantId ? { ok: true, userId, tenantId } : { ok: true, userId };
}

async function insertLocalUser(
  tx: QflowDatabaseTransaction,
  input: {
    readonly userId: string;
    readonly email: string;
    readonly emailNormalized: string;
    readonly displayName: string | null;
    readonly passwordHash: string;
    readonly interfaceLocale: InterfaceLocale;
  },
): Promise<void> {
  await tx.insert(users).values({
    id: input.userId,
    email: input.email,
    emailNormalized: input.emailNormalized,
    displayName: input.displayName,
    mustChangePassword: false,
    authProvider: 'local',
    authProviderId: input.emailNormalized,
  });
  await tx.insert(userPasswords).values({ userId: input.userId, passwordHash: input.passwordHash });
  await tx.insert(userSettingsTable).values({
    userId: input.userId,
    settings: createInitialUserSettings(input.interfaceLocale),
  });
  await tx.insert(authIdentities).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    provider: 'local',
    providerId: input.emailNormalized,
    email: input.email,
  });
}

async function attachWorkspace(
  tx: QflowDatabaseTransaction,
  input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly name: string;
    readonly role: Role;
  },
): Promise<void> {
  const name = input.name.trim() || 'Workspace';
  await tx.insert(tenants).values({
    id: input.tenantId,
    slug: `t-${input.tenantId.slice(0, 8)}`,
    name,
  });
  await tx.insert(organizationMemberships).values({
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    userId: input.userId,
    role: input.role,
  });
}

function isUniqueViolation(cause: unknown): boolean {
  let current: unknown = cause;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    if (Reflect.get(current, 'code') === '23505') return true;
    current = Reflect.get(current, 'cause');
  }
  return false;
}

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db.ts';
import { authIdentities, organizationMemberships, users, userSettingsTable } from '../db/schema.ts';
import type { QflowDatabaseTransaction } from '../db.ts';
import type { OidcEmailClaim } from '../oidc_protocol.ts';
import type { OidcProviderId } from '../oidc_provider.ts';
import type { Role } from '../roles.ts';
import { normalizeEmail } from './email_address.ts';
import type { InterfaceLocale } from '../i18n/locale.ts';
import { createInitialUserSettings } from '../settings.ts';

type IdentityStoreOperation =
  | 'find_identity'
  | 'find_email_owner'
  | 'create_identity'
  | 'resolve_membership';

/** Typed outcome of resolving one provider-asserted external identity. */
export type ExternalIdentityLinkResult =
  | {
    readonly _tag: 'Resolved';
    readonly userId: string;
  }
  | {
    readonly _tag: 'Rejected';
    readonly reason:
      | 'email_required'
      | 'tenant_mismatch'
      | 'identity_conflict';
  }
  | {
    readonly _tag: 'StoreUnavailable';
    readonly operation: IdentityStoreOperation;
    readonly cause: unknown;
  };

/** Resolve an exact provider subject or create a new account without email-based linking. */
export async function linkExternalIdentity(input: {
  readonly tenantId: string | null;
  readonly provider: OidcProviderId;
  readonly providerId: string;
  readonly email: OidcEmailClaim | null;
  readonly displayName: string | null;
  readonly role?: Role;
  readonly interfaceLocale: InterfaceLocale;
}): Promise<ExternalIdentityLinkResult> {
  const tenantId = input.tenantId?.trim() || null;
  const provider = input.provider;
  const providerId = input.providerId.trim();
  if (!providerId) return { _tag: 'Rejected', reason: 'identity_conflict' };

  let existingIdentity: { readonly userId: string }[];
  try {
    existingIdentity = await findIdentity(provider, providerId);
  } catch (cause: unknown) {
    return { _tag: 'StoreUnavailable', operation: 'find_identity', cause };
  }
  if (existingIdentity.length) {
    return await resolveIdentityMembership(existingIdentity[0].userId, tenantId, input.role);
  }

  const emailClaim = input.email;
  if (!emailClaim) return { _tag: 'Rejected', reason: 'email_required' };
  const email = emailClaim.address;
  const emailNormalized = normalizeEmail(email);

  let userRows: { readonly id: string }[];
  try {
    userRows = await findEmailOwner(emailNormalized);
  } catch (cause: unknown) {
    return { _tag: 'StoreUnavailable', operation: 'find_email_owner', cause };
  }

  if (userRows.length) {
    return await resolveEmailCollision(provider, providerId, tenantId, input.role);
  }

  const userId = crypto.randomUUID();
  const displayName = input.displayName?.trim() || String(email);
  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        email,
        emailNormalized,
        emailVerifiedAt: emailClaim._tag === 'Verified' ? sql`now()` : null,
        displayName,
        authProvider: provider,
        authProviderId: providerId,
      });
      await tx.insert(authIdentities).values({
        id: crypto.randomUUID(),
        userId,
        provider,
        providerId,
        email,
      });
      if (tenantId) {
        await tx.insert(organizationMemberships).values({
          id: crypto.randomUUID(),
          tenantId,
          userId,
          role: input.role ?? 'instructor',
        });
      }
      await tx.insert(userSettingsTable).values({
        userId,
        settings: createInitialUserSettings(input.interfaceLocale),
      });
    });
    return { _tag: 'Resolved', userId };
  } catch (cause: unknown) {
    return await resolveCreateConflict({
      provider,
      providerId,
      emailNormalized,
      tenantId,
      role: input.role,
      cause,
    });
  }
}

async function findIdentity(provider: OidcProviderId, providerId: string) {
  return await db.select({ userId: authIdentities.userId })
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, provider), eq(authIdentities.providerId, providerId)))
    .limit(1);
}

async function findEmailOwner(emailNormalized: string) {
  return await db.select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1);
}

async function resolveEmailCollision(
  provider: OidcProviderId,
  providerId: string,
  tenantId: string | null,
  role: Role | undefined,
): Promise<ExternalIdentityLinkResult> {
  let identity: { readonly userId: string }[];
  try {
    identity = await findIdentity(provider, providerId);
  } catch (cause: unknown) {
    return { _tag: 'StoreUnavailable', operation: 'find_identity', cause };
  }
  return identity.length
    ? await resolveIdentityMembership(identity[0].userId, tenantId, role)
    : { _tag: 'Rejected', reason: 'identity_conflict' };
}

async function resolveCreateConflict(input: {
  readonly provider: OidcProviderId;
  readonly providerId: string;
  readonly emailNormalized: string;
  readonly tenantId: string | null;
  readonly role: Role | undefined;
  readonly cause: unknown;
}): Promise<ExternalIdentityLinkResult> {
  let retry: { readonly userId: string }[];
  try {
    retry = await findIdentity(input.provider, input.providerId);
  } catch (cause: unknown) {
    return { _tag: 'StoreUnavailable', operation: 'find_identity', cause };
  }
  if (retry.length) {
    return await resolveIdentityMembership(retry[0].userId, input.tenantId, input.role);
  }

  try {
    if ((await findEmailOwner(input.emailNormalized)).length) {
      return { _tag: 'Rejected', reason: 'identity_conflict' };
    }
  } catch (cause: unknown) {
    return { _tag: 'StoreUnavailable', operation: 'find_email_owner', cause };
  }

  return { _tag: 'StoreUnavailable', operation: 'create_identity', cause: input.cause };
}

async function resolveIdentityMembership(
  userId: string,
  tenantId: string | null,
  role: Role | undefined,
): Promise<ExternalIdentityLinkResult> {
  if (!tenantId) return { _tag: 'Resolved', userId };

  try {
    const membershipAccepted = await db.transaction(async (tx) =>
      await ensureMembership(tx, userId, tenantId, role)
    );
    return membershipAccepted
      ? { _tag: 'Resolved', userId }
      : { _tag: 'Rejected', reason: 'tenant_mismatch' };
  } catch (cause: unknown) {
    return { _tag: 'StoreUnavailable', operation: 'resolve_membership', cause };
  }
}

async function ensureMembership(
  tx: QflowDatabaseTransaction,
  userId: string,
  tenantId: string,
  role: Role | undefined,
): Promise<boolean> {
  const lockedUser = await tx.select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
    .limit(1);
  if (!lockedUser.length) return false;

  const rows = await tx.select({ tenantId: organizationMemberships.tenantId })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.userId, userId));
  if (rows.some((membership) => membership.tenantId === tenantId)) return true;
  if (rows.length) return false;

  await tx.insert(organizationMemberships).values({
    id: crypto.randomUUID(),
    tenantId,
    userId,
    role: role ?? 'instructor',
  });
  return true;
}

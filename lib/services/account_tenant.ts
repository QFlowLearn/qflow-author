import { asc, eq } from 'drizzle-orm';
import type { DbReadConnection } from '../db.ts';
import { organizationMemberships, tenants } from '../db/schema.ts';
import { type SsoLoginPolicy, ssoLoginPolicyFromPersistence } from '../sso_policy.ts';

/** A tenant selected by the account-membership policy. */
export type ResolvedAccountTenant = {
  readonly tenantId: string;
  readonly loginPolicy: SsoLoginPolicy;
};

/** Deterministic result of selecting a tenant for one user account. */
export type AccountTenantResolution =
  | { readonly ok: true; readonly value: ResolvedAccountTenant }
  | {
    readonly ok: false;
    readonly code: 'no_membership' | 'tenant_mismatch' | 'ambiguous_membership';
  };

/**
 * Select one account tenant using explicit precedence.
 *
 * A tenant-scoped host must match a membership. On an unscoped host, exactly one membership is
 * required. Multiple memberships never fall through to database row order.
 */
export async function resolveAccountTenant(
  connection: DbReadConnection,
  input: {
    readonly userId: string;
    readonly hostTenantId: string | null;
  },
): Promise<AccountTenantResolution> {
  const rows = await connection.select({
    tenantId: organizationMemberships.tenantId,
    loginPolicy: tenants.loginPolicy,
  })
    .from(organizationMemberships)
    .innerJoin(tenants, eq(tenants.id, organizationMemberships.tenantId))
    .where(eq(organizationMemberships.userId, input.userId))
    .orderBy(asc(organizationMemberships.tenantId));

  if (input.hostTenantId) {
    const hostMembership = rows.find((row) => row.tenantId === input.hostTenantId);
    if (hostMembership) {
      return {
        ok: true,
        value: {
          tenantId: hostMembership.tenantId,
          loginPolicy: ssoLoginPolicyFromPersistence(hostMembership.loginPolicy),
        },
      };
    }
    return { ok: false, code: rows.length ? 'tenant_mismatch' : 'no_membership' };
  }

  if (!rows.length) return { ok: false, code: 'no_membership' };
  if (rows.length !== 1) return { ok: false, code: 'ambiguous_membership' };

  const membership = rows[0];
  return {
    ok: true,
    value: {
      tenantId: membership.tenantId,
      loginPolicy: ssoLoginPolicyFromPersistence(membership.loginPolicy),
    },
  };
}

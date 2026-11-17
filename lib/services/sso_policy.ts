import { and, asc, eq } from 'drizzle-orm';
import { db, type DbReadConnection, type QflowDatabaseTransaction } from '../db.ts';
import { ssoDomainRoutes, ssoDomainVerifications, tenants } from '../db/schema.ts';
import { parseSsoDomain, ssoDomainFromEmail } from '../sso_domain.ts';
import {
  parseSsoRouteProvider,
  type SsoDomainRoute,
  type SsoLoginPolicy,
  ssoLoginPolicyFromPersistence,
  type SsoRouteProvider,
} from '../sso_policy.ts';
import { isTenantDomainVerified } from './domain_verification.ts';
import { getOidcTenantConfig } from './oidc_tenant_configs.ts';
import { findRequiredSsoProviderReadinessIssue } from './required_sso_provider_readiness.ts';

/** Persisted tenant SSO policy and canonical domain routes. */
export type TenantSsoSettings = {
  readonly loginPolicy: SsoLoginPolicy;
  readonly domainRoutes: readonly SsoDomainRoute[];
};

/** Parsed update accepted by the tenant SSO settings service. */
export type TenantSsoSettingsInput = {
  readonly loginPolicy?: SsoLoginPolicy;
  readonly domainRoutes?: readonly SsoDomainRoute[];
};

/** A user-correctable tenant SSO policy rejection. */
export class SsoPolicyInputError extends Error {
  readonly _tag = 'SsoPolicyInputError' as const;
}

export async function getTenantSsoSettings(tenantId: string): Promise<TenantSsoSettings> {
  const tenantRows = await db.select({ loginPolicy: tenants.loginPolicy })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const loginPolicy = ssoLoginPolicyFromPersistence(tenantRows[0]?.loginPolicy);
  const domainRoutes = await listTenantSsoDomainRoutes(tenantId);
  return { loginPolicy, domainRoutes };
}

async function listTenantSsoDomainRoutes(
  tenantId: string,
  database: DbReadConnection = db,
): Promise<SsoDomainRoute[]> {
  const rows = await database.select({
    domain: ssoDomainRoutes.domain,
    provider: ssoDomainRoutes.provider,
  }).from(ssoDomainRoutes)
    .where(eq(ssoDomainRoutes.tenantId, tenantId))
    .orderBy(asc(ssoDomainRoutes.domain));

  const routes: SsoDomainRoute[] = [];
  for (const row of rows) {
    const provider = parseSsoRouteProvider(row.provider);
    const domain = parseSsoDomain(row.domain);
    if (!provider || !domain) throw new Error('Persisted SSO domain route is invalid.');
    routes.push({ domain, provider });
  }
  return routes;
}

export async function upsertTenantSsoSettings(
  tenantId: string,
  input: TenantSsoSettingsInput,
): Promise<TenantSsoSettings> {
  await db.transaction(async (tx) => {
    const tenantRows = await tx.select({ loginPolicy: tenants.loginPolicy })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .for('update')
      .limit(1);
    const currentRoutes = await listTenantSsoDomainRoutes(tenantId, tx);
    const nextPolicy = input.loginPolicy ??
      ssoLoginPolicyFromPersistence(tenantRows[0]?.loginPolicy);
    const nextRoutes = input.domainRoutes ?? currentRoutes;

    const errors = validateTenantSsoSettings({ loginPolicy: nextPolicy, domainRoutes: nextRoutes });
    if (errors.length) throw new SsoPolicyInputError(errors[0]);
    if (nextPolicy === 'require_sso') {
      await assertDomainRoutesVerified(tx, tenantId, nextRoutes);
    }

    const now = new Date();
    await tx.update(tenants).set({ loginPolicy: nextPolicy }).where(eq(tenants.id, tenantId));

    if (input.domainRoutes !== undefined) {
      await tx.delete(ssoDomainRoutes).where(eq(ssoDomainRoutes.tenantId, tenantId));
      if (nextRoutes.length) {
        await tx.insert(ssoDomainRoutes).values(nextRoutes.map((route) => ({
          id: crypto.randomUUID(),
          tenantId,
          domain: route.domain,
          provider: route.provider,
          createdAt: now,
          updatedAt: now,
        })));
      }
    }

    const readinessIssue = await findRequiredSsoProviderReadinessIssue(tx, tenantId);
    if (readinessIssue) throw new SsoPolicyInputError(readinessIssue);
  });

  return getTenantSsoSettings(tenantId);
}

async function assertDomainRoutesVerified(
  tx: QflowDatabaseTransaction,
  tenantId: string,
  routes: readonly SsoDomainRoute[],
): Promise<void> {
  if (routes.length === 0) {
    throw new SsoPolicyInputError(
      'Require SSO policy needs at least one verified domain route.',
    );
  }
  const rows = await tx.select({
    domain: ssoDomainVerifications.domain,
    verifiedAt: ssoDomainVerifications.verifiedAt,
  }).from(ssoDomainVerifications).where(eq(ssoDomainVerifications.tenantId, tenantId));
  const verifiedDomains = new Set(
    rows.flatMap((row) => row.verifiedAt ? [row.domain] : []),
  );
  for (const route of routes) {
    if (!verifiedDomains.has(route.domain)) {
      throw new SsoPolicyInputError(
        `Domain must be verified before enabling require_sso: ${route.domain}`,
      );
    }
  }
}

export async function resolveSsoProviderForEmail(
  tenantId: string,
  email: string,
): Promise<SsoRouteProvider | null> {
  const domain = ssoDomainFromEmail(email);
  if (!domain) return null;

  const verified = await isTenantDomainVerified(tenantId, domain);
  if (!verified) return null;

  const rows = await db.select({
    provider: ssoDomainRoutes.provider,
  }).from(ssoDomainRoutes)
    .where(and(eq(ssoDomainRoutes.tenantId, tenantId), eq(ssoDomainRoutes.domain, domain)))
    .limit(1);
  if (!rows.length) return null;

  const provider = parseSsoRouteProvider(rows[0].provider);
  if (!provider) return null;

  const enabled = await isProviderEnabledForTenant(tenantId, provider);
  if (!enabled) return null;
  return provider;
}

function validateTenantSsoSettings(input: TenantSsoSettings): string[] {
  const errors: string[] = [];
  if (input.domainRoutes.length > 100) {
    errors.push('Too many domain routes (max 100).');
  }

  const seen = new Set<string>();
  for (const route of input.domainRoutes) {
    if (seen.has(route.domain)) {
      errors.push(`Duplicate domain route: ${route.domain}`);
      break;
    }
    seen.add(route.domain);
  }
  return errors;
}

async function isProviderEnabledForTenant(
  tenantId: string,
  provider: SsoRouteProvider,
): Promise<boolean> {
  const config = await getOidcTenantConfig(tenantId, provider);
  if (!config?.enabled) return false;
  return Boolean(
    String(config.clientId ?? '').trim() &&
      config.clientSecretConfigured,
  );
}

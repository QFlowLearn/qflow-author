import { asc, eq } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { oidcTenantConfigs, ssoDomainRoutes, tenants } from '../db/schema.ts';
import { oidcProviderLabel, parseOidcProviderId } from '../oidc_provider.ts';
import { ssoLoginPolicyFromPersistence } from '../sso_policy.ts';

/** Returns the first provider-readiness violation for a tenant that requires SSO. */
export async function findRequiredSsoProviderReadinessIssue(
  tx: QflowDatabaseTransaction,
  tenantId: string,
): Promise<string | null> {
  const tenantRows = await tx.select({ loginPolicy: tenants.loginPolicy })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (ssoLoginPolicyFromPersistence(tenantRows[0]?.loginPolicy) !== 'require_sso') return null;

  const routes = await tx.select({ provider: ssoDomainRoutes.provider })
    .from(ssoDomainRoutes)
    .where(eq(ssoDomainRoutes.tenantId, tenantId))
    .orderBy(asc(ssoDomainRoutes.domain));
  if (routes.length === 0) {
    return 'Require SSO policy needs at least one verified domain route.';
  }

  const configs = await tx.select({
    provider: oidcTenantConfigs.provider,
    enabled: oidcTenantConfigs.enabled,
    clientId: oidcTenantConfigs.clientId,
    encryptedClientSecret: oidcTenantConfigs.encryptedClientSecret,
  }).from(oidcTenantConfigs).where(eq(oidcTenantConfigs.tenantId, tenantId));
  const configuredProviders = new Set(
    configs.flatMap((config) => {
      const provider = parseOidcProviderId(config.provider);
      return provider && config.enabled && config.clientId?.trim() && config.encryptedClientSecret
        ? [provider]
        : [];
    }),
  );

  for (const route of routes) {
    const provider = parseOidcProviderId(route.provider);
    if (!provider || !configuredProviders.has(provider)) {
      const label = provider ? oidcProviderLabel(provider) : 'Routed';
      return `${label} OIDC must be enabled with complete credentials while required SSO routes use it.`;
    }
  }
  return null;
}

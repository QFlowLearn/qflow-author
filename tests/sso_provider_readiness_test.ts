import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { oidcTenantConfigs, ssoDomainVerifications, tenants } from '../lib/db/schema.ts';
import {
  OidcTenantConfigError,
  updateOidcTenantConfigs,
} from '../lib/services/oidc_tenant_configs.ts';
import { SsoPolicyInputError, upsertTenantSsoSettings } from '../lib/services/sso_policy.ts';
import { parseSsoDomain, type SsoDomain } from '../lib/sso_domain.ts';
import { oidcTestRuntime, seedOidcConfig } from './oidc_config_fixture.ts';

testCase('required SSO rejects a domain route without a ready OIDC provider', {
  skip: !process.env['DATABASE_URL'],
}, async function () {
  const tenantId = await createTenantWithVerifiedDomain();
  try {
    await expect(
      Promise.resolve().then(() =>
        upsertTenantSsoSettings(tenantId, {
          loginPolicy: 'require_sso',
          domainRoutes: [{ domain: testDomain(), provider: 'google' }],
        })
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof SsoPolicyInputError &&
      caught.message.includes('Google OIDC must be enabled with complete credentials')
    );

    const rows = await db.select({ loginPolicy: tenants.loginPolicy }).from(tenants)
      .where(eq(tenants.id, tenantId));
    expect(rows[0]?.loginPolicy).toStrictEqual('allow_password');
  } finally {
    await deleteTenant(tenantId);
  }
});

testCase('required SSO prevents disabling a routed OIDC provider', {
  skip: !process.env['DATABASE_URL'],
}, async function () {
  const tenantId = await createTenantWithVerifiedDomain();
  try {
    await seedOidcConfig({
      tenantId,
      provider: 'google',
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
    });
    await upsertTenantSsoSettings(tenantId, {
      loginPolicy: 'require_sso',
      domainRoutes: [{ domain: testDomain(), provider: 'google' }],
    });

    await expect(
      Promise.resolve().then(() =>
        updateOidcTenantConfigs(
          tenantId,
          { google: { enabled: false } },
          oidcTestRuntime(),
        )
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof OidcTenantConfigError &&
      caught.message.includes('Google OIDC must be enabled with complete credentials')
    );

    const providerRows = await db.select({ enabled: oidcTenantConfigs.enabled })
      .from(oidcTenantConfigs)
      .where(eq(oidcTenantConfigs.tenantId, tenantId));
    expect(providerRows).toStrictEqual([{ enabled: true }]);
  } finally {
    await deleteTenant(tenantId);
  }
});

async function createTenantWithVerifiedDomain(): Promise<string> {
  const tenantId = crypto.randomUUID();
  await db.insert(tenants).values({
    id: tenantId,
    slug: `sso-readiness-${tenantId.slice(0, 8)}`,
    name: 'SSO readiness test',
  });
  const now = new Date();
  await db.insert(ssoDomainVerifications).values({
    tenantId,
    domain: testDomain(),
    verificationToken: 'verified-token',
    dnsVerifiedAt: now,
    verifiedAt: now,
  });
  return tenantId;
}

function testDomain(): SsoDomain {
  const domain = parseSsoDomain('school.example');
  if (!domain) throw new Error('Test domain must be valid.');
  return domain;
}

async function deleteTenant(tenantId: string): Promise<void> {
  await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => {});
  await shutdownDb().catch(() => {});
}

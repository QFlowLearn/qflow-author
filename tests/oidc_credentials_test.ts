import { expect, test as testCase } from 'vitest';

import { and, eq } from 'drizzle-orm';

import { decryptCredential, encryptCredential } from '../lib/credential_cipher.ts';
import {
  parseOidcSettingsResponse,
  projectOidcSettingsResponse,
} from '../lib/http/oidc_settings_contract.ts';
import { db, shutdownDb } from '../lib/db.ts';
import { oidcTenantConfigs, tenants } from '../lib/db/schema.ts';
import { redact, reveal } from '../lib/redacted.ts';
import { oidcSettingsAuthRoute as oidcSettingsHandlerEndpoint } from '../lib/http/routes/auth_api/oidc_settings.ts';
import { oidcTestRuntime } from './oidc_config_fixture.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const oidcSettingsHandler = oidcSettingsHandlerEndpoint.handle;

testCase('OIDC client-secret envelopes are bound to tenant and provider', async () => {
  const runtime = oidcTestRuntime();
  const tenantId = crypto.randomUUID();
  const context = {
    purpose: 'oidc-client-secret' as const,
    tenantId,
    provider: 'google' as const,
  };
  const encrypted = await encryptCredential(runtime, redact('google-secret'), context);

  expect(reveal(await decryptCredential(runtime, encrypted, context))).toStrictEqual(
    'google-secret',
  );
  await expect(
    Promise.resolve().then(() =>
      decryptCredential(runtime, encrypted, { ...context, tenantId: crypto.randomUUID() })
    ),
  ).rejects.toBeInstanceOf(Error);
  await expect(
    Promise.resolve().then(() =>
      decryptCredential(runtime, encrypted, { ...context, provider: 'microsoft' })
    ),
  ).rejects.toBeInstanceOf(Error);
});

testCase('OIDC client settings parser rejects any secret-bearing response', () => {
  const provider = {
    tenantId: crypto.randomUUID(),
    enabled: true,
    clientId: 'client-id',
    clientSecretConfigured: true,
    microsoftTenant: null,
    createdAt: null,
    updatedAt: null,
  };
  expect(parseOidcSettingsResponse({
    google: { ...provider, provider: 'google', clientSecret: 'must-not-appear' },
    microsoft: { ...provider, provider: 'microsoft' },
  })).toStrictEqual(null);
});

testCase('OIDC settings HTTP contract projects dates and rejects undeclared fields', () => {
  const createdAt = new Date('2026-08-13T09:10:11.123Z');
  const response = projectOidcSettingsResponse([
    {
      tenantId: 'tenant-1',
      provider: 'google',
      enabled: true,
      clientId: 'google-id',
      clientSecretConfigured: true,
      microsoftTenant: null,
      createdAt,
      updatedAt: null,
    },
    {
      tenantId: 'tenant-1',
      provider: 'microsoft',
      enabled: false,
      clientId: null,
      clientSecretConfigured: false,
      microsoftTenant: null,
      createdAt: null,
      updatedAt: null,
    },
  ]);

  expect(response.google.createdAt).toStrictEqual(createdAt.toISOString());
  expect(parseOidcSettingsResponse(response)).toStrictEqual(response);
  expect(parseOidcSettingsResponse({ ...response, clientSecret: 'leak' })).toStrictEqual(null);
  expect(parseOidcSettingsResponse({
    ...response,
    google: { ...response.google, createdAt: 'not-a-timestamp' },
  })).toStrictEqual(null);
});

testCase('OIDC settings encrypt secrets, keep them write-only, and update providers atomically', {
  skip: !process.env['DATABASE_URL'],
}, async function () {
  const tenantId = crypto.randomUUID();
  const auth = { tenantId, userId: crypto.randomUUID(), role: 'admin' as const };
  const runtime = oidcTestRuntime();

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `oidc-credentials-${tenantId.slice(0, 8)}`,
      name: 'OIDC credential test',
    });
    const createResponse = await invokeHttpRoute(
      oidcSettingsHandler,
      makeHttpRequest(
        new Request('https://example.test/api/sso/oidc', {
          ...{ duplex: 'half' },
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            google: {
              enabled: true,
              clientId: 'google-client-id',
              clientSecret: 'google-client-secret',
            },
          }),
        }),
        { auth, state: { runtime } },
      ),
    );
    expect(createResponse.status).toStrictEqual(200);
    const createText = await createResponse.text();
    if (createText.includes('google-client-secret')) {
      expect.unreachable("Expected !createText.includes('google-client-secret')");
    }
    const created = parseOidcSettingsResponse(JSON.parse(createText));
    if (!created) expect.unreachable('Expected created');
    expect(created.google.clientSecretConfigured).toStrictEqual(true);

    const invalidMicrosoftResponse = await invokeHttpRoute(
      oidcSettingsHandler,
      makeHttpRequest(
        new Request('https://example.test/api/sso/oidc', {
          ...{ duplex: 'half' },
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            microsoft: {
              enabled: true,
              clientId: 'microsoft-client-id',
              clientSecret: 'microsoft-client-secret',
              microsoftTenant: 'organizations',
            },
          }),
        }),
        { auth, state: { runtime } },
      ),
    );
    expect(invalidMicrosoftResponse.status).toStrictEqual(400);

    const microsoftTenantId = '10000000-0000-4000-8000-000000000001';
    const microsoftResponse = await invokeHttpRoute(
      oidcSettingsHandler,
      makeHttpRequest(
        new Request('https://example.test/api/sso/oidc', {
          ...{ duplex: 'half' },
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            microsoft: {
              enabled: true,
              clientId: 'microsoft-client-id',
              clientSecret: 'microsoft-client-secret',
              microsoftTenant: microsoftTenantId.toUpperCase(),
            },
          }),
        }),
        { auth, state: { runtime } },
      ),
    );
    expect(microsoftResponse.status).toStrictEqual(200);
    const microsoftRows = await db.select({
      microsoftTenant: oidcTenantConfigs.microsoftTenant,
    }).from(oidcTenantConfigs).where(andTenantProvider(tenantId, 'microsoft')).limit(1);
    expect(microsoftRows[0]?.microsoftTenant).toStrictEqual(microsoftTenantId);

    const storedRows = await db.select({
      encryptedClientSecret: oidcTenantConfigs.encryptedClientSecret,
    }).from(oidcTenantConfigs).where(andTenantProvider(tenantId, 'google')).limit(1);
    const storedSecret = storedRows[0]?.encryptedClientSecret;
    if (!storedSecret) expect.unreachable('Expected storedSecret');
    if (createText.includes(storedSecret)) {
      expect.unreachable('Expected !createText.includes(storedSecret)');
    }
    expect(reveal(
      await decryptCredential(runtime, storedSecret, {
        purpose: 'oidc-client-secret',
        tenantId,
        provider: 'google',
      }),
    )).toStrictEqual('google-client-secret');

    const preserveResponse = await invokeHttpRoute(
      oidcSettingsHandler,
      makeHttpRequest(
        new Request('https://example.test/api/sso/oidc', {
          ...{ duplex: 'half' },
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ google: { clientId: 'updated-google-client-id' } }),
        }),
        { auth, state: { runtime } },
      ),
    );
    expect(preserveResponse.status).toStrictEqual(200);
    const afterPreserve = await db.select({
      clientId: oidcTenantConfigs.clientId,
      encryptedClientSecret: oidcTenantConfigs.encryptedClientSecret,
    }).from(oidcTenantConfigs).where(andTenantProvider(tenantId, 'google')).limit(1);
    expect(afterPreserve[0]?.clientId).toStrictEqual('updated-google-client-id');
    expect(afterPreserve[0]?.encryptedClientSecret).toStrictEqual(storedSecret);

    const rejectedResponse = await invokeHttpRoute(
      oidcSettingsHandler,
      makeHttpRequest(
        new Request('https://example.test/api/sso/oidc', {
          ...{ duplex: 'half' },
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            google: { clientId: 'must-roll-back' },
            microsoft: {
              enabled: true,
              clientId: 'microsoft-client-id',
              microsoftTenant: 'organizations',
            },
          }),
        }),
        { auth, state: { runtime } },
      ),
    );
    expect(rejectedResponse.status).toStrictEqual(400);

    const afterRejectedUpdate = await db.select({
      clientId: oidcTenantConfigs.clientId,
      encryptedClientSecret: oidcTenantConfigs.encryptedClientSecret,
    }).from(oidcTenantConfigs).where(andTenantProvider(tenantId, 'google')).limit(1);
    expect(afterRejectedUpdate[0]?.clientId).toStrictEqual('updated-google-client-id');
    expect(afterRejectedUpdate[0]?.encryptedClientSecret).toStrictEqual(storedSecret);

    const replaceResponse = await invokeHttpRoute(
      oidcSettingsHandler,
      makeHttpRequest(
        new Request('https://example.test/api/sso/oidc', {
          ...{ duplex: 'half' },
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ google: { clientSecret: 'replacement-google-secret' } }),
        }),
        { auth, state: { runtime } },
      ),
    );
    expect(replaceResponse.status).toStrictEqual(200);
    const replacedRows = await db.select({
      encryptedClientSecret: oidcTenantConfigs.encryptedClientSecret,
    }).from(oidcTenantConfigs).where(andTenantProvider(tenantId, 'google')).limit(1);
    const replacementEnvelope = replacedRows[0]?.encryptedClientSecret;
    if (!replacementEnvelope) expect.unreachable('Expected replacementEnvelope');
    if (!(replacementEnvelope !== storedSecret)) {
      expect.unreachable('Expected replacementEnvelope !== storedSecret');
    }
    expect(reveal(
      await decryptCredential(runtime, replacementEnvelope, {
        purpose: 'oidc-client-secret',
        tenantId,
        provider: 'google',
      }),
    )).toStrictEqual('replacement-google-secret');

    const getResponse = await invokeHttpRoute(
      oidcSettingsHandler,
      makeHttpRequest(
        new Request('https://example.test/api/sso/oidc'),
        { auth, state: { runtime } },
      ),
    );
    const getText = await getResponse.text();
    expect(getResponse.status).toStrictEqual(200);
    if (getText.includes('google-client-secret')) {
      expect.unreachable("Expected !getText.includes('google-client-secret')");
    }
    if (getText.includes(replacementEnvelope)) {
      expect.unreachable('Expected !getText.includes(replacementEnvelope)');
    }
  } finally {
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => {});
    await shutdownDb().catch(() => {});
  }
});

function andTenantProvider(tenantId: string, provider: string) {
  return and(
    eq(oidcTenantConfigs.tenantId, tenantId),
    eq(oidcTenantConfigs.provider, provider),
  );
}

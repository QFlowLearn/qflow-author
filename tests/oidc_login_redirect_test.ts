import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { tenants } from '../lib/db/schema.ts';
import { oidcStartAuthRoute as oidcLoginHandlerEndpoint } from '../lib/http/routes/auth_api/oidc_start.ts';
import { invokeHttpRoute, makeHttpRequest, requestUrl } from './helpers/http_route.ts';
import { oidcTestRuntime, seedOidcConfig } from './oidc_config_fixture.ts';

const oidcLoginHandler = oidcLoginHandlerEndpoint.handle;

function makeOidcCtx(req: Request) {
  return makeHttpRequest(req, {
    url: requestUrl(req),
    params: { provider: 'google' },
    omitAuth: true,
    state: { runtime: oidcTestRuntime() },
  });
}

testCase('oidc login uses its canonical request origin and ignores forwarded headers', async () => {
  const tenantId = crypto.randomUUID();
  const slug = `t-${tenantId.slice(0, 8)}`;
  const rootDomain = 'example.test';
  const previousRootDomain = process.env['QFLOW_ROOT_DOMAIN'];

  try {
    await db.insert(tenants).values({ id: tenantId, slug, name: 'OIDC Login Tenant' });
    await seedOidcConfig({
      tenantId,
      provider: 'google',
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
    });
    process.env['QFLOW_ROOT_DOMAIN'] = rootDomain;

    const req = new Request(`https://${slug}.${rootDomain}/auth/oidc/google?next=%2Fdashboard`, {
      method: 'GET',
      headers: {
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'attacker.example.net',
      },
    });
    const res = await invokeHttpRoute(oidcLoginHandler, makeOidcCtx(req));

    expect(res.status).toStrictEqual(302);
    const location = res.headers.get('location');
    if (!location) throw new Error('Missing OIDC redirect location.');

    const authUrl = new URL(location);
    expect(authUrl.origin).toStrictEqual('https://accounts.google.com');
    expect(authUrl.searchParams.get('redirect_uri')).toStrictEqual(
      `https://${slug}.${rootDomain}/auth/oidc/callback`,
    );
  } finally {
    restoreEnv('QFLOW_ROOT_DOMAIN', previousRootDomain);
    try {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    } catch (_) {
      // ignore cleanup errors
    }
    await shutdownDb().catch(() => {});
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

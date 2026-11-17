import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  authIdentities,
  authSessions,
  organizationMemberships,
  ssoDomainRoutes,
  ssoDomainVerifications,
  tenants,
  userPasswords,
  users,
} from '../lib/db/schema.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { SESSION_COOKIE_NAME } from '../lib/http/cookies.ts';
import { provisionLocalUser } from '../lib/services/account_provisioning.ts';
import { loginRoute as loginHandlerEndpoint } from '../lib/http/routes/auth_pages/login.tsx';
import { defaultTestRender, invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';
import { cleanupAuthTestAccount } from './auth_test_fixture.ts';
import { seedOidcConfig } from './oidc_config_fixture.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const loginHandler = loginHandlerEndpoint.handle;

const TEST_INTERFACE_LOCALE: InterfaceLocale = 'en-US';

testCase(
  'login require_sso policy redirects password submission to mapped OIDC provider',
  async () => {
    const tenantId = crypto.randomUUID();
    const slug = `t-${tenantId.slice(0, 8)}`;
    const rootDomain = 'example.test';
    const previousRootDomain = process.env['QFLOW_ROOT_DOMAIN'];

    try {
      await db.insert(tenants).values({
        id: tenantId,
        slug,
        name: 'Require SSO tenant',
        loginPolicy: 'require_sso',
      });
      await seedOidcConfig({
        tenantId,
        provider: 'google',
        clientId: 'google-client-id',
        clientSecret: 'google-client-secret',
      });
      await db.insert(ssoDomainRoutes).values({
        id: crypto.randomUUID(),
        tenantId,
        domain: 'acme.edu',
        provider: 'google',
      });
      await db.insert(ssoDomainVerifications).values({
        tenantId,
        domain: 'acme.edu',
        verificationToken: 'token',
        dnsVerifiedAt: new Date(),
        verifiedAt: new Date(),
      });
      process.env['QFLOW_ROOT_DOMAIN'] = rootDomain;

      const form = new FormData();
      form.set('email', 'teacher@acme.edu');
      form.set('password', 'not-used');
      form.set('next', '/dashboard');

      const req = new Request(`https://${slug}.${rootDomain}/login`, {
        ...{ duplex: 'half' },
        method: 'POST',
        body: form,
      });
      const res = await invokeHttpRoute(
        loginHandler,
        makeHttpRequest(req, { omitAuth: true, render: defaultTestRender() }),
      );
      expect(res.status).toStrictEqual(302);
      expect(res.headers.get('location')).toStrictEqual('/auth/oidc/google?next=%2Fdashboard');
    } finally {
      restoreEnv('QFLOW_ROOT_DOMAIN', previousRootDomain);
      try {
        await db.delete(tenants).where(eq(tenants.id, tenantId));
      } catch (_) {
        // ignore cleanup errors
      }
      await shutdownDb().catch(() => {});
    }
  },
);

testCase(
  'login action=sso routes to mapped Microsoft OIDC provider in prefer_sso policy',
  async () => {
    const tenantId = crypto.randomUUID();
    const slug = `t-${tenantId.slice(0, 8)}`;
    const rootDomain = 'example.test';
    const previousRootDomain = process.env['QFLOW_ROOT_DOMAIN'];

    try {
      await db.insert(tenants).values({
        id: tenantId,
        slug,
        name: 'Prefer SSO tenant',
        loginPolicy: 'prefer_sso',
      });
      await seedOidcConfig({
        tenantId,
        provider: 'microsoft',
        clientId: 'microsoft-client-id',
        clientSecret: 'microsoft-client-secret',
        microsoftTenant: '10000000-0000-4000-8000-000000000001',
      });
      await db.insert(ssoDomainRoutes).values({
        id: crypto.randomUUID(),
        tenantId,
        domain: 'school.org',
        provider: 'microsoft',
      });
      await db.insert(ssoDomainVerifications).values({
        tenantId,
        domain: 'school.org',
        verificationToken: 'token2',
        httpsVerifiedAt: new Date(),
        verifiedAt: new Date(),
      });
      process.env['QFLOW_ROOT_DOMAIN'] = rootDomain;

      const form = new FormData();
      form.set('action', 'sso');
      form.set('email', 'staff@school.org');
      form.set('next', '/home');

      const req = new Request(`https://${slug}.${rootDomain}/login`, {
        ...{ duplex: 'half' },
        method: 'POST',
        body: form,
      });
      const res = await invokeHttpRoute(
        loginHandler,
        makeHttpRequest(req, { omitAuth: true, render: defaultTestRender() }),
      );
      expect(res.status).toStrictEqual(302);
      expect(res.headers.get('location')).toStrictEqual('/auth/oidc/microsoft?next=%2Fhome');
    } finally {
      restoreEnv('QFLOW_ROOT_DOMAIN', previousRootDomain);
      try {
        await db.delete(tenants).where(eq(tenants.id, tenantId));
      } catch (_) {
        // ignore cleanup errors
      }
      await shutdownDb().catch(() => {});
    }
  },
);

testCase('root login exposes public OIDC providers from the configured broker tenant', async () => {
  const tenantId = crypto.randomUUID();
  const previousPublicTenantSlug = process.env['QFLOW_PUBLIC_OIDC_TENANT_SLUG'];
  let renderedData: Record<string, unknown> | null = null;

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: 'public-auth',
      name: 'Public Auth Broker',
    });
    await seedOidcConfig({
      tenantId,
      provider: 'google',
      clientId: 'public-google-client-id',
      clientSecret: 'public-google-client-secret',
    });
    process.env['QFLOW_PUBLIC_OIDC_TENANT_SLUG'] = 'public-auth';

    const req = new Request('https://app.example.test/login', { method: 'GET' });
    const ctx = makeHttpRequest(req, {
      omitAuth: true,
      render: (component) => {
        renderedData = (component as { props?: { data?: Record<string, unknown> } })?.props?.data ??
          null;
        return Promise.resolve(new Response('render', { status: 200 }));
      },
    });

    const res = await invokeHttpRoute(loginHandler, ctx);
    const data = renderedData as {
      oidcProviders?: Array<{ id: string }>;
      loginPolicy?: string;
    } | null;
    expect(res.status).toStrictEqual(200);
    expect(data?.oidcProviders?.map((provider) => provider.id)).toStrictEqual(['google']);
    expect(data?.loginPolicy).toStrictEqual('allow_password');
  } finally {
    restoreEnv('QFLOW_PUBLIC_OIDC_TENANT_SLUG', previousPublicTenantSlug);
    try {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    } catch (_) {
      // ignore cleanup errors
    }
    await shutdownDb().catch(() => {});
  }
});

testCase('login GET redirects authenticated users to assessments', async () => {
  const tenantId = crypto.randomUUID();
  const email = `teacher-${tenantId.slice(0, 8)}@example.test`;
  let userId = '';

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `t-${tenantId.slice(0, 8)}`,
      name: 'Redirect tenant',
    });
    const created = await provisionLocalUser({
      email,
      password: 'A strong login redirect password 2026',
      displayName: 'Teacher',
      interfaceLocale: TEST_INTERFACE_LOCALE,
    });
    if (!created.ok) throw new Error('expected user creation to succeed');
    userId = created.userId;
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'instructor',
    });
    const session = await createSession({
      userId,
      tenantId,
    });

    const req = new Request('https://qflowlearn.com/login', {
      method: 'GET',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(session.token)}`,
      },
    });
    const ctx = makeHttpRequest(req, {
      omitAuth: true,
      render: defaultTestRender(),
    });
    const res = await invokeHttpRoute(loginHandler, ctx);
    expect(res.status).toStrictEqual(302);
    expect(res.headers.get('location')).toStrictEqual('/assessments');
  } finally {
    try {
      if (userId) {
        await db.delete(authSessions).where(eq(authSessions.userId, userId));
        await db.delete(authIdentities).where(eq(authIdentities.userId, userId));
        await db.delete(userPasswords).where(eq(userPasswords.userId, userId));
        await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    } catch (_) {
      // ignore cleanup errors
    }
    await shutdownDb().catch(() => {});
  }
});

testCase(
  'password login redirects required password changes before the requested destination',
  async () => {
    const tenantId = crypto.randomUUID();
    const email = `password-change-${tenantId.slice(0, 8)}@example.test`;
    const password = 'A strong password change redirect phrase 2026';
    let userId: string | null = null;

    try {
      await db.insert(tenants).values({
        id: tenantId,
        slug: `t-${tenantId.slice(0, 8)}`,
        name: 'Password change redirect tenant',
      });
      const created = await provisionLocalUser({
        email,
        password,
        displayName: 'Password Change Teacher',
        interfaceLocale: TEST_INTERFACE_LOCALE,
      });
      if (!created.ok) throw new Error('expected user creation to succeed');
      userId = created.userId;
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'instructor',
      });
      await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, userId));

      const form = new FormData();
      form.set('action', 'password');
      form.set('email', email);
      form.set('password', password);
      form.set('next', '/dashboard');
      const request = new Request('https://qflowlearn.com/login', {
        ...{ duplex: 'half' },
        method: 'POST',
        body: form,
      });
      const response = await invokeHttpRoute(
        loginHandler,
        makeHttpRequest(request, { omitAuth: true, render: defaultTestRender() }),
      );

      expect(response.status).toStrictEqual(302);
      expect(response.headers.get('location')).toStrictEqual('/settings/password?force=1');
      expect(response.headers.get('set-cookie')?.startsWith(`${SESSION_COOKIE_NAME}=`))
        .toStrictEqual(true);
    } finally {
      await cleanupAuthTestAccount({ tenantId, userId });
      await shutdownDb().catch(() => {});
    }
  },
);

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

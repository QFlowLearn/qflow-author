import { expect, it } from 'vitest';

import { db, shutdownDb } from '../../lib/db.ts';
import { eq } from 'drizzle-orm';
import { organizationMemberships, tenants } from '../../lib/db/schema.ts';
import { authenticateWithPassword } from '../../lib/services/auth.ts';
import { createSession, getSessionByToken } from '../../lib/services/auth_sessions.ts';
import { SESSION_COOKIE_NAME } from '../../lib/http/cookies.ts';
import { provisionLocalUser } from '../../lib/services/account_provisioning.ts';
import { loginAuthRoute } from '../../lib/http/routes/auth_api/login.ts';
import { cleanupAuthTestAccount } from '../auth_test_fixture.ts';
import { apiRequest } from '../helpers/http_request_fixture.ts';
import { requireQaDatabaseUrl } from '../helpers/qa_database.ts';

import type { InterfaceLocale } from '../../lib/i18n/locale.ts';

const TEST_INTERFACE_LOCALE: InterfaceLocale = 'en-US';

it('login throttling is atomic and scoped to the account plus request origin', async () => {
  requireQaDatabaseUrl(process.env.DATABASE_URL);
  const tenantId = crypto.randomUUID();
  const email = `login-lockout-${tenantId.slice(0, 8)}@example.test`;
  const password = 'A registered login password phrase 2026';
  const blockedOrigin = '192.0.2.20';
  const independentOrigin = '192.0.2.21';
  const routeFailureOrigin = '192.0.2.22';
  let userId: string | null = null;

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `t-${tenantId.slice(0, 8)}`,
      name: 'Login lockout test',
    });
    const created = await provisionLocalUser({
      email,
      password,
      interfaceLocale: TEST_INTERFACE_LOCALE,
    });
    if (!(created.ok)) expect.unreachable('Expected created.ok');
    userId = created.userId;
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });

    const failures = await Promise.all(
      Array.from({ length: 5 }, () =>
        authenticateWithPassword({
          email,
          password: 'A definitely incorrect password phrase',
          attemptOrigin: blockedOrigin,
          hostTenantId: null,
        })),
    );
    expect(failures.every((result) => !result.ok && result.code === 'invalid')).toStrictEqual(true);
    expect(
      await authenticateWithPassword({
        email,
        password,
        attemptOrigin: blockedOrigin,
        hostTenantId: null,
      }),
    ).toStrictEqual({ ok: false, code: 'locked' });

    const independentLogin = await authenticateWithPassword({
      email,
      password,
      attemptOrigin: independentOrigin,
      hostTenantId: null,
    });
    expect(independentLogin.ok).toStrictEqual(true);

    const existingSession = await createSession({ userId, tenantId });
    const failedResponse = await callLogin({
      email,
      password: 'Another incorrect password phrase 2026',
      origin: routeFailureOrigin,
      sessionToken: existingSession.token,
    });
    expect(failedResponse.status).toStrictEqual(401);
    if (!(await getSessionByToken(existingSession.token))) {
      expect.unreachable('Expected await getSessionByToken(existingSession.token)');
    }

    const successResponse = await callLogin({
      email,
      password,
      origin: independentOrigin,
      sessionToken: existingSession.token,
    });
    expect(successResponse.status).toStrictEqual(200);
    if (!(successResponse.headers.get('set-cookie')?.includes(`${SESSION_COOKIE_NAME}=`))) {
      expect.unreachable(
        "Expected successResponse.headers.get('set-cookie')?.includes(`${SESSION_COOKIE_NAME}=`)",
      );
    }
    expect(await getSessionByToken(existingSession.token)).toStrictEqual(null);
  } finally {
    const loginAttemptKeys = await Promise.all([
      loginAttemptKey(email, blockedOrigin),
      loginAttemptKey(email, independentOrigin),
      loginAttemptKey(email, routeFailureOrigin),
      loginOriginAttemptKey(blockedOrigin),
      loginOriginAttemptKey(independentOrigin),
      loginOriginAttemptKey(routeFailureOrigin),
    ]);
    await cleanupAuthTestAccount({ tenantId, userId, loginAttemptKeys });
    await shutdownDb().catch(() => {});
  }
}, 30000);

it(
  'password login selects the host tenant and fails closed for ambiguous memberships',
  async () => {
    requireQaDatabaseUrl(process.env.DATABASE_URL);
    const firstTenantId = crypto.randomUUID();
    const secondTenantId = crypto.randomUUID();
    const email = `multi-tenant-login-${firstTenantId.slice(0, 8)}@example.test`;
    const password = 'A multi tenant password phrase 2026';
    const origin = '192.0.2.40';
    let userId: string | null = null;

    try {
      await db.insert(tenants).values([
        { id: firstTenantId, slug: `t-${firstTenantId.slice(0, 8)}`, name: 'First tenant' },
        { id: secondTenantId, slug: `t-${secondTenantId.slice(0, 8)}`, name: 'Second tenant' },
      ]);
      const created = await provisionLocalUser({
        email,
        password,
        interfaceLocale: TEST_INTERFACE_LOCALE,
      });
      if (!(created.ok)) expect.unreachable('Expected created.ok');
      userId = created.userId;
      await db.insert(organizationMemberships).values([
        { id: crypto.randomUUID(), tenantId: firstTenantId, userId, role: 'owner' },
        { id: crypto.randomUUID(), tenantId: secondTenantId, userId, role: 'instructor' },
      ]);

      expect(
        await authenticateWithPassword({
          email,
          password,
          attemptOrigin: origin,
          hostTenantId: null,
        }),
      ).toStrictEqual({ ok: false, code: 'ambiguous_membership' });
      expect(
        await authenticateWithPassword({
          email,
          password,
          attemptOrigin: origin,
          hostTenantId: firstTenantId,
        }),
      ).toStrictEqual({ ok: true, userId, tenantId: firstTenantId, mustChangePassword: false });
      expect(
        await authenticateWithPassword({
          email,
          password,
          attemptOrigin: origin,
          hostTenantId: crypto.randomUUID(),
        }),
      ).toStrictEqual({ ok: false, code: 'tenant_mismatch' });
    } finally {
      await cleanupAuthTestAccount({ tenantId: firstTenantId, userId });
      await db.delete(tenants).where(eq(tenants.id, secondTenantId)).catch(() => {});
      await shutdownDb().catch(() => {});
    }
  },
  30000,
);

it('SSO rejection preserves password failures until the account locks', async () => {
  requireQaDatabaseUrl(process.env.DATABASE_URL);
  const tenantId = crypto.randomUUID();
  const email = `sso-lockout-${tenantId.slice(0, 8)}@example.test`;
  const password = 'A registered SSO-only password phrase 2026';
  const origin = '192.0.2.60';
  let userId: string | null = null;

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `t-${tenantId.slice(0, 8)}`,
      name: 'SSO lockout test',
      loginPolicy: 'require_sso',
    });
    const created = await provisionLocalUser({
      email,
      password,
      interfaceLocale: TEST_INTERFACE_LOCALE,
    });
    if (!(created.ok)) expect.unreachable('Expected created.ok');
    userId = created.userId;
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(
        await authenticateWithPassword({
          email,
          password: 'An incorrect SSO-only password phrase',
          attemptOrigin: origin,
          hostTenantId: tenantId,
        }),
      ).toStrictEqual({ ok: false, code: 'invalid' });
    }
    expect(
      await authenticateWithPassword({
        email,
        password,
        attemptOrigin: origin,
        hostTenantId: tenantId,
      }),
    ).toStrictEqual({ ok: false, code: 'sso_required', tenantId });
    expect(
      await authenticateWithPassword({
        email,
        password: 'A fifth incorrect SSO-only password phrase',
        attemptOrigin: origin,
        hostTenantId: tenantId,
      }),
    ).toStrictEqual({ ok: false, code: 'invalid' });
    expect(
      await authenticateWithPassword({
        email,
        password,
        attemptOrigin: origin,
        hostTenantId: tenantId,
      }),
    ).toStrictEqual({ ok: false, code: 'locked' });
  } finally {
    const loginAttemptKeys = await Promise.all([
      loginAttemptKey(email, origin),
      loginOriginAttemptKey(origin),
    ]);
    await cleanupAuthTestAccount({ tenantId, userId, loginAttemptKeys });
    await shutdownDb().catch(() => {});
  }
}, 30000);

function callLogin(input: {
  readonly email: string;
  readonly password: string;
  readonly origin: string;
  readonly sessionToken: string;
}): Promise<Response> {
  const req = new Request('https://author.example.test/api/auth/login', {
    ...{ duplex: 'half' },
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': input.origin,
      cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(input.sessionToken)}`,
    },
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  return Promise.resolve(loginAuthRoute.handle(apiRequest(req, { clientIp: input.origin })));
}

async function loginAttemptKey(email: string, origin: string): Promise<string> {
  const data = new TextEncoder().encode(`${email.toLowerCase()}\u0000${origin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function loginOriginAttemptKey(origin: string): Promise<string> {
  const data = new TextEncoder().encode(`login-origin\u0000${origin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

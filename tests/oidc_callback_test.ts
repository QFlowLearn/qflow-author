import { expect, test as testCase } from 'vitest';

import { getUserSettings, saveUserSettings } from '../lib/services/user_settings.ts';

import { and, eq } from 'drizzle-orm';
import { encodeBase64Url } from '../lib/base64.ts';
import { db, shutdownDb } from '../lib/db.ts';
import { auditLogs, authIdentities, tenants, users } from '../lib/db/schema.ts';
import { getSessionByToken } from '../lib/services/auth_sessions.ts';
import { createOidcLoginState } from '../lib/services/oidc.ts';
import { oidcCallbackAuthRoute as oidcCallbackHandlerEndpoint } from '../lib/http/routes/auth_api/oidc_callback.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';
import { oidcTestRuntime, seedOidcConfig } from './oidc_config_fixture.ts';

const oidcCallbackHandler = oidcCallbackHandlerEndpoint.handle;

type SentEmailMessage = {
  readonly to: string;
  readonly bcc?: string;
  readonly subject: string;
  readonly text?: string;
};

testCase('oidc callback exchanges code, validates token, and creates session', async () => {
  const tenantId = crypto.randomUUID();
  const slug = `t-${tenantId.slice(0, 8)}`;
  const subject = `sub-${crypto.randomUUID()}`;
  const email = `teacher-${crypto.randomUUID()}@example.com`;
  const rootDomain = 'example.test';
  const previousRootDomain = process.env['QFLOW_ROOT_DOMAIN'];

  const originalFetch = globalThis.fetch;
  let linkedUserId: string | null = null;

  try {
    await db.insert(tenants).values({ id: tenantId, slug, name: 'OIDC Tenant' });
    await seedOidcConfig({
      tenantId,
      provider: 'google',
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
    });
    process.env['QFLOW_ROOT_DOMAIN'] = rootDomain;

    const loginState = await createOidcLoginState({
      tenantId,
      provider: 'google',
      redirectPath: '/after-login',
    });

    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    (publicJwk as Record<string, unknown>).kid = 'kid-1';
    (publicJwk as Record<string, unknown>).alg = 'RS256';
    (publicJwk as Record<string, unknown>).use = 'sig';

    const nowSec = Math.floor(Date.now() / 1000);
    const idToken = await signJwt(privateJwk, {
      iss: 'https://accounts.google.com',
      aud: 'google-client-id',
      exp: nowSec + 300,
      iat: nowSec,
      nonce: loginState.nonce,
      sub: subject,
      email,
      email_verified: true,
      name: 'Teacher Example',
    }, 'kid-1');

    globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : (input instanceof URL ? input.toString() : input.url);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    const callbackReq = new Request(
      `https://${slug}.${rootDomain}/auth/oidc/callback?code=fake-code&state=${
        encodeURIComponent(loginState.state)
      }`,
      { method: 'GET' },
    );
    const callbackRes = await invokeHttpRoute(
      oidcCallbackHandler,
      makeHttpRequest(callbackReq, {
        omitAuth: true,
        state: { runtime: oidcTestRuntime(), interfaceLocale: 'es-419' },
      }),
    );
    expect(callbackRes.status).toStrictEqual(302);
    expect(callbackRes.headers.get('location')).toStrictEqual('/after-login');

    const setCookie = callbackRes.headers.get('set-cookie') ?? '';
    if (!(setCookie.includes('qflow_session='))) {
      expect.unreachable("Expected setCookie.includes('qflow_session=')");
    }
    if (!(setCookie.includes('qflow-locale=es-419'))) {
      expect.unreachable("Expected setCookie.includes('qflow-locale=es-419')");
    }
    const tokenMatch = setCookie.match(/qflow_session=([^;]+)/);
    if (!(tokenMatch?.[1])) expect.unreachable('Expected tokenMatch?.[1]');

    const session = await getSessionByToken(decodeURIComponent(tokenMatch![1]));
    if (!session) expect.unreachable('Expected session');
    expect(session!.tenantId).toStrictEqual(tenantId);

    const identityRows = await db.select({ userId: authIdentities.userId })
      .from(authIdentities)
      .where(and(
        eq(authIdentities.provider, 'google'),
        eq(authIdentities.providerId, `https://accounts.google.com|${subject}`),
      ))
      .limit(1);
    expect(identityRows.length).toStrictEqual(1);
    linkedUserId = identityRows[0].userId;
    const initialSettings = await getUserSettings(linkedUserId);
    expect(initialSettings.interfaceLocale).toStrictEqual('es-419');
    await saveUserSettings(linkedUserId, { ...initialSettings, interfaceLocale: 'es-ES' });

    const returningState = await createOidcLoginState({ tenantId, provider: 'google' });
    const returningToken = await signJwt(privateJwk, {
      iss: 'https://accounts.google.com',
      aud: 'google-client-id',
      exp: nowSec + 300,
      iat: nowSec,
      nonce: returningState.nonce,
      sub: subject,
      email,
      email_verified: true,
    }, 'kid-1');
    const firstFetch = globalThis.fetch;
    globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      if (url === 'https://oauth2.googleapis.com/token') {
        return Promise.resolve(Response.json({ id_token: returningToken }));
      }
      return firstFetch(input, init);
    }) as typeof fetch;
    const returningResponse = await invokeHttpRoute(
      oidcCallbackHandler,
      makeHttpRequest(
        new Request(
          `https://${slug}.${rootDomain}/auth/oidc/callback?code=returning-code&state=${returningState.state}`,
        ),
        { omitAuth: true, state: { runtime: oidcTestRuntime(), interfaceLocale: 'en-US' } },
      ),
    );
    expect(returningResponse.status).toStrictEqual(302);
    expect(returningResponse.headers.get('location')).toStrictEqual('/assessments');
    if (!((returningResponse.headers.get('set-cookie') ?? '').includes('qflow-locale=es-ES'))) {
      expect.unreachable(
        "Expected (returningResponse.headers.get('set-cookie') ?? '').includes('qflow-locale=es-ES')",
      );
    }
    expect((await getUserSettings(linkedUserId)).interfaceLocale).toStrictEqual('es-ES');

    const verifiedUsers = await db.select({ emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, linkedUserId))
      .limit(1);
    if (!(verifiedUsers[0]?.emailVerifiedAt instanceof Date)) {
      expect.unreachable('Expected verifiedUsers[0]?.emailVerifiedAt instanceof Date');
    }

    const successAudit = await db.select({
      action: auditLogs.action,
      metadata: auditLogs.metadata,
    }).from(auditLogs)
      .where(eq(auditLogs.tenantId, tenantId))
      .limit(1);
    expect(successAudit.length).toStrictEqual(1);
    expect(successAudit[0].action).toStrictEqual('login_success');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('QFLOW_ROOT_DOMAIN', previousRootDomain);
    try {
      if (linkedUserId) {
        await db.delete(users).where(eq(users.id, linkedUserId));
      }
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    } catch (_) {
      // ignore cleanup errors
    }
    await shutdownDb().catch(() => {});
  }
});

testCase('oidc callback rejects invalid audience', async () => {
  const tenantId = crypto.randomUUID();
  const slug = `t-${tenantId.slice(0, 8)}`;
  const rootDomain = 'example.test';
  const previousRootDomain = process.env['QFLOW_ROOT_DOMAIN'];
  const originalFetch = globalThis.fetch;

  try {
    await db.insert(tenants).values({ id: tenantId, slug, name: 'OIDC Tenant 2' });
    await seedOidcConfig({
      tenantId,
      provider: 'google',
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
    });
    process.env['QFLOW_ROOT_DOMAIN'] = rootDomain;

    const loginState = await createOidcLoginState({
      tenantId,
      provider: 'google',
    });

    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    (publicJwk as Record<string, unknown>).kid = 'kid-2';
    (publicJwk as Record<string, unknown>).alg = 'RS256';
    (publicJwk as Record<string, unknown>).use = 'sig';

    const nowSec = Math.floor(Date.now() / 1000);
    const idToken = await signJwt(privateJwk, {
      iss: 'https://accounts.google.com',
      aud: 'wrong-client-id',
      exp: nowSec + 300,
      iat: nowSec,
      nonce: loginState.nonce,
      sub: 'sub-999',
      email: 'teacher@example.com',
      email_verified: true,
    }, 'kid-2');

    globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : (input instanceof URL ? input.toString() : input.url);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    const callbackReq = new Request(
      `https://${slug}.${rootDomain}/auth/oidc/callback?code=fake-code&state=${
        encodeURIComponent(loginState.state)
      }`,
      { method: 'GET' },
    );
    const callbackRes = await invokeHttpRoute(
      oidcCallbackHandler,
      makeHttpRequest(callbackReq, {
        omitAuth: true,
        state: { runtime: oidcTestRuntime(), interfaceLocale: 'en-US' },
      }),
    );
    expect(callbackRes.status).toStrictEqual(302);
    const location = callbackRes.headers.get('location') ?? '';
    if (!(location.startsWith('/login?'))) {
      expect.unreachable("Expected location.startsWith('/login?')");
    }
    expect(new URL(location, callbackReq.url).searchParams.get('error')).toStrictEqual(
      'identity_verification_failed',
    );
    if (callbackRes.headers.get('set-cookie')) {
      expect.unreachable("Expected !callbackRes.headers.get('set-cookie')");
    }
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('QFLOW_ROOT_DOMAIN', previousRootDomain);
    try {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    } catch (_) {
      // ignore cleanup errors
    }
    await shutdownDb().catch(() => {});
  }
});

testCase(
  'oidc callback on the root login creates a workspace tenant for public social sign-in',
  async () => {
    const publicTenantId = crypto.randomUUID();
    const publicSubject = `public-sub-${crypto.randomUUID()}`;
    const publicEmail = `public-user-${crypto.randomUUID()}@example.com`;
    const previousPublicTenantSlug = process.env['QFLOW_PUBLIC_OIDC_TENANT_SLUG'];
    const originalFetch = globalThis.fetch;
    let linkedUserId: string | null = null;
    let createdWorkspaceTenantId: string | null = null;
    const sentEmails: SentEmailMessage[] = [];

    try {
      await db.insert(tenants).values({
        id: publicTenantId,
        slug: 'public-auth',
        name: 'Public Auth Broker',
      });
      await seedOidcConfig({
        tenantId: publicTenantId,
        provider: 'google',
        clientId: 'public-google-client-id',
        clientSecret: 'public-google-client-secret',
      });
      process.env['QFLOW_PUBLIC_OIDC_TENANT_SLUG'] = 'public-auth';

      const loginState = await createOidcLoginState({
        tenantId: publicTenantId,
        provider: 'google',
      });

      const keyPair = await crypto.subtle.generateKey(
        {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['sign', 'verify'],
      );
      const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
      const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
      (publicJwk as Record<string, unknown>).kid = 'kid-public';
      (publicJwk as Record<string, unknown>).alg = 'RS256';
      (publicJwk as Record<string, unknown>).use = 'sig';

      const nowSec = Math.floor(Date.now() / 1000);
      let idToken = await signJwt(privateJwk, {
        iss: 'https://accounts.google.com',
        aud: 'public-google-client-id',
        exp: nowSec + 300,
        iat: nowSec,
        nonce: loginState.nonce,
        sub: publicSubject,
        email: publicEmail,
        email_verified: true,
        name: 'Public User',
      }, 'kid-public');

      globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
        const url = typeof input === 'string'
          ? input
          : (input instanceof URL ? input.toString() : input.url);
        if (url === 'https://oauth2.googleapis.com/token') {
          return new Response(JSON.stringify({ id_token: idToken }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
          return new Response(JSON.stringify({ keys: [publicJwk] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return originalFetch(input as RequestInfo | URL, init);
      }) as typeof fetch;

      const callbackReq = new Request(
        `https://app.example.test/auth/oidc/callback?code=fake-code&state=${
          encodeURIComponent(loginState.state)
        }`,
        { method: 'GET' },
      );
      const callbackRes = await invokeHttpRoute(
        oidcCallbackHandler,
        makeHttpRequest(callbackReq, {
          omitAuth: true,
          state: {
            interfaceLocale: 'es-ES',
            runtime: {
              bindings: {
                ...oidcTestRuntime().bindings,
                QFLOW_EMAIL: {
                  send(message: SentEmailMessage): Promise<{ messageId: string }> {
                    sentEmails.push(message);
                    return Promise.resolve({ messageId: `oidc-message-${sentEmails.length}` });
                  },
                },
                QFLOW_EMAIL_FROM: 'QFlowLearn <hello@qflowlearn.com>',
              },
            },
          },
        }),
      );
      expect(callbackRes.status).toStrictEqual(302);
      expect(callbackRes.headers.get('location')).toStrictEqual('/onboarding');
      expect(sentEmails.length).toStrictEqual(1);
      expect(sentEmails[0].to).toStrictEqual(publicEmail);
      expect(sentEmails[0].bcc).toBeUndefined();
      expect(sentEmails[0].subject).toStrictEqual('Te damos la bienvenida a la beta de QFlowLearn');
      if (!((callbackRes.headers.get('set-cookie') ?? '').includes('qflow-locale=es-ES'))) {
        expect.unreachable(
          "Expected (callbackRes.headers.get('set-cookie') ?? '').includes('qflow-locale=es-ES')",
        );
      }

      const setCookie = callbackRes.headers.get('set-cookie') ?? '';
      const tokenMatch = setCookie.match(/qflow_session=([^;]+)/);
      if (!(tokenMatch?.[1])) expect.unreachable('Expected tokenMatch?.[1]');

      const session = await getSessionByToken(decodeURIComponent(tokenMatch![1]));
      if (!session) expect.unreachable('Expected session');
      if (!(session!.tenantId !== publicTenantId)) {
        expect.unreachable('Expected session!.tenantId !== publicTenantId');
      }
      createdWorkspaceTenantId = session!.tenantId;

      const identityRows = await db.select({ userId: authIdentities.userId })
        .from(authIdentities)
        .where(and(
          eq(authIdentities.provider, 'google'),
          eq(authIdentities.providerId, `https://accounts.google.com|${publicSubject}`),
        ))
        .limit(1);
      expect(identityRows.length).toStrictEqual(1);
      linkedUserId = identityRows[0].userId;

      const successAudit = await db.select({
        action: auditLogs.action,
        metadata: auditLogs.metadata,
      }).from(auditLogs)
        .where(eq(auditLogs.tenantId, createdWorkspaceTenantId))
        .limit(1);
      expect(successAudit.length).toStrictEqual(1);
      expect(successAudit[0].action).toStrictEqual('login_success');
      expect((successAudit[0].metadata as { publicLogin?: boolean } | null)?.publicLogin)
        .toStrictEqual(true);

      const secondLoginState = await createOidcLoginState({
        tenantId: publicTenantId,
        provider: 'google',
      });
      idToken = await signJwt(privateJwk, {
        iss: 'https://accounts.google.com',
        aud: 'public-google-client-id',
        exp: nowSec + 300,
        iat: nowSec,
        nonce: secondLoginState.nonce,
        sub: publicSubject,
        email: publicEmail,
        email_verified: true,
        name: 'Public User',
      }, 'kid-public');

      const secondCallbackReq = new Request(
        `https://app.example.test/auth/oidc/callback?code=fake-code&state=${
          encodeURIComponent(secondLoginState.state)
        }`,
        { method: 'GET' },
      );
      const secondCallbackRes = await invokeHttpRoute(
        oidcCallbackHandler,
        makeHttpRequest(secondCallbackReq, {
          omitAuth: true,
          state: {
            interfaceLocale: 'en-US' as const,
            runtime: {
              bindings: {
                ...oidcTestRuntime().bindings,
                QFLOW_EMAIL: {
                  send(message: SentEmailMessage): Promise<{ messageId: string }> {
                    sentEmails.push(message);
                    return Promise.resolve({ messageId: `oidc-message-${sentEmails.length}` });
                  },
                },
                QFLOW_EMAIL_FROM: 'QFlowLearn <hello@qflowlearn.com>',
              },
            },
          },
        }),
      );
      expect(secondCallbackRes.status).toStrictEqual(302);
      expect(secondCallbackRes.headers.get('location')).toStrictEqual('/assessments');
      expect(sentEmails.length).toStrictEqual(1);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv('QFLOW_PUBLIC_OIDC_TENANT_SLUG', previousPublicTenantSlug);
      try {
        if (linkedUserId) {
          await db.delete(users).where(eq(users.id, linkedUserId));
        }
        if (createdWorkspaceTenantId) {
          await db.delete(tenants).where(eq(tenants.id, createdWorkspaceTenantId));
        }
        await db.delete(tenants).where(eq(tenants.id, publicTenantId));
      } catch (_) {
        // ignore cleanup errors
      }
      await shutdownDb().catch(() => {});
    }
  },
);

async function signJwt(
  privateJwk: JsonWebKey,
  payload: Record<string, unknown>,
  kid: string,
): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const encodedHeader = base64UrlEncodeJson(header);
  const encodedPayload = base64UrlEncodeJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function base64UrlEncodeJson(value: unknown): string {
  const json = JSON.stringify(value);
  return encodeBase64Url(new TextEncoder().encode(json));
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

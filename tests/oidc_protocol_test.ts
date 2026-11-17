import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';

import { encodeBase64Url } from '../lib/base64.ts';
import { redact } from '../lib/redacted.ts';
import {
  buildOidcProviderConfig,
  exchangeOidcCode,
  type OidcProviderConfig,
  verifyOidcIdToken,
} from '../lib/oidc_protocol.ts';

const MICROSOFT_TENANT_ID = '10000000-0000-4000-8000-000000000001';
const CLIENT_ID = 'oidc-client-id';
const NONCE = 'expected-nonce';

testCase('Microsoft OIDC binds endpoints and issuer to one Directory tenant', () => {
  const config = microsoftConfig();

  expect(config.authorizationEndpoint).toStrictEqual(
    `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`,
  );
  expect(config.issuers).toStrictEqual([
    `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/v2.0`,
  ]);
  expect(() =>
    buildOidcProviderConfig({
      provider: 'microsoft',
      clientId: CLIENT_ID,
      clientSecret: redact('client-secret'),
      microsoftTenant: 'organizations',
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('tenant ID is invalid')
    ),
  );
});

testCase(
  'OIDC verification requires exact issuer, numeric dates, and authorized party',
  async () => {
    const signing = await createSigningFixture();
    await withOidcServer({ keys: [signing.publicJwk] }, async (serverUrl) => {
      const config = { ...microsoftConfig(), jwksUrl: `${serverUrl}/jwks` };
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: config.issuers[0],
        aud: [CLIENT_ID, 'resource-api'],
        azp: CLIENT_ID,
        exp: now + 300,
        iat: now,
        nonce: NONCE,
        sub: 'subject-1',
        email: 'teacher@example.test',
      };
      const valid = await verifyOidcIdToken({
        config,
        token: await signJwt(signing.privateJwk, claims, signing.kid),
        nonce: NONCE,
      });
      expect(valid.issuer).toStrictEqual(config.issuers[0]);
      expect(valid.subject).toStrictEqual('subject-1');
      expect(valid.email).toStrictEqual({
        _tag: 'ProviderAsserted',
        address: 'teacher@example.test',
      });

      const invalidClaims = [
        { ...claims, iss: 'https://login.microsoftonline.com/another-tenant/v2.0' },
        { ...claims, exp: String(now + 300) },
        { ...claims, azp: undefined },
        { ...claims, azp: 'another-client' },
        { ...claims, iat: String(now) },
      ];
      for (const payload of invalidClaims) {
        const invalidToken = await signJwt(signing.privateJwk, payload, signing.kid);
        await expect(
          Promise.resolve().then(() =>
            verifyOidcIdToken({
              config,
              token: invalidToken,
              nonce: NONCE,
            })
          ),
        ).rejects.toBeInstanceOf(Error);
      }
    });
  },
);

testCase(
  'Google OIDC accepts only verified email and never substitutes preferred username',
  async () => {
    const signing = await createSigningFixture();
    await withOidcServer({ keys: [signing.publicJwk] }, async (serverUrl) => {
      const config = { ...googleConfig(), jwksUrl: `${serverUrl}/jwks` };
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: config.issuers[0],
        aud: CLIENT_ID,
        exp: now + 300,
        iat: now,
        nonce: NONCE,
        sub: 'google-subject',
        email: 'teacher@example.test',
      };

      const verified = await verifyOidcIdToken({
        config,
        token: await signJwt(
          signing.privateJwk,
          { ...claims, email_verified: true },
          signing.kid,
        ),
        nonce: NONCE,
      });
      expect(verified.email).toStrictEqual({
        _tag: 'Verified',
        address: 'teacher@example.test',
      });

      const unverified = await verifyOidcIdToken({
        config,
        token: await signJwt(
          signing.privateJwk,
          { ...claims, email_verified: false },
          signing.kid,
        ),
        nonce: NONCE,
      });
      expect(unverified.email).toStrictEqual(null);

      const usernameOnly = await verifyOidcIdToken({
        config,
        token: await signJwt(
          signing.privateJwk,
          {
            ...claims,
            email: undefined,
            email_verified: true,
            preferred_username: 'teacher@example.test',
          },
          signing.kid,
        ),
        nonce: NONCE,
      });
      expect(usernameOnly.email).toStrictEqual(null);

      const invalidVerification = await signJwt(
        signing.privateJwk,
        { ...claims, email_verified: 'true' },
        signing.kid,
      );
      await expect(
        Promise.resolve().then(() =>
          verifyOidcIdToken({
            config,
            token: invalidVerification,
            nonce: NONCE,
          })
        ),
      ).rejects.toBeInstanceOf(Error);

      const invalidEmail = await signJwt(
        signing.privateJwk,
        { ...claims, email: 'not-an-email', email_verified: true },
        signing.kid,
      );
      await expect(
        Promise.resolve().then(() =>
          verifyOidcIdToken({ config, token: invalidEmail, nonce: NONCE })
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('Invalid email claim')
      );
    });
  },
);

testCase(
  'OIDC protocol rejects malformed token and JWKS responses and propagates cancellation',
  async () => {
    const signing = await createSigningFixture();
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(signing.privateJwk, {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      exp: now + 300,
      nonce: NONCE,
      sub: 'subject-1',
    }, signing.kid);

    await withOidcServer(
      { keys: [{ kty: 'RSA', kid: signing.kid, n: 42, e: 'AQAB' }] },
      async (serverUrl) => {
        const config = { ...googleConfig(), jwksUrl: `${serverUrl}/jwks` };
        await expect(
          Promise.resolve().then(() => verifyOidcIdToken({ config, token, nonce: NONCE })),
        ).rejects.toSatisfy((caught: unknown) =>
          caught instanceof Error && caught.message.includes('modulus is invalid')
        );
      },
    );

    await withOidcServer({ token: { access_token: 'access-only' } }, async (serverUrl) => {
      const config = { ...googleConfig(), tokenEndpoint: `${serverUrl}/token` };
      await expect(
        Promise.resolve().then(() =>
          exchangeOidcCode({ config, code: 'code', redirectUri: 'https://app/callback' })
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('Missing id_token')
      );

      const controller = new AbortController();
      controller.abort();
      await expect(
        Promise.resolve().then(() =>
          exchangeOidcCode(
            { config, code: 'code', redirectUri: 'https://app/callback' },
            { signal: controller.signal },
          )
        ),
      ).rejects.toBeInstanceOf(Error);
    });
  },
);

function microsoftConfig(): OidcProviderConfig {
  return buildOidcProviderConfig({
    provider: 'microsoft',
    clientId: CLIENT_ID,
    clientSecret: redact('client-secret'),
    microsoftTenant: MICROSOFT_TENANT_ID,
  });
}

function googleConfig(): OidcProviderConfig {
  return buildOidcProviderConfig({
    provider: 'google',
    clientId: CLIENT_ID,
    clientSecret: redact('client-secret'),
    microsoftTenant: null,
  });
}

type OidcTestJwk = JsonWebKey & {
  readonly kid: string;
  readonly alg: 'RS256';
  readonly use: 'sig';
};

async function createSigningFixture(): Promise<{
  readonly privateJwk: JsonWebKey;
  readonly publicJwk: OidcTestJwk;
  readonly kid: string;
}> {
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
  const kid = crypto.randomUUID();
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const exportedPublicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const publicJwk: OidcTestJwk = { ...exportedPublicJwk, kid, alg: 'RS256', use: 'sig' };
  return { privateJwk, publicJwk, kid };
}

async function signJwt(
  privateJwk: JsonWebKey,
  payload: Record<string, unknown>,
  kid: string,
): Promise<string> {
  const encodedHeader = encodeJson({ alg: 'RS256', typ: 'JWT', kid });
  const encodedPayload = encodeJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function withOidcServer(
  responses: { readonly keys?: unknown; readonly token?: unknown },
  run: (serverUrl: string) => Promise<void>,
): Promise<void> {
  const server = await startFetchServer((request) => {
    const path = new URL(request.url).pathname;
    if (path === '/jwks') return Response.json({ keys: responses.keys ?? [] });
    if (path === '/token') return Response.json(responses.token ?? {});
    return new Response('Not found', { status: 404 });
  });
  const address = new URL(server.origin);
  try {
    await run(`http://${address.hostname}:${address.port}`);
  } finally {
    await server.close();
  }
}

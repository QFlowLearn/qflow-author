import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import {
  auditLogs,
  authIdentities,
  authSessions,
  oidcLoginStates,
  oidcTenantConfigs,
  organizationMemberships,
  passwordResetEmailDeliveries,
  passwordResetTokens,
  ssoDomainRoutes,
  ssoDomainVerifications,
  tenantDomains,
  tenants,
  userPasswords,
  users,
  userSettingsTable,
} from '../../lib/db/schema.ts';
import { hashAuthToken, hashPassword, verifyPassword } from '../../lib/services/auth_crypto.ts';
import { getSessionByToken } from '../../lib/services/auth_sessions.ts';
import { readCookieValue } from '../../lib/http/cookies.ts';
import { withEnrichmentWorkspace } from '../helpers/enrichment_workspace.ts';
import { withWorkerHttpSession } from '../helpers/worker_http_fixture.ts';

it(
  'built Worker owns password API sessions, reset consumption and closed SSO boundaries',
  async () => {
    try {
      await withEnrichmentWorkspace(async (auth) => {
        const password = 'API initial password phrase 2026';
        const changed = 'API changed password phrase 2026';
        const reset = 'API reset password phrase 2026';
        const [user] = await db.select().from(users).where(eq(users.id, auth.userId));
        if (!user) throw new Error('Expected isolated user.');
        await db.insert(userPasswords).values({
          userId: auth.userId,
          passwordHash: await hashPassword(password),
        });
        await db.insert(authIdentities).values({
          id: crypto.randomUUID(),
          userId: auth.userId,
          provider: 'local',
          providerId: user.email,
          email: user.email,
        });
        try {
          await withWorkerHttpSession(auth, 55920, async (app) => {
            const request = (path: string, body?: unknown, cookie?: string, method = 'POST') =>
              fetch(app.baseUrl + path, {
                method,
                redirect: 'manual',
                headers: {
                  origin: app.baseUrl,
                  'content-type': 'application/json',
                  ...(cookie ? { cookie } : {}),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
              });
            for (const path of ['/api/auth/login', '/api/auth/signup']) {
              for (
                const body of [[], { email: {}, password }, { email: user.email, password: [] }]
              ) {
                const response = await request(path, body);
                expect(response.status).toBe(400);
                expect(await response.json()).toEqual({ error: 'Invalid payload.' });
              }
              const unsupported = await request(path, undefined, undefined, 'GET');
              expect(unsupported.status).toBe(405);
              expect(unsupported.headers.get('allow')).toBe('POST');
              await unsupported.body?.cancel();
            }
            const formLogin = await fetch(app.baseUrl + '/api/auth/login', {
              method: 'POST',
              headers: { origin: app.baseUrl },
              redirect: 'manual',
              body: new URLSearchParams({ email: user.email, password }),
            });
            expect(formLogin.status).toBe(200);
            await formLogin.body?.cancel();
            const formToken =
              readCookieValue(formLogin.headers.getSetCookie().join('; '), 'qflow_session').value;
            if (!formToken) throw new Error('Expected form login session.');
            const signedIn = await request(
              '/api/auth/login',
              { email: user.email, password },
              `qflow_session=${encodeURIComponent(formToken)}`,
            );
            expect(await getSessionByToken(formToken)).toBeNull();
            expect(signedIn.status).toBe(200);
            expect(await signedIn.json()).toMatchObject({
              ok: true,
              userId: auth.userId,
              tenantId: auth.tenantId,
            });
            expect(signedIn.headers.getSetCookie()).toHaveLength(2);
            const token =
              readCookieValue(signedIn.headers.getSetCookie().join('; '), 'qflow_session').value;
            if (!token) throw new Error('Expected password API session.');
            const cookie = `qflow_session=${encodeURIComponent(token)}`;
            const denied = await request('/api/auth/password/change', {
              currentPassword: 'Incorrect phrase',
              newPassword: changed,
            }, cookie);
            expect(denied.status).toBe(401);
            await denied.body?.cancel();
            expect(await getSessionByToken(token)).not.toBeNull();
            const change = await request('/api/auth/password/change', {
              currentPassword: password,
              newPassword: changed,
            }, cookie);
            expect(change.status).toBe(200);
            expect(await change.json()).toEqual({ ok: true });
            expect(await getSessionByToken(token)).toBeNull();
            const changedToken =
              readCookieValue(change.headers.getSetCookie().join('; '), 'qflow_session').value;
            if (!changedToken) throw new Error('Expected replacement session.');
            const ownerCookie = `qflow_session=${encodeURIComponent(changedToken)}`;
            for (
              const path of ['/api/sso/oidc', '/api/sso/policy', '/api/sso/domain-verification']
            ) {
              const response = await request(path, undefined, ownerCookie, 'GET');
              expect(response.status, path).toBe(200);
              await response.body?.cancel();
              const malformed = await request(path, { unexpected: true }, ownerCookie, 'PATCH');
              expect(malformed.status, path).toBe(400);
              expect(await malformed.json()).toMatchObject({ code: 'invalid_payload' });
            }
            const policy = await request(
              '/api/sso/policy',
              { loginPolicy: 'allow_password', domainRoutes: [] },
              ownerCookie,
              'PUT',
            );
            expect(policy.status).toBe(200);
            expect(await policy.json()).toEqual({
              loginPolicy: 'allow_password',
              domainRoutes: [],
            });
            const configured = await request(
              '/api/sso/oidc',
              {
                google: {
                  enabled: false,
                  clientId: 'isolated-client',
                  clientSecret: 'isolated-secret',
                },
              },
              ownerCookie,
              'PATCH',
            );
            expect(configured.status).toBe(200);
            const configText = await configured.text();
            expect(configText).not.toContain('isolated-secret');
            expect(configText).toContain('isolated-client');
            const challenge = await request(
              '/api/sso/domain-verification',
              { action: 'prepare', domain: 'isolated.example.test' },
              ownerCookie,
              'PATCH',
            );
            expect(challenge.status).toBe(200);
            expect(await challenge.json()).toMatchObject({
              record: { domain: 'isolated.example.test' },
            });
            const enabled = await request(
              '/api/sso/oidc',
              { google: { enabled: true } },
              ownerCookie,
              'PATCH',
            );
            expect(enabled.status).toBe(200);
            await enabled.body?.cancel();
            await db.insert(tenantDomains).values({
              id: crypto.randomUUID(),
              tenantId: auth.tenantId,
              domain: '127.0.0.1',
            });
            const start = await request(
              '/auth/oidc/google?next=%2Fitems',
              undefined,
              undefined,
              'GET',
            );
            expect(start.status).toBe(302);
            const location = start.headers.get('location');
            if (!location) throw new Error('Expected OIDC authorization URL.');
            const authorization = new URL(location);
            expect(authorization.hostname).toBe('accounts.google.com');
            expect(authorization.searchParams.get('redirect_uri')).toBe(
              app.baseUrl + '/auth/oidc/callback',
            );
            expect(authorization.searchParams.get('client_id')).toBe('isolated-client');
            const state = authorization.searchParams.get('state');
            expect(state).toBeTruthy();
            const callbackPath = '/auth/oidc/callback?state=' + encodeURIComponent(state ?? '') +
              '&error=access_denied&error_description=attacker';
            const cancelled = await request(callbackPath, undefined, undefined, 'GET');
            expect(cancelled.headers.get('location')).toBe(
              '/login?error=authorization_failed&next=%2Fitems',
            );
            const replay = await request(callbackPath, undefined, undefined, 'GET');
            expect(replay.headers.get('location')).toBe('/login?error=login_state_expired');
            await db.delete(tenantDomains).where(eq(tenantDomains.tenantId, auth.tenantId));
            await db.update(organizationMemberships).set({ role: 'instructor' }).where(
              eq(organizationMemberships.userId, auth.userId),
            );
            for (
              const path of ['/api/sso/oidc', '/api/sso/policy', '/api/sso/domain-verification']
            ) {
              const forbidden = await request(path, undefined, ownerCookie, 'GET');
              expect(forbidden.status).toBe(403);
              await forbidden.body?.cancel();
            }
            const unknown = await request('/api/auth/password/reset/request', {
              email: `missing-${user.email}`,
            });
            const known = await request('/api/auth/password/reset/request', { email: user.email });
            expect(known.status).toBe(202);
            expect(unknown.status).toBe(202);
            expect(known.headers.get('cache-control')).toBe('no-store');
            expect(known.headers.get('referrer-policy')).toBe('no-referrer');
            expect(await known.text()).toBe(await unknown.text());
            const resetToken = 'api-reset-' + crypto.randomUUID();
            const resetTokenId = crypto.randomUUID();
            await db.insert(passwordResetTokens).values({
              id: resetTokenId,
              userId: auth.userId,
              tokenHash: await hashAuthToken(resetToken),
              expiresAt: new Date(Date.now() + 60000),
            });
            await db.insert(passwordResetEmailDeliveries).values({
              id: crypto.randomUUID(),
              resetTokenId,
              userId: auth.userId,
              tenantId: auth.tenantId,
              email: user.email,
              interfaceLocale: 'en-US' as const,
              encryptedToken: null,
              deliveredAt: new Date(),
            });
            const confirmed = await request('/api/auth/password/reset/confirm', {
              token: resetToken,
              password: reset,
            });
            expect(confirmed.status).toBe(200);
            expect(await confirmed.json()).toEqual({ ok: true });
            const reused = await request('/api/auth/password/reset/confirm', {
              token: resetToken,
              password: reset,
            });
            expect(reused.status).toBe(400);
            await reused.body?.cancel();
            expect(await getSessionByToken(changedToken)).toBeNull();
            const [stored] = await db.select().from(userPasswords).where(
              eq(userPasswords.userId, auth.userId),
            );
            expect(await verifyPassword(reset, stored?.passwordHash ?? '')).toBe(true);
            for (
              const [path, location] of [
                [
                  '/auth/oidc/callback?error=access_denied&error_description=attacker',
                  '/login?error=missing_authorization_response',
                ],
                ['/auth/oidc/callback?state=unknown', '/login?error=login_state_expired'],
              ]
            ) {
              const response = await request(path, undefined, undefined, 'GET');
              expect(response.status).toBe(302);
              expect(response.headers.get('location')).toBe(location);
            }
            const missingProvider = await request(
              '/auth/oidc/unknown',
              undefined,
              undefined,
              'GET',
            );
            expect(missingProvider.status).toBe(404);
            await missingProvider.body?.cancel();
            const blocked = await fetch(app.baseUrl + '/api/auth/login', {
              method: 'POST',
              headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
              body: JSON.stringify({ email: user.email, password: reset }),
              redirect: 'manual',
            });
            expect(blocked.status).toBe(403);
            await blocked.body?.cancel();
          });
        } finally {
          await db.delete(auditLogs).where(eq(auditLogs.tenantId, auth.tenantId));
          await db.delete(passwordResetEmailDeliveries).where(
            eq(passwordResetEmailDeliveries.userId, auth.userId),
          );
          await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, auth.userId));
          await db.delete(oidcLoginStates).where(eq(oidcLoginStates.tenantId, auth.tenantId));
          await db.delete(tenantDomains).where(eq(tenantDomains.tenantId, auth.tenantId));
          await db.delete(oidcTenantConfigs).where(eq(oidcTenantConfigs.tenantId, auth.tenantId));
          await db.delete(ssoDomainRoutes).where(eq(ssoDomainRoutes.tenantId, auth.tenantId));
          await db.delete(ssoDomainVerifications).where(
            eq(ssoDomainVerifications.tenantId, auth.tenantId),
          );
          await db.delete(authIdentities).where(eq(authIdentities.userId, auth.userId));
          await db.delete(userPasswords).where(eq(userPasswords.userId, auth.userId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
  45000,
);

it(
  'built Worker creates a password signup account and returns session and locale cookies',
  async () => {
    const email = `api-signup-${crypto.randomUUID()}@example.test`;
    let userId: string | undefined;
    let tenantId: string | undefined;
    try {
      await withEnrichmentWorkspace(async (auth) => {
        await withWorkerHttpSession(auth, 55921, async (app) => {
          const response = await fetch(app.baseUrl + '/api/auth/signup', {
            method: 'POST',
            headers: { origin: app.baseUrl, 'content-type': 'application/json' },
            body: JSON.stringify({
              email,
              password: 'Signup password phrase 2026',
              name: 'API Signup',
            }),
            redirect: 'manual',
          });
          const [created] = await db.select().from(users).where(eq(users.emailNormalized, email));
          userId = created?.id;
          if (userId) {
            const [membership] = await db.select().from(organizationMemberships).where(
              eq(organizationMemberships.userId, userId),
            );
            tenantId = membership?.tenantId;
          }
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({ ok: true, userId, tenantId });
          expect(response.headers.getSetCookie()).toHaveLength(2);
          const token =
            readCookieValue(response.headers.getSetCookie().join('; '), 'qflow_session').value;
          expect(token).toBeTruthy();
          expect(token && await getSessionByToken(token)).toMatchObject({ userId, tenantId });
        });
      });
    } finally {
      if (userId) {
        await db.delete(auditLogs).where(eq(auditLogs.targetUserId, userId));
        await db.delete(authSessions).where(eq(authSessions.userId, userId));
        await db.delete(authIdentities).where(eq(authIdentities.userId, userId));
        await db.delete(userPasswords).where(eq(userPasswords.userId, userId));
        await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, userId));
        await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
      if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
      await shutdownDb();
    }
  },
  30000,
);

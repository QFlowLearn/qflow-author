import { startBuiltWorker } from '../../tools/start_built_worker.ts';
import { builtWorkerBrowserEnvironment } from '../helpers/built_worker_environment.ts';
import { assertNoBlockingA11y } from '../helpers/browser_accessibility.ts';

import { expect, it } from 'vitest';
import { eq, or } from 'drizzle-orm';
import { chromium } from 'playwright';
import { safeErrorSummary } from '../../lib/error_summary.ts';
import { getDb, shutdownDb } from '../../lib/db.ts';
import {
  auditLogs,
  authIdentities,
  authSessions,
  organizationMemberships,
  passwordResetEmailDeliveries,
  passwordResetTokens,
  tenants,
  userPasswords,
  users,
  userSettingsTable,
} from '../../lib/db/schema.ts';
import { hashAuthToken, hashPassword, verifyPassword } from '../../lib/services/auth_crypto.ts';
import { requireQaDatabaseUrl } from '../helpers/qa_database.ts';

it(
  'uses real PostgreSQL and Chromium for Hono login, native settings, account hydration and reset',
  async () => {
    const databaseUrl = requireQaDatabaseUrl(process.env.DATABASE_URL);
    const database = getDb({ bindings: { DATABASE_URL: databaseUrl } });
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const email = `hono-auth-${userId}@example.test`;
    const password = 'Initial Hono password 2026';
    const replacement = 'Replacement Hono password 2026';
    const token = 'hono-reset-' + crypto.randomUUID();
    const runtime = await startBuiltWorker({
      mode: 'qa',
      databaseUrl,
      bindings: builtWorkerBrowserEnvironment,
    });
    const post = (path: string, values: Record<string, string>) =>
      runtime.dispatchFetch('https://app.example.test' + path, {
        method: 'POST',
        headers: { origin: 'https://app.example.test', 'accept-language': 'sv-SE' },
        body: new URLSearchParams(values),
        redirect: 'manual',
      });
    try {
      await database.insert(tenants).values({
        id: tenantId,
        slug: 'hono-' + userId,
        name: 'Hono fixture',
      });
      await database.insert(users).values({ id: userId, email, emailNormalized: email });
      await database.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'owner',
      });
      await database.insert(userPasswords).values({
        userId,
        passwordHash: await hashPassword(password),
      });
      await database.insert(authIdentities).values({
        id: crypto.randomUUID(),
        userId,
        provider: 'local',
        providerId: email,
        email,
      });
      await database.insert(userSettingsTable).values({
        userId,
        settings: { interfaceLocale: 'sv-SE' },
      });
      const loginPage = await runtime.dispatchFetch(
        'https://app.example.test/login?next=%2Fassessments%2Ffixture',
      );
      expect(loginPage.status).toBe(200);
      expect(await loginPage.text()).toContain('name="next" value="/assessments/fixture"');
      const login = await post('/login', {
        action: 'password',
        email,
        password,
        next: '/assessments/fixture',
      });
      expect(login.status).toBe(302);
      expect(login.headers.get('location')).toBe('/assessments/fixture');
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
      expect(cookie).toMatch(/^qflow_session=/);
      expect(await database.select().from(authSessions).where(eq(authSessions.userId, userId)))
        .toHaveLength(1);
      if (!cookie) throw new Error('Missing session cookie.');
      const me = await runtime.dispatchFetch('https://app.example.test/api/me', {
        headers: { cookie },
      });
      expect(me.status).toBe(200);
      expect(await me.json()).toMatchObject({ user: { id: userId }, role: 'owner' });
      for (
        const [path, method, allow] of [
          ['/api/settings', 'POST', 'GET, PUT, PATCH'],
          ['/api/auth/logout', 'GET', 'POST'],
          ['/api/sso/domain-verification', 'DELETE', 'GET, PATCH, PUT'],
          ['/api/sso/policy', 'DELETE', 'GET, PATCH, PUT'],
          ['/api/sso/oidc', 'DELETE', 'GET, PATCH'],
        ]
      ) {
        const unsupported = await runtime.dispatchFetch('https://app.example.test' + path, {
          method,
          headers: { cookie, origin: 'https://app.example.test' },
        });
        expect(unsupported.status).toBe(405);
        expect(unsupported.headers.get('allow')).toBe(allow);
        await unsupported.body?.cancel();
      }
      const returning = await runtime.dispatchFetch('https://app.example.test/login', {
        headers: { cookie },
        redirect: 'manual',
      });
      expect(returning.status).toBe(302);
      expect(returning.headers.get('location')).toBe('/assessments');
      const malformed = await runtime.dispatchFetch('https://app.example.test/login', {
        headers: { cookie: 'qflow_session=%ZZ', 'accept-language': 'es-ES' },
      });
      expect(malformed.status).toBe(200);
      expect(malformed.headers.getSetCookie()).toEqual(expect.arrayContaining([
        expect.stringContaining('qflow_session=;'),
        expect.stringContaining('qflow-locale=es-ES;'),
      ]));
      await malformed.body?.cancel();
      await database.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
        eq(organizationMemberships.userId, userId),
      );
      const readOnly = await runtime.dispatchFetch('https://app.example.test/items', {
        method: 'POST',
        headers: { cookie, origin: 'https://app.example.test' },
        redirect: 'manual',
      });
      expect(readOnly.status).toBe(403);
      await readOnly.body?.cancel();
      await database.update(organizationMemberships).set({ role: 'owner' }).where(
        eq(organizationMemberships.userId, userId),
      );
      const settings = await runtime.dispatchFetch('https://app.example.test/settings', {
        headers: { cookie, 'accept-language': 'en-US' },
      });
      expect(settings.status).toBe(200);
      expect(settings.headers.get('content-language')).toBe('sv-SE');
      expect(await settings.text()).toContain('data-qflow-root="AccountMenu"');
      const head = await runtime.dispatchFetch('https://app.example.test/settings', {
        method: 'HEAD',
        headers: { cookie },
      });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      const wrongMethod = await runtime.dispatchFetch('https://app.example.test/settings', {
        method: 'PUT',
        headers: { cookie, origin: 'https://app.example.test' },
      });
      expect(wrongMethod.status).toBe(405);
      await wrongMethod.body?.cancel();
      const browser = await chromium.launch({ headless: true });
      try {
        const baseUrl = (await runtime.ready).origin;
        const sessionCookie = {
          name: 'qflow_session',
          value: cookie.slice(cookie.indexOf('=') + 1),
          url: baseUrl,
          httpOnly: true,
          sameSite: 'Lax' as const,
        };
        const native: import('playwright').BrowserContext = await browser.newContext({
          javaScriptEnabled: false,
        });
        await native.addCookies([sessionCookie]);
        const formPage = await native.newPage();
        formPage.setDefaultTimeout(5_000);
        expect((await formPage.goto(baseUrl + '/settings'))?.status()).toBe(200);
        expect(await formPage.locator('html').getAttribute('lang')).toBe('sv-SE');
        await formPage.locator('input[name="displayName"]').fill('Hono Author');
        await formPage.locator('input[name="theme"][value="wireframe"]').check();
        expect(
          await formPage.locator('form.ds-card :invalid').evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('name'))
          ),
        ).toEqual([]);
        const [submission] = await Promise.all([
          formPage.waitForResponse((response) =>
            new URL(response.url()).pathname === '/settings' &&
            response.request().method() === 'POST'
          ),
          formPage.locator('form.ds-card button[type="submit"]').press('Enter'),
        ]);
        expect(submission.status()).toBe(302);
        await formPage.waitForURL(baseUrl + '/settings?success=1');
        expect(await formPage.locator('input[name="displayName"]').inputValue()).toBe(
          'Hono Author',
        );
        expect(await formPage.locator('#qf-account-menu').getAttribute('data-qflow-state')).toBe(
          'pending',
        );
        await native.close();

        const context: import('playwright').BrowserContext = await browser.newContext();
        await context.addCookies([sessionCookie]);
        const browserPage: import('playwright').Page = await context.newPage();
        browserPage.setDefaultTimeout(5_000);
        const failures: string[] = [];
        browserPage.on('pageerror', (cause) => failures.push(safeErrorSummary(cause)));
        browserPage.on('requestfailed', (request) => {
          if (request.resourceType() === 'script') failures.push('script_failed');
        });
        await browserPage.goto(baseUrl + '/settings');
        await browserPage.waitForFunction(() =>
          document.querySelector('#qf-account-menu')?.getAttribute('data-qflow-state') === 'ready'
        );
        await browserPage.getByRole('button', { name: 'Hono Author' }).waitFor();
        const toggle = browserPage.locator('#qf-account-menu input.theme-controller');
        await browserPage.getByRole('button', { name: 'Hono Author' }).click();
        const updated = browserPage.waitForResponse((response) =>
          response.url() === baseUrl + '/api/settings' && response.request().method() === 'PUT'
        );
        await toggle.check();
        expect((await updated).status()).toBe(200);
        expect(await browserPage.locator('html').getAttribute('data-theme')).toBe('dark');
        await assertNoBlockingA11y(browserPage);
        expect(failures).toEqual([]);
        await context.close();
        const anonymous: import('playwright').BrowserContext = await browser.newContext();
        const publicPage = await anonymous.newPage();
        publicPage.setDefaultTimeout(5_000);
        for (
          const path of [
            '/login',
            '/password/forgot',
            '/password/reset?token=fixture-not-a-real-secret',
          ]
        ) {
          expect((await publicPage.goto(baseUrl + path))?.status()).toBe(200);
          await assertNoBlockingA11y(publicPage);
        }
        await anonymous.close();
      } finally {
        await browser.close();
      }
      const saved = await database.select().from(userSettingsTable).where(
        eq(userSettingsTable.userId, userId),
      );
      expect(saved[0]?.settings).toMatchObject({ theme: 'dark', interfaceLocale: 'sv-SE' });
      const requested = await post('/password/forgot', { email });
      expect(requested.status).toBe(200);
      expect(requested.headers.get('cache-control')).toBe('no-store');
      await requested.body?.cancel();
      expect(
        await database.select().from(passwordResetTokens).where(
          eq(passwordResetTokens.userId, userId),
        ),
      ).toHaveLength(1);
      const resetTokenId = crypto.randomUUID();
      await database.insert(passwordResetTokens).values({
        id: resetTokenId,
        userId,
        tokenHash: await hashAuthToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await database.insert(passwordResetEmailDeliveries).values({
        id: crypto.randomUUID(),
        resetTokenId,
        userId,
        tenantId,
        email,
        interfaceLocale: 'sv-SE',
        encryptedToken: null,
        deliveredAt: new Date(),
      });
      const resetBrowser = await chromium.launch();
      try {
        const page = await resetBrowser.newPage({ javaScriptEnabled: false, locale: 'sv-SE' });
        page.setDefaultTimeout(5_000);
        const origin = (await runtime.ready).origin;
        await page.goto(origin + '/password/reset?token=' + encodeURIComponent(token));
        await page.locator('input[name="password"]').fill(replacement);
        const [reset] = await Promise.all([
          page.waitForResponse((response) => response.request().method() === 'POST'),
          page.locator('form.ds-card button[type="submit"]').press('Enter'),
        ]);
        expect(reset.status()).toBe(200);
        expect(reset.headers()['content-language']).toBe('sv-SE');
        expect(await reset.text()).not.toContain('id="new-password"');
      } finally {
        await resetBrowser.close();
      }
      const passwords = await database.select().from(userPasswords).where(
        eq(userPasswords.userId, userId),
      );
      expect(passwords[0]).toBeDefined();
      expect(await verifyPassword(replacement, passwords[0]?.passwordHash ?? '')).toBe(true);
      const revoked = await database.select().from(authSessions).where(
        eq(authSessions.userId, userId),
      );
      expect(revoked).toHaveLength(1);
      expect(revoked.every((session) => session.revokedAt !== null)).toBe(true);
      const expiredLogin = await runtime.dispatchFetch('https://app.example.test/login', {
        headers: { cookie },
        redirect: 'manual',
      });
      expect(expiredLogin.status).toBe(200);
      expect(await expiredLogin.text()).toContain('id="current-password"');
      const replacementLogin = await post('/login', {
        action: 'password',
        email,
        password: replacement,
      });
      expect(replacementLogin.status).toBe(302);
      const replacementCookie = replacementLogin.headers.get('set-cookie')?.split(';', 1)[0];
      if (!replacementCookie) throw new Error('Missing replacement session cookie.');
      const logout = await runtime.dispatchFetch('https://app.example.test/api/auth/logout', {
        method: 'POST',
        headers: {
          cookie: replacementCookie,
          origin: 'https://app.example.test',
          'cf-connecting-ip': '203.0.113.1',
        },
      });
      expect(logout.status).toBe(204);
      expect(logout.headers.get('set-cookie')).toContain('qflow_session=;');
      const logoutEvents = await database.select().from(auditLogs).where(
        eq(auditLogs.actorUserId, userId),
      );
      expect(
        logoutEvents.filter((event) => event.action === 'logout').map((event) => event.ipAddress),
      ).toEqual([null]);
    } finally {
      await runtime.dispose();
      try {
        await database.delete(auditLogs).where(
          or(eq(auditLogs.actorUserId, userId), eq(auditLogs.targetUserId, userId)),
        );
        await database.delete(passwordResetEmailDeliveries).where(
          eq(passwordResetEmailDeliveries.userId, userId),
        );
        await database.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
        await database.delete(authSessions).where(eq(authSessions.userId, userId));
        await database.delete(authIdentities).where(eq(authIdentities.userId, userId));
        await database.delete(userSettingsTable).where(eq(userSettingsTable.userId, userId));
        await database.delete(userPasswords).where(eq(userPasswords.userId, userId));
        await database.delete(organizationMemberships).where(
          eq(organizationMemberships.userId, userId),
        );
        await database.delete(users).where(eq(users.id, userId));
        await database.delete(tenants).where(eq(tenants.id, tenantId));
      } finally {
        await shutdownDb();
      }
    }
  },
  30_000,
);

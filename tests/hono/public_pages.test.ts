import { expect, it } from 'vitest';
import { chromium } from 'playwright';
import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import { organizationMemberships, users, userSettingsTable } from '../../lib/db/schema.ts';
import { startBuiltAppServer } from '../../tools/built_app_server.ts';
import { builtWorkerBrowserEnvironment } from '../helpers/built_worker_environment.ts';
import { requireQaDatabaseUrl } from '../helpers/qa_database.ts';
import { cleanupAuthTestAccount } from '../auth_test_fixture.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { createI18n } from '../../lib/i18n/messages.ts';
import { buildMigrationQaReport } from '../../lib/import/migration_qa_report.ts';
import { SAMPLE_QTI_MIGRATION_RUN } from '../../lib/sample_migration_report.ts';
import { assertNoBlockingA11y } from '../helpers/browser_accessibility.ts';

it(
  'public pages retain localized SSR, native signup/onboarding and locale/download protocols',
  async () => {
    const databaseUrl = requireQaDatabaseUrl(process.env.DATABASE_URL);
    const email = `native-signup-${crypto.randomUUID()}@example.test`;
    const app = await startBuiltAppServer({
      mode: 'qa',
      cwd: process.cwd(),
      port: 55922,
      environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let userId: string | null = null;
    let tenantId: string | null = null;
    const request = (path: string, init?: RequestInit) =>
      fetch(app.baseUrl + path, { ...init, redirect: 'manual' });
    try {
      const root = await request('/');
      expect(root.status).toBe(302);
      expect(root.headers.get('location')).toBe('/login');
      for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
        const i18n = createI18n(locale, catalogForLocale(locale));
        for (
          const [path, title] of [
            ['/signup', 'signup.title'],
            ['/help/portability', 'help.portability.title'],
            ['/help/qti-fidelity', 'help.fidelity.title'],
            ['/help/qti3-import', 'help.qti3.title'],
            ['/help/qti-sample-report', 'help.sampleReport.title'],
          ] as const
        ) {
          const response = await request(path, { headers: { 'accept-language': locale } });
          expect(response.status, path).toBe(200);
          expect(response.headers.get('content-language')).toBe(locale);
          expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
          expect(await response.text()).toContain(i18n.t(title));
          const head = await request(path, {
            method: 'HEAD',
            headers: { 'accept-language': locale },
          });
          expect(head.status).toBe(200);
          expect(await head.text()).toBe('');
        }
      }
      const unsupported = await request('/api/locale');
      expect(unsupported.status).toBe(405);
      expect(unsupported.headers.get('allow')).toBe('POST');
      expect(await unsupported.json()).toEqual({ code: 'method_not_allowed' });
      const duplicate = await request('/api/locale', {
        method: 'POST',
        headers: { origin: app.baseUrl },
        body: new URLSearchParams([['locale', 'en-US'], ['locale', 'sv-SE']]),
      });
      expect(duplicate.status).toBe(400);
      expect(await duplicate.json()).toEqual({ code: 'invalid_locale_form' });
      const artifact = await request('/help/qti-sample-report?download=qa-report', {
        headers: { 'accept-language': 'sv-SE' },
      });
      expect(artifact.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(artifact.headers.get('content-disposition')).toContain('attachment;');
      expect(
        (await artifact.text()).replace(/^Generated: .*$/m, 'Generated: 1970-01-01T00:00:00.000Z'),
      ).toBe(buildMigrationQaReport(SAMPLE_QTI_MIGRATION_RUN, new Date(0)));
      browser = await chromium.launch();
      const login: import('playwright').Page = await browser.newPage();
      const loginScripts: string[] = [];
      login.on('request', (req) => {
        if (req.resourceType() === 'script') loginScripts.push(req.url());
      });
      await login.goto(app.baseUrl + '/login', { waitUntil: 'networkidle' });
      expect(loginScripts.some((url) => /bootstrap-[\w-]+\.js/.test(url))).toBe(true);
      expect(
        loginScripts.some((url) =>
          /AssessmentBuilder|assessment_blueprint|BankOverview|QtiItemPreview|ImportProgress/.test(
            url,
          )
        ),
      ).toBe(false);
      expect(await login.locator('link[rel="modulepreload"]').count()).toBeLessThan(5);
      await login.close();
      const native: import('playwright').BrowserContext = await browser.newContext({
        javaScriptEnabled: false,
        locale: 'sv-SE',
      });
      const page = await native.newPage();
      page.setDefaultTimeout(10000);
      await page.goto(app.baseUrl + '/signup?next=%2Fonboarding');
      expect(await page.locator('h1').textContent()).toBe(
        createI18n('sv-SE', catalogForLocale('sv-SE')).t('signup.title'),
      );
      await page.locator('#interface-locale').selectOption('en-GB');
      const [localeResponse] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === '/api/locale'),
        page.locator('form[action="/api/locale"] button').press('Enter'),
      ]);
      expect(localeResponse.status()).toBe(303);
      await page.waitForURL((url) => url.pathname === '/login');
      // The explicitly supplied return path is authenticated; signed-out visitors go to login.
      expect(new URL(page.url()).pathname).toBe('/login');
      expect(await native.cookies()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'qflow-locale', value: 'en-GB' })]),
      );
      await page.goto(app.baseUrl + '/signup?next=%2Fonboarding');
      await page.locator('#signup-name').fill('Native signup');
      await page.locator('#signup-email').fill(email);
      await page.locator('#new-password').fill('Native signup password phrase 2026');
      await Promise.all([
        page.waitForURL('**/onboarding'),
        page.locator('form:not([action]) button[type="submit"]').press('Enter'),
      ]);
      const [created] = await db.select().from(users).where(eq(users.emailNormalized, email));
      userId = created?.id ?? null;
      if (userId) {
        const [membership] = await db.select().from(organizationMemberships).where(
          eq(organizationMemberships.userId, userId),
        );
        tenantId = membership?.tenantId ?? null;
      }
      expect(userId).toBeTruthy();
      expect(await page.locator('h1').textContent()).toBe(
        createI18n('en-GB', catalogForLocale('en-GB')).t('help.onboarding.title'),
      );
      const cookie = (await native.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
      const blank = await request('/onboarding', {
        method: 'POST',
        headers: { cookie, origin: app.baseUrl },
        body: new URLSearchParams({ action: 'blank' }),
      });
      expect(blank.status).toBe(307);
      expect(blank.headers.get('location')).toBe('/assessments/new');
      const invalid = await request('/onboarding', {
        method: 'POST',
        headers: { cookie, origin: app.baseUrl },
        body: new URLSearchParams({ action: 'unknown' }),
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.text()).toContain(
        createI18n('en-GB', catalogForLocale('en-GB')).t('help.onboarding.unknownAction'),
      );
      const missing = await request('/help/unknown', { headers: { cookie } });
      expect(missing.status).toBe(404);
      expect(await missing.text()).toContain('href="/assessments"');
      await page.goto(app.baseUrl + '/help/qti-sample-report');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('a[href="/help/qti-sample-report?download=qa-report"]').press('Enter'),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.md$/);
      const hydrated: import('playwright').Page = await browser.newPage();
      await hydrated.goto(app.baseUrl + '/help/qti3-import');
      await assertNoBlockingA11y(hydrated);
      await native.close();
    } finally {
      await browser?.close();
      await app.close();
      if (!userId) {
        const [created] = await db.select().from(users).where(eq(users.emailNormalized, email));
        userId = created?.id ?? null;
        if (userId) {
          const [membership] = await db.select().from(organizationMemberships).where(
            eq(organizationMemberships.userId, userId),
          );
          tenantId = membership?.tenantId ?? null;
        }
      }
      if (userId) await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, userId));
      if (tenantId) await cleanupAuthTestAccount({ tenantId, userId });
      await shutdownDb();
    }
  },
  60000,
);

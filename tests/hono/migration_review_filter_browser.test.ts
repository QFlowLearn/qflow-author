import { expect, it } from 'vitest';

import { requireQaDatabaseUrl } from '../helpers/qa_database.ts';
import { builtWorkerBrowserEnvironment } from '../helpers/built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import { authSessions, userSettingsTable } from '../../lib/db/schema.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../../lib/settings.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../../tools/local_app_browser.ts';
import { withBankReviewImport } from '../helpers/bank_review_import.ts';

it(
  'bank import review filters with keyboard navigation, retains editor context and returns after rejection',
  async () => {
    const databaseUrl = requireQaDatabaseUrl(process.env.DATABASE_URL);
    try {
      await withBankReviewImport(async (ctx, runId) => {
        let app: LocalAppBrowser | undefined;
        try {
          await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5280, lastExclusive: 5290 },
              environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
            },
            headless: true,
          });
          const context: import('playwright').BrowserContext = await app.newContext({
            authSession: await createSession({ tenantId: ctx.tenantId, userId: ctx.userId }),
            browser: { viewport: { width: 1360, height: 1000 } },
          });
          const page: import('playwright').Page = await context.newPage();
          page.setDefaultTimeout(15000);
          await page.goto(`${app.baseUrl}/imports/${runId}`);
          const needsFixes = page.getByRole('link', { name: 'Needs fixes (61)', exact: true });
          await needsFixes.focus();
          await page.keyboard.press('Enter');
          await page.waitForURL((url) => url.searchParams.get('review') === 'blocked');
          expect(await page.locator('article[id^="item-"]').count()).toStrictEqual(50);
          await page.getByRole('link', { name: 'Next', exact: true }).click();
          await page.waitForURL((url) => url.searchParams.get('page') === '2');
          expect(await page.locator('article[id^="item-"]').count()).toStrictEqual(11);
          expect(new URL(page.url()).searchParams.get('review')).toStrictEqual('blocked');
          const first = page.locator('article[id^="item-"]').first();
          await first.getByRole('link', { name: 'Open in editor', exact: true }).click();
          await page.waitForURL((url) => url.searchParams.has('edit'));
          expect(new URL(page.url()).searchParams.get('page')).toStrictEqual('2');
          expect(new URL(page.url()).searchParams.get('review')).toStrictEqual('blocked');
          if (
            !(await page.locator('article[id^="item-"]').first().locator('details').getAttribute(
              'open',
            ) !== null)
          ) {
            expect.unreachable(
              "Expected await page.locator('article[id^=\"item-\"]').first().locator('details').getAttribute( 'open'",
            );
          }
          await page.evaluate(() => globalThis.scrollTo(0, 0));
          await page.screenshot({ path: '/tmp/qflow-review-desktop.png' });
          await page.setViewportSize({ width: 390, height: 844 });
          if (
            !(await page.evaluate(() =>
              document.documentElement.scrollWidth <= globalThis.innerWidth
            ))
          ) {
            expect.unreachable(
              'Expected await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth )',
            );
          }
          await page.getByRole('navigation', { name: 'Review questions', exact: true })
            .scrollIntoViewIfNeeded();
          await page.screenshot({ path: '/tmp/qflow-review-mobile.png' });
          await page.getByRole('checkbox', { name: 'Select Review question 111?', exact: true })
            .check();
          await page.getByRole('button', { name: 'Reject selected', exact: true }).click();
          await page.waitForURL((url) => !url.searchParams.has('edit'));
          await page.getByRole('link', { name: 'Needs fixes (60)', exact: true }).waitFor();
          expect(new URL(page.url()).searchParams.get('review')).toStrictEqual('blocked');
          expect(new URL(page.url()).searchParams.get('page')).toStrictEqual('2');
          expect(await page.locator('article[id^="item-"]').count()).toStrictEqual(10);
          await page.getByRole('link', { name: 'All questions (121)', exact: true }).click();
          await page.waitForURL((url) => !url.searchParams.has('review'));
          expect(await page.locator('article[id^="item-"]').count()).toStrictEqual(50);
        } finally {
          await app?.close();
          await db.delete(authSessions).where(eq(authSessions.userId, ctx.userId));
          await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, ctx.userId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
  90000,
);

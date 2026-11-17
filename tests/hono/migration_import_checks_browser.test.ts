import { expect, it } from 'vitest';

import { requireQaDatabaseUrl } from '../helpers/qa_database.ts';
import { builtWorkerBrowserEnvironment } from '../helpers/built_worker_environment.ts';
import { readFile } from 'node:fs/promises';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import { authSessions, userSettingsTable } from '../../lib/db/schema.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../../lib/settings.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../../tools/local_app_browser.ts';
import { getMigrationReviewPage } from '../../lib/services/migration_review_page.ts';
import { migrationCheckSource } from '../helpers/migration_check_source.ts';
import { withBankReviewSource } from '../helpers/bank_review_import.ts';

const assertStringIncludes = (actual: string, expected: string) => {
  if (!(actual.includes(expected))) expect.unreachable('Expected import report text was absent.');
};

it(
  'answer/media summary supports keyboard, full download, cross-page links and mobile layout',
  async () => {
    const databaseUrl = requireQaDatabaseUrl(process.env.DATABASE_URL);
    try {
      await withBankReviewSource(
        migrationCheckSource(),
        'respondus-standard',
        async (ctx, runId) => {
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
            const summary = page.locator('summary').filter({ hasText: 'Answer and media checks' });
            assertStringIncludes(await summary.innerText(), '61 questions with findings');
            await summary.focus();
            await page.keyboard.press('Enter');
            if (!(await summary.evaluate((e) => e.parentElement?.hasAttribute('open')))) {
              expect.unreachable(
                "Expected await summary.evaluate((e) => e.parentElement?.hasAttribute('open'))",
              );
            }
            await page.screenshot({ path: '/tmp/qflow-checks-desktop.png' });
            await page.setViewportSize({ width: 390, height: 844 });
            await summary.scrollIntoViewIfNeeded();
            if (
              !(await page.evaluate(() =>
                document.documentElement.scrollWidth <= globalThis.innerWidth
              ))
            ) {
              expect.unreachable(
                'Expected await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth )',
              );
            }
            await page.screenshot({ path: '/tmp/qflow-checks-mobile.png' });
            const pending = page.waitForEvent('download');
            await page.getByRole('link', { name: 'Download answer and media details', exact: true })
              .click();
            const download = await pending, path = await download.path();
            if (!path) expect.unreachable('Expected path');
            const report = await readFile(path, 'utf8');
            assertStringIncludes(
              report,
              'Questions with recorded findings: 61.',
            );
            assertStringIncludes(report, 'Answers referencing absent choices: 1 question');
            assertStringIncludes(report, 'Questions: 120.');
            assertStringIncludes(report, 'Questions: 121.');
            await page.getByRole('link', { name: 'Question 121', exact: true }).click();
            await page.waitForURL((url) =>
              url.searchParams.get('page') === '3' && url.hash.startsWith('#item-')
            );
            expect(await page.locator('article[id^="item-"]').count()).toStrictEqual(21);
            const target = page.locator(new URL(page.url()).hash);
            expect(await target.count()).toStrictEqual(1);
            const review = await getMigrationReviewPage(ctx, runId, 1, false);
            if (!review) expect.unreachable('Expected review');
            expect(review.run.reviewProgress).toStrictEqual({
              total: 121,
              pending: 121,
              accepted: 0,
              rejected: 0,
            });
            expect(review.importChecks?.affected).toStrictEqual(61);
          } finally {
            await app?.close();
            await db.delete(authSessions).where(eq(authSessions.userId, ctx.userId));
            await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, ctx.userId));
          }
        },
      );
    } finally {
      await shutdownDb();
    }
  },
  90000,
);

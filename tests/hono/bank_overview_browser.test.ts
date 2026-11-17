import { expect, it } from 'vitest';
import { assertNoBlockingA11y } from '../helpers/browser_accessibility.ts';
import { withWorkerHttpSession } from '../helpers/worker_http_fixture.ts';
import { requireQaDatabaseUrl } from '../helpers/qa_database.ts';

import { mkdir, writeFile } from 'node:fs/promises';
import { builtWorkerBrowserEnvironment } from '../helpers/built_worker_environment.ts';
import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import { questionRevisions, questions } from '../../lib/db/question_schema.ts';
import { saveQuestionRevisionFixture } from '../question_revision_fixture.ts';
import { authSessions, userSettingsTable } from '../../lib/db/schema.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../../lib/settings.ts';
import { BankEnrichmentStore } from '../../lib/services/bank_enrichment_store.ts';
import { enrichmentDefinitionFixture } from '../bank_enrichment_fixture.ts';
import { assignOverviewFixture } from '../helpers/enrichment_overview_fixture.ts';
import {
  addEnrichmentQuestions,
  withEnrichmentWorkspace,
} from '../helpers/enrichment_workspace.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../../tools/local_app_browser.ts';

it(
  'category breakdown filters, keyboard drill-down and narrow layouts use the real application',
  async () => {
    const databaseUrl = requireQaDatabaseUrl(process.env.DATABASE_URL);
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        let app: LocalAppBrowser | undefined;
        try {
          const ids = await addEnrichmentQuestions(ctx, 8);
          const schemeId = crypto.randomUUID(), versionId = crypto.randomUUID();
          if (
            !((await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, {
              id: versionId,
              schemeId,
              expectedVersion: 0,
              definition: enrichmentDefinitionFixture(),
            })).ok)
          ) {
            expect.unreachable(
              'Expected (await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, { id: versionId, sch',
            );
          }
          await assignOverviewFixture(ctx, schemeId, versionId, ids.slice(0, 5), {
            subject: { state: 'assigned', valueIds: ['life'] },
            topic: { state: 'assigned', valueIds: ['cells'] },
            difficulty: { state: 'assigned', valueIds: ['easy'] },
          });
          await assignOverviewFixture(ctx, schemeId, versionId, ids.slice(5), {
            subject: { state: 'assigned', valueIds: ['physical'] },
            topic: { state: 'assigned', valueIds: ['energy'] },
            difficulty: { state: 'assigned', valueIds: ['moderate'] },
          });
          await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5250, lastExclusive: 5260 },
              environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
            },
            headless: true,
          });
          const native: import('playwright').BrowserContext = await app.newContext({
            authSession: await createSession({ tenantId: ctx.tenantId, userId: ctx.userId }),
            browser: { javaScriptEnabled: false },
          });
          try {
            const nativePage = await native.newPage();
            await nativePage.goto(`${app.baseUrl}/items?view=overview&scheme=${schemeId}`);
            expect(
              await nativePage.locator('[data-qflow-root="BankOverview"]').getAttribute(
                'data-qflow-state',
              ),
            ).toStrictEqual('pending');
            expect(await nativePage.locator('#overview-topics-0').getAttribute('hidden'))
              .toStrictEqual('');
            expect(
              await nativePage.getByRole('button', { name: 'Topics in Life science', exact: true })
                .isDisabled(),
            ).toStrictEqual(true);
            expect(await nativePage.locator('#overview-topics-0 tr').count()).toStrictEqual(2);
            expect(await nativePage.getByRole('link', { name: 'Cells', exact: true }).count())
              .toStrictEqual(0);
            expect(
              await nativePage.locator('[data-qflow-root="BankOverview"] [data-qflow-root]')
                .count(),
            ).toStrictEqual(0);
            expect(
              await nativePage.locator('[data-qflow-root="BankOverview"] table').evaluate((table) =>
                [...table.children].every((node) =>
                  ['CAPTION', 'COLGROUP', 'THEAD', 'TBODY', 'TFOOT'].includes(node.tagName)
                )
              ),
            ).toStrictEqual(true);
          } finally {
            await native.close();
          }
          const browser: import('playwright').BrowserContext = await app.newContext({
            authSession: await createSession({ tenantId: ctx.tenantId, userId: ctx.userId }),
            browser: { viewport: { width: 1440, height: 1000 } },
          });
          const page: import('playwright').Page = await browser.newPage();
          page.setDefaultTimeout(20000);
          const screenshots: { path: string; data: Uint8Array }[] = [];
          const capture = async (path: string) => {
            screenshots.push({ path, data: await page.screenshot({ fullPage: true }) });
          };
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.name));
          await page.goto(`${app.baseUrl}/items?view=overview&pageSize=100&page=1`);
          await page.getByRole('heading', { name: 'Questions by subject and difficulty' })
            .waitFor();
          await page.getByText(
            'Choose a category set above to see how its questions are distributed.',
          )
            .waitFor();
          await capture('output/playwright/bank-overview-empty.png');
          await page.locator('[data-qflow-root=BankCategoryFilters] [data-hydrated="true"]')
            .waitFor();
          await page.locator('select[name="scheme"]').selectOption(schemeId);
          await page.waitForURL((url) =>
            url.searchParams.get('view') === 'overview' &&
            url.searchParams.get('scheme') === schemeId
          );
          await page.getByRole('link', {
            name: 'Open 5 questions: Life science / Easy',
            exact: true,
          }).waitFor();
          await page.goto(`${app.baseUrl}/items?scheme=${schemeId}`);
          await page.locator('select[name="subject"]').waitFor({ state: 'visible' });
          expect(
            await page.locator('select[name="subject"]').evaluate((node) =>
              !!node.closest('details')
            ),
          ).toStrictEqual(false);
          expect(await page.locator('tbody tr').count()).toStrictEqual(8);
          const overviewLink = page.getByRole('link', { name: 'Category breakdown', exact: true });
          await overviewLink.focus();
          await page.keyboard.press('Enter');
          await page.getByRole('heading', { name: 'Questions by subject and difficulty' })
            .waitFor();
          const cell = page.getByRole('link', {
            name: 'Open 5 questions: Life science / Easy',
            exact: true,
          });
          if (!(await cell.isVisible())) expect.unreachable('Expected await cell.isVisible()');
          await mkdir('output/playwright', { recursive: true });
          await capture('output/playwright/bank-overview-desktop.png');
          await assertNoBlockingA11y(page);
          const topics = page.getByRole('button', { name: 'Topics in Life science', exact: true });
          expect(await topics.getAttribute('aria-expanded')).toStrictEqual('false');
          expect(await page.getByRole('link', { name: 'Cells', exact: true }).count())
            .toStrictEqual(0);
          await topics.focus();
          await page.keyboard.press('Space');
          const topicLink = page.getByRole('link', { name: 'Cells', exact: true });
          await topicLink.waitFor({ state: 'visible' });
          expect(await topics.getAttribute('aria-expanded')).toStrictEqual('true');
          expect(await topics.evaluate((node) => document.activeElement === node)).toStrictEqual(
            true,
          );
          await capture('output/playwright/bank-topics-desktop.png');
          await page.setViewportSize({ width: 390, height: 844 });
          if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
            expect.unreachable(
              'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
            );
          }
          await capture('output/playwright/bank-topics-mobile.png');
          await topicLink.click();
          await page.getByRole('checkbox', { name: 'Select this page', exact: true }).waitFor();
          expect(await page.locator('tbody tr').count()).toStrictEqual(5);
          expect(new URL(page.url()).searchParams.get('topic')).toStrictEqual(`${versionId}:cells`);
          await page.getByRole('columnheader', { name: /Difficulty/ }).getByRole('link').click();
          await page.waitForURL((url) => url.searchParams.get('sort') === 'difficulty');
          expect(new URL(page.url()).searchParams.get('direction')).toStrictEqual('asc');
          expect(new URL(page.url()).searchParams.get('subject')).toStrictEqual(
            `${versionId}:life`,
          );
          expect(new URL(page.url()).searchParams.get('topic')).toStrictEqual(`${versionId}:cells`);
          expect(
            await page.getByRole('columnheader', { name: /Difficulty/ }).getAttribute('aria-sort'),
          ).toStrictEqual('ascending');
          await page.getByRole('columnheader', { name: /Difficulty/ }).getByRole('link').click();
          await page.waitForURL((url) => url.searchParams.get('direction') === 'desc');
          const cellsHref = await page.getByRole('link', { name: 'Cells', exact: true }).first()
            .getAttribute('href');
          if (!cellsHref) expect.unreachable('Cells drill-down link is missing');
          let releaseFilters: () => void = () => {};
          const filtersHeld = new Promise<void>((resolve) => {
            releaseFilters = resolve;
          });
          const bootstrapPattern = /\/assets\/bootstrap-[^/]+\.js$/;
          await page.route(bootstrapPattern, async (route) => {
            await filtersHeld;
            await route.continue();
          });
          try {
            await page.goto(new URL(cellsHref, app.baseUrl).href, { waitUntil: 'commit' });
            expect(new URL(page.url()).searchParams.get('sort')).toStrictEqual('difficulty');
            expect(new URL(page.url()).searchParams.get('topic')).toStrictEqual(
              `${versionId}:cells`,
            );
            // Native filter input made before hydration must survive module loading.
            await page.locator('select[name="scheme"]').selectOption('');
            releaseFilters();
            await page.locator('[data-qflow-root=BankCategoryFilters][data-qflow-state=ready]')
              .waitFor({ state: 'attached' });
            expect(await page.locator('select[name="scheme"]').inputValue()).toBe('');
            await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
            await page.waitForURL((url) => url.searchParams.get('scheme') === '');
          } finally {
            releaseFilters();
            await page.unroute(bootstrapPattern);
          }
          expect(new URL(page.url()).searchParams.has('sort')).toStrictEqual(false);
          await page.setViewportSize({ width: 1440, height: 1000 });
          await page.goto(`${app.baseUrl}/items?view=overview&scheme=${schemeId}`);
          await cell.waitFor({ state: 'visible' });
          await cell.focus();
          expect(await cell.evaluate((node) => node === document.activeElement)).toStrictEqual(
            true,
          );
          expect(
            new URL(await cell.getAttribute('href') ?? '', app.baseUrl).searchParams.get('subject'),
          ).toStrictEqual(`${versionId}:life`);
          await page.keyboard.press('Enter');
          await page.waitForURL((url) =>
            !url.searchParams.has('view') && url.searchParams.get('subject') === `${versionId}:life`
          );
          await page.getByRole('checkbox', { name: 'Select this page', exact: true }).waitFor();
          expect(await page.locator('tbody tr').count()).toStrictEqual(5);
          expect(new URL(page.url()).searchParams.get('subject')).toStrictEqual(
            `${versionId}:life`,
          );
          expect(await page.locator('select[name="difficulty"]').inputValue()).toStrictEqual(
            `${versionId}:easy`,
          );
          await page.getByRole('link', { name: 'Category breakdown', exact: true }).click();
          await page.getByRole('heading', { name: 'Questions by subject and difficulty' })
            .waitFor();
          await page.locator('[data-qflow-root=BankCategoryFilters] [data-hydrated="true"]')
            .waitFor();
          expect(new URL(page.url()).searchParams.get('difficulty')).toStrictEqual(
            `${versionId}:easy`,
          );
          await page.locator('select[name="subject"]').selectOption('');
          await page.waitForURL((url) => url.searchParams.get('subject') === '');
          await page.locator('[data-qflow-root=BankCategoryFilters] [data-hydrated="true"]')
            .waitFor();
          await page.locator('select[name="difficulty"]').selectOption('');
          await page.waitForURL((url) => url.searchParams.get('difficulty') === '');
          await page.getByRole('link', {
            name: 'Open 3 questions: Physical science / Moderate',
            exact: true,
          }).waitFor();
          expect(new URL(page.url()).searchParams.get('view')).toStrictEqual('overview');
          await page.setViewportSize({ width: 390, height: 844 });
          await capture('output/playwright/bank-overview-mobile.png');
          if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
            expect.unreachable('No page-level horizontal overflow.');
          }
          const tableRegion = page.getByRole('region', {
            name: 'Questions by subject and difficulty',
            exact: true,
          });
          await tableRegion.focus();
          await page.keyboard.press('ArrowRight');
          expect(await tableRegion.evaluate((node) => node === document.activeElement))
            .toStrictEqual(true);

          const [source] = await db.select().from(questionRevisions).where(
            eq(questionRevisions.questionId, ids[0]),
          );
          await saveQuestionRevisionFixture(ctx, {
            questionId: ids[0],
            title: 'Changed cell',
            body: { ...source.body, title: 'Changed cell' },
            tags: ['source-science'],
            qtiXml: source.qtiXml,
            provenance: { _tag: 'Revision', operation: 'revised', expectedParentRevision: 1 },
            draftState: 'published',
          });
          await page.goto(`${app.baseUrl}/items?view=overview&scheme=${schemeId}&subject=outdated`);
          await page.getByRole('link', {
            name: 'Open 1 question: Life science / Easy',
            exact: true,
          }).waitFor();
          const subject = page.locator('select[name="subject"]');
          expect(await subject.locator('option[value="pending"], option[value="outside"]').count())
            .toStrictEqual(0);
          if (
            !((await subject.locator(`option[value="${versionId}:life:outdated"]`).innerText())
              .endsWith('(1)'))
          ) {
            expect.unreachable(
              'Expected (await subject.locator(`option[value="${versionId}:life:outdated"]`).innerText()) .endsWit',
            );
          }
          await page.locator('[data-qflow-root=BankCategoryFilters] [data-hydrated="true"]')
            .waitFor();
          await subject.selectOption(`${versionId}:life:outdated`);
          await page.waitForURL((url) =>
            url.searchParams.get('subject') === `${versionId}:life:outdated`
          );
          await page.getByRole('link', {
            name: 'Open 1 question: Life science / Easy',
            exact: true,
          }).waitFor();
          expect(await subject.inputValue()).toStrictEqual(`${versionId}:life:outdated`);
          await page.getByRole('link', { name: 'Questions', exact: true }).click();
          await page.getByRole('checkbox', { name: 'Select this page', exact: true }).waitFor();
          expect(await page.locator('tbody tr').count()).toStrictEqual(1);
          expect(new URL(page.url()).searchParams.get('subject')).toStrictEqual(
            `${versionId}:life:outdated`,
          );
          expect(errors).toStrictEqual([]);
          await browser.close();
          // Persist captured artifacts after the browser has completed navigation.
          for (const screenshot of screenshots) {
            await writeFile(screenshot.path, screenshot.data);
          }
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

it(
  'ordinary bank GET filters and selected-question POST remain usable without JavaScript',
  async () => {
    try {
      await withEnrichmentWorkspace(async (auth) => {
        const ids = await addEnrichmentQuestions(auth, 3);
        await withWorkerHttpSession(auth, 55904, async (owned) => {
          const browser = await openLocalAppBrowser({
            endpoint: { _tag: 'ExistingApp', baseUrl: owned.baseUrl },
            headless: true,
          });
          try {
            const native: import('playwright').BrowserContext = await browser.newContext({
              browser: { javaScriptEnabled: false },
              authSession: await createSession({ tenantId: auth.tenantId, userId: auth.userId }),
            });
            const page = await native.newPage();
            page.setDefaultTimeout(10000);
            await page.goto(owned.baseUrl + '/items');
            await page.locator('input[name="q"]').fill('Cell question 0');
            await page.getByRole('button', { name: 'Apply filters', exact: true }).press('Enter');
            await page.waitForURL((url) => url.searchParams.get('q') === 'Cell question 0');
            expect(await page.locator('tbody tr').count()).toStrictEqual(1);
            const selection = page.locator(`input[name="questionId"][value="${ids[0]}"]`);
            await selection.check();
            await page.locator('select[name="bulkAction"]').selectOption('archive');
            const [saved] = await Promise.all([
              page.waitForResponse((response) =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname === '/items'
              ),
              page.getByRole('button', { name: 'Apply to selected', exact: true }).press('Enter'),
            ]);
            expect(saved.status()).toStrictEqual(303);
            await page.waitForURL((url) => url.searchParams.get('notice') === 'updated:1');
            expect(new URL(page.url()).searchParams.get('q')).toStrictEqual('Cell question 0');
            const stored = await db.select({
              id: questions.id,
              lifecycle: questions.lifecycleState,
            }).from(questions).where(eq(questions.tenantId, auth.tenantId));
            expect(stored.filter((row) => row.lifecycle === 'archived').map((row) => row.id))
              .toStrictEqual([ids[0]]);
            const wrong = await owned.fetch('/items', { method: 'PUT' });
            expect(wrong.status).toStrictEqual(405);
            expect(wrong.headers.get('allow')).toStrictEqual('GET, HEAD, POST');
            await wrong.body?.cancel();
            await native.close();
          } finally {
            await browser.close();
          }
          const stillOwned = await owned.fetch('/health');
          expect(stillOwned.status).toStrictEqual(200);
          await stillOwned.body?.cancel();
        });
      });
    } finally {
      await shutdownDb();
    }
  },
  45000,
);

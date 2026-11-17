import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { requireQaDatabaseUrl } from './helpers/qa_database.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, questionRevisions, userSettingsTable } from '../lib/db/schema.ts';
import {
  enrichmentAssignments,
  enrichmentSchemeVersions,
} from '../lib/db/bank_enrichment_schema.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { exerciseAffectedEnrichment } from './helpers/enrichment_affected_browser.ts';
import {
  enrichmentBrowserEnvironment,
  enrichmentBrowserRuntime,
} from './helpers/enrichment_browser_runtime.ts';

testCase(
  'instructor organizes a frozen bank with keyboard edits, refreshed examples, duplicate-submit protection and reloadable work',
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    try {
      await withEnrichmentWorkspace(async (auth) => {
        let app: LocalAppBrowser | undefined;
        let runtime: Awaited<ReturnType<typeof enrichmentBrowserRuntime>> | undefined;
        try {
          await addEnrichmentQuestions(auth, 32);
          await saveUserSettings(auth.userId, createInitialUserSettings('en-US'));
          const before = await db.select().from(questionRevisions).where(
            eq(questionRevisions.tenantId, auth.tenantId),
          );
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5240, lastExclusive: 5250 },
              environment: {
                ...builtWorkerBrowserEnvironment,
                DATABASE_URL: databaseUrl,
                ...enrichmentBrowserEnvironment,
              },
            },
            headless: true,
          });
          runtime = await enrichmentBrowserRuntime(auth);
          const runtimeUrl = runtime.url;
          const context: import('playwright').BrowserContext = await app.newContext({
            authSession: await createSession({ tenantId: auth.tenantId, userId: auth.userId }),
            browser: { viewport: { width: 1440, height: 1100 } },
          });
          const page: import('playwright').Page = await context.newPage();
          page.setDefaultTimeout(20000);
          const selectCategory = async (name: 'Subject' | 'Difficulty', value: string) => {
            await page.getByText(
              'Counts update as you choose categories. Apply filters updates the questions.',
              { exact: true },
            ).waitFor();
            const response = page.waitForResponse((r) => r.url().includes('/api/items/facets?'));
            await page.getByRole('combobox', { name, exact: true }).selectOption(value);
            const facets = await response;
            if (!(facets.ok())) expect.unreachable(await facets.text());
            await page.getByText(
              'Counts update as you choose categories. Apply filters updates the questions.',
              { exact: true },
            ).waitFor();
          };

          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.route('**/items/organize**', async (route) => {
            if (route.request().method() !== 'POST') return await route.continue();
            const target = new URL(route.request().url());
            const response = await route.fetch({
              url: runtimeUrl + target.pathname + target.search,
            });
            return await route.fulfill({ response });
          });
          // This fixture represents a previously queued generative task. New tasks use the Clef entry screen.
          const response = await page.request.post(runtimeUrl + '/items/organize', {
            multipart: {
              payload: JSON.stringify({
                action: 'begin',
                operationId: crypto.randomUUID(),
                scope: { _tag: 'Filtered', queryString: 'tags=source-science' },
                audience: 'Grade 6 science',
                baseVersionId: null,
              }),
            },
          });
          const reply: unknown = await response.json();
          if (
            !(typeof reply === 'object' && reply !== null && 'url' in reply &&
              typeof reply.url === 'string')
          ) {
            expect.unreachable(
              "Expected typeof reply === 'object' && reply !== null && 'url' in reply && typeof reply.url === 'str",
            );
          }
          await page.goto(app.baseUrl + reply.url);
          await page.getByRole('status').filter({ hasText: 'Analyzing a sample' }).waitFor();
          const firstPreviewUrl = page.url();
          await page.reload();
          await page.getByText('You can leave this page. Processing continues in the background.')
            .waitFor();
          expect(page.url()).toStrictEqual(firstPreviewUrl);
          await runtime.drain();
          await page.getByRole('heading', { name: 'Customize your vocabulary', exact: true })
            .waitFor();
          await page.locator('input[name="label-life"]').fill('Biology');
          const physical = page.locator('[data-category="physical"]');
          await physical.getByText('Definition & options', { exact: true }).click();
          await physical.getByRole('combobox', { name: 'Merge into', exact: true }).selectOption(
            'life',
          );
          await physical.getByRole('button', { name: 'Merge', exact: true }).click();
          expect(await page.locator('input[name="label-physical"]').count()).toStrictEqual(0);
          await page.getByRole('tab', { name: 'Subjects & topics', exact: true }).focus();
          await page.keyboard.press('ArrowRight');
          await page.getByRole('tab', { name: 'Difficulty', exact: true, selected: true })
            .waitFor();
          expect(
            await page.getByRole('tab', { name: 'Difficulty', exact: true }).getAttribute(
              'aria-selected',
            ),
          ).toStrictEqual('true');
          await page.locator('input[name="label-moderate"]').fill('Developing');
          const nameBox = await page.locator('input[name="label-moderate"]').boundingBox();
          const definitionBox = await page.locator('textarea[name="definition-moderate"]')
            .boundingBox();
          if (
            !(nameBox && definitionBox && definitionBox.x > nameBox.x &&
              Math.abs(definitionBox.y - nameBox.y) < 2)
          ) {
            expect.unreachable(
              'Desktop difficulty names and definitions must share one compact row.',
            );
          }
          await page.screenshot({
            path: '/tmp/qflow-enrichment-step4-desktop.png',
            fullPage: true,
            animations: 'disabled',
          });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.locator('textarea[name="definition-hard"]').scrollIntoViewIfNeeded();
          expect(await page.locator('textarea[name="definition-hard"]').inputValue()).toStrictEqual(
            'Combine principles in an unfamiliar situation.',
          );
          await page.locator('input[name="label-hard"]').fill('Hard');
          await page.screenshot({
            path: '/tmp/qflow-enrichment-step4-mobile-lower.png',
            animations: 'disabled',
          });
          await page.getByRole('heading', { name: 'Customize your vocabulary', exact: true })
            .scrollIntoViewIfNeeded();
          await page.evaluate(() =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
          );
          await page.screenshot({
            path: '/tmp/qflow-enrichment-step4-mobile.png',
            fullPage: true,
            animations: 'disabled',
          });
          if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
            expect.unreachable('Setup must fit a narrow screen.');
          }
          await page.setViewportSize({ width: 1440, height: 1100 });
          await page.getByRole('tab', { name: 'Examples', exact: true }).click();
          expect(await page.locator('select[name^="example-difficulty-"]').count()).toStrictEqual(
            0,
          );
          await page.getByRole('button', { name: 'Use as a teaching example', exact: true }).first()
            .click();
          const example = page.locator('select[name^="example-difficulty-"]').first();
          const exampleName = await example.getAttribute('name');
          if (!exampleName) expect.unreachable('Expected exampleName');
          await example.selectOption('hard');
          await page.locator('input[name=update-subject]').uncheck();
          await page.locator('input[name=update-topic]').uncheck();
          await page.getByRole('button', { name: 'Preview examples', exact: true }).click();
          await page.getByRole('status').filter({ hasText: 'Analyzing a sample' }).waitFor();
          if (!(page.url() !== firstPreviewUrl)) {
            expect.unreachable('Expected page.url() !== firstPreviewUrl');
          }
          await runtime.drain();
          await page.getByRole('heading', { name: 'Customize your vocabulary', exact: true })
            .waitFor();
          expect(await page.locator('input[name="label-life"]').inputValue()).toStrictEqual(
            'Biology',
          );
          expect(new URL(page.url()).searchParams.get('fields')).toStrictEqual('difficulty');
          expect(await page.locator('input[name=update-subject]').isChecked()).toStrictEqual(false);
          expect(await page.locator('input[name=update-topic]').isChecked()).toStrictEqual(false);
          expect(await page.locator('input[name=update-difficulty]').isChecked()).toStrictEqual(
            true,
          );
          await page.locator('input[name=update-subject]').check();
          await page.getByRole('tab', { name: 'Examples', exact: true }).click();
          expect(
            await page.locator(`select[name="${exampleName}"]`).inputValue(),
            'Refreshed model results must preserve instructor examples.',
          ).toStrictEqual('hard');
          if (!(await page.getByText(/^Last preview:/).first().textContent())) {
            expect.unreachable(
              'Expected await page.getByText(/^Last preview:/).first().textContent()',
            );
          }
          const postsBefore = runtime.postCount();
          await page.getByRole('button', { name: 'Tag bank', exact: true }).evaluate((button) => {
            const form = button.closest('form');
            if (!form) throw new Error('Tag bank must belong to the setup form.');
            form.requestSubmit();
            form.requestSubmit();
          });
          await page.getByRole('heading', { name: 'Tagging progress', exact: true }).waitFor();
          expect(runtime.postCount()).toStrictEqual(postsBefore + 1);
          expect(
            (await db.select().from(enrichmentSchemeVersions).where(
              eq(enrichmentSchemeVersions.tenantId, auth.tenantId),
            )).length,
          ).toStrictEqual(1);
          await page.reload();
          await page.getByText('0 of 32 questions processed', { exact: true }).waitFor();
          await page.getByRole('button', { name: 'Cancel processing', exact: true }).click();
          await page.getByRole('status').filter({ hasText: 'Processing cancelled' }).waitFor();
          await runtime.drain();
          await page.reload();
          await page.getByRole('button', { name: 'Resume unfinished questions', exact: true })
            .click();
          await page.getByRole('button', { name: 'Cancel processing', exact: true }).waitFor();
          await runtime.drain();
          await page.getByRole('status').filter({ hasText: 'Tagging complete' }).waitFor();
          expect(
            (await db.select().from(enrichmentAssignments).where(
              eq(enrichmentAssignments.tenantId, auth.tenantId),
            )).length,
          ).toStrictEqual(96);
          expect(
            await db.select().from(questionRevisions).where(
              eq(questionRevisions.tenantId, auth.tenantId),
            ),
          ).toStrictEqual(before);
          await addEnrichmentQuestions(auth, 74);
          await page.getByRole('link', { name: 'View questions', exact: true }).click();
          await page.getByRole('heading', { name: 'Question bank', exact: true }).waitFor();
          expect(new URL(page.url()).searchParams.get('tags')).toStrictEqual('source-science');
          const [scheme] = await db.select().from(enrichmentSchemeVersions).where(
            eq(enrichmentSchemeVersions.tenantId, auth.tenantId),
          );
          expect(new URL(page.url()).searchParams.get('scheme')).toStrictEqual(scheme.schemeId);
          expect(await page.locator('tbody tr').count()).toStrictEqual(100);
          expect(
            await page.getByRole('combobox', { name: 'Category set', exact: true }).inputValue(),
          ).toStrictEqual(scheme.schemeId);
          await page.getByRole('columnheader', { name: 'Difficulty', exact: true }).waitFor();
          expect(errors).toStrictEqual([]);
          await page.getByText(
            'Counts update as you choose categories. Apply filters updates the questions.',
            { exact: true },
          ).waitFor();
          await selectCategory('Subject', `${scheme.id}:life`);
          expect(
            await page.getByRole('combobox', { name: 'Subject', exact: true }).inputValue(),
            'Selected category before submission',
          ).toStrictEqual(`${scheme.id}:life`);
          await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
          await page.waitForURL((url) => url.searchParams.get('subject') === `${scheme.id}:life`);
          expect(await page.locator('tbody tr').count()).toStrictEqual(32);
          expect(
            await page.getByRole('combobox', { name: 'Subject', exact: true }).locator(
              'option:checked',
            ).textContent(),
          ).toStrictEqual('Biology (32)');
          await selectCategory('Difficulty', `${scheme.id}:easy`);
          await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
          await page.waitForURL((url) =>
            url.searchParams.get('difficulty') === `${scheme.id}:easy`
          );
          await page.getByRole('columnheader').filter({ hasText: 'Question' }).getByRole('link')
            .click();
          await page.waitForURL((url) => url.searchParams.get('sort') === 'title');
          expect(new URL(page.url()).searchParams.get('difficulty')).toStrictEqual(
            `${scheme.id}:easy`,
          );
          await page.locator('tbody tr').first().getByRole('link', { name: /^Cell question / })
            .click();
          try {
            await page.getByRole('link', { name: 'Back to question bank', exact: true }).click();
          } catch (cause: unknown) {
            console.error(
              'Enrichment fixture detail return',
              page.url(),
              await page.locator('main').innerText(),
            );
            throw cause;
          }
          await page.getByRole('heading', { name: 'Question bank', exact: true }).waitFor();
          expect(new URL(page.url()).searchParams.get('subject')).toStrictEqual(
            `${scheme.id}:life`,
          );
          await page.getByRole('heading', { name: 'Question bank', exact: true })
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: '/tmp/qflow-enrichment-step5-bank-desktop.png',
            animations: 'disabled',
          });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole('combobox', { name: 'Category set', exact: true })
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: '/tmp/qflow-enrichment-step5-bank-mobile.png',
            animations: 'disabled',
          });
          if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
            expect.unreachable('Classification filters must fit a narrow screen.');
          }
          await page.getByRole('combobox', { name: 'Category set', exact: true }).selectOption('');
          await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
          await page.waitForURL((url) => url.searchParams.get('scheme') === '');
          expect(new URL(page.url()).searchParams.has('subject')).toStrictEqual(false);
          expect(new URL(page.url()).searchParams.has('difficulty')).toStrictEqual(false);
          expect(await page.locator('tbody tr').count()).toStrictEqual(100);
          const nativeContext: import('playwright').BrowserContext = await app.newContext({
            authSession: await createSession({ tenantId: auth.tenantId, userId: auth.userId }),
            browser: { javaScriptEnabled: false, viewport: { width: 1440, height: 1100 } },
          });
          const nativePage: import('playwright').Page = await nativeContext.newPage();
          await nativePage.goto(
            `${app.baseUrl}/items?scheme=${scheme.schemeId}&tags=source-science`,
          );
          await nativePage.getByRole('combobox', { name: 'Subject', exact: true }).selectOption(
            `${scheme.id}:life`,
          );
          await nativePage.getByRole('button', { name: 'Apply filters', exact: true }).press(
            'Enter',
          );
          await nativePage.waitForURL((url) =>
            url.searchParams.get('subject') === `${scheme.id}:life` &&
            !url.searchParams.has('loadedScheme')
          );
          expect(await nativePage.locator('tbody tr').count()).toStrictEqual(32);
          expect(
            await nativePage.getByRole('combobox', { name: 'Subject', exact: true }).inputValue(),
          ).toStrictEqual(`${scheme.id}:life`);
          await nativeContext.close();
          await page.setViewportSize({ width: 1440, height: 1100 });
          await page.goto(
            `${app.baseUrl}/items?scheme=${scheme.schemeId}&subject=${scheme.id}:life&tags=source-science`,
          );
          const selectedQuestionHref = await page.locator('tbody tr').first().getByRole('link')
            .first().getAttribute('href');
          if (!selectedQuestionHref) expect.unreachable('Expected selectedQuestionHref');
          const expectedHardQuestions = new Set([
            new URL(selectedQuestionHref, app.baseUrl).pathname.split('/').at(-1),
            exampleName.replace('example-difficulty-', ''),
          ]);
          await page.locator('tbody tr').first().getByRole('checkbox').check();
          await page.getByRole('link', { name: 'Edit selected classifications', exact: true })
            .click();
          await page.getByText('Update classifications for 1 selected question.', { exact: true })
            .waitFor();
          await page.getByRole('combobox', { name: 'Difficulty', exact: true }).selectOption(
            'hard',
          );
          await page.getByRole('button', { name: 'Update 1 question', exact: true }).click();
          await page.getByRole('heading', { name: 'Editing classifications', exact: true })
            .waitFor();
          await runtime.drain();
          await page.getByRole('status').filter({ hasText: 'Changes complete' }).waitFor();
          expect(await page.getByText('AI usage', { exact: true }).count()).toStrictEqual(0);
          await page.getByRole('link', { name: 'View questions', exact: true }).click();
          await page.getByRole('link', { name: 'Edit matching classifications', exact: true })
            .click();
          await page.getByText(
            'Update classifications for all 106 matching questions, across every page.',
            { exact: true },
          ).waitFor();
          await page.getByRole('combobox', { name: 'Difficulty', exact: true }).selectOption(
            'moderate',
          );
          await page.screenshot({
            path: '/tmp/qflow-enrichment-step6-correction-desktop.png',
            animations: 'disabled',
            fullPage: true,
          });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.screenshot({
            path: '/tmp/qflow-enrichment-step6-correction-mobile.png',
            animations: 'disabled',
            fullPage: true,
          });
          if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
            expect.unreachable(
              'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
            );
          }
          await page.getByRole('button', { name: 'Update 106 questions', exact: true }).click();
          await page.getByRole('heading', { name: 'Editing classifications', exact: true })
            .waitFor();
          await runtime.drain();
          await page.getByRole('status').filter({ hasText: 'Changes complete' }).waitFor();
          await page.getByText('Undo this run', { exact: true }).click();
          await page.getByRole('button', { name: 'Restore previous classifications', exact: true })
            .click();
          await page.getByRole('heading', { name: 'Undoing classifications', exact: true })
            .waitFor();
          await runtime.drain();
          await page.getByRole('status').filter({ hasText: 'Changes complete' }).waitFor();
          await page.getByText('Questions restored', { exact: true }).waitFor();
          await page.screenshot({
            path: '/tmp/qflow-enrichment-step6-undo-mobile.png',
            animations: 'disabled',
            fullPage: true,
          });
          await page.getByRole('link', { name: 'View questions', exact: true }).click();
          await selectCategory('Difficulty', `${scheme.id}:hard`);
          await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
          await page.waitForURL((url) =>
            url.searchParams.get('difficulty') === `${scheme.id}:hard`
          );
          const restoredHardQuestions = await page.locator('tbody tr').evaluateAll((rows) =>
            rows.map((row) =>
              new URL(row.querySelector('a')?.href ?? '').pathname.split('/').at(-1)
            )
          );
          expect(new Set(restoredHardQuestions)).toStrictEqual(expectedHardQuestions);
          await exerciseAffectedEnrichment(
            page,
            app.baseUrl,
            auth.tenantId,
            scheme.id,
            runtime.drain,
            runtimeUrl,
          );
          expect(errors).toStrictEqual([]);
        } finally {
          await runtime?.close();
          await app?.close();
          await db.delete(authSessions).where(eq(authSessions.userId, auth.userId));
          await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, auth.userId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

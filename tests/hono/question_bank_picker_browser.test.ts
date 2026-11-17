import { expect, it } from 'vitest';
import { assertNoBlockingA11y } from '../helpers/browser_accessibility.ts';

import { mkdir, writeFile } from 'node:fs/promises';
import { builtWorkerBrowserEnvironment } from '../helpers/built_worker_environment.ts';
import { safeErrorSummary } from '../../lib/error_summary.ts';
import { requireQaDatabaseUrl } from '../helpers/qa_database.ts';
import { assertQuestionOnlyAssessmentFixture } from '../helpers/question_only_assessment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import { authSessions, userSettingsTable } from '../../lib/db/schema.ts';
import { bankCollectionItems, bankCollections, editorialEvents } from '../../lib/db/bank_schema.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../../lib/settings.ts';
import { getAssessment } from '../../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from '../assessment_fixture.ts';
import { BankEnrichmentStore } from '../../lib/services/bank_enrichment_store.ts';
import { applyBankCollectionCommand } from '../../lib/services/bank_collections.ts';
import { enrichmentDefinitionFixture } from '../bank_enrichment_fixture.ts';
import { assignOverviewFixture } from '../helpers/enrichment_overview_fixture.ts';
import {
  addEnrichmentQuestions,
  withEnrichmentWorkspace,
} from '../helpers/enrichment_workspace.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../../tools/local_app_browser.ts';

const assertStringIncludes = (actual: string, expected: string) => {
  if (!(actual.includes(expected))) expect.unreachable('Expected fixture text was absent.');
};

it(
  'assessment picker filters, pages, previews and adds categorized questions in the real application',
  async () => {
    const databaseUrl = requireQaDatabaseUrl(process.env.DATABASE_URL);
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        let app: LocalAppBrowser | undefined;
        const assessment = await createAssessmentDraft(ctx, { title: 'Categorized assessment' });
        try {
          const ids = await addEnrichmentQuestions(ctx, 15);
          const schemeId = crypto.randomUUID(),
            versionId = crypto.randomUUID(),
            collectionId = crypto.randomUUID();
          const advancedSchemeId = crypto.randomUUID(), advancedVersionId = crypto.randomUUID();
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
          if (
            !((await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, {
              id: advancedVersionId,
              schemeId: advancedSchemeId,
              expectedVersion: 0,
              definition: {
                ...enrichmentDefinitionFixture(),
                name: 'Advanced science',
                audience: 'Advanced students',
              },
            })).ok)
          ) {
            expect.unreachable(
              'Expected (await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, { id: advancedVersio',
            );
          }
          await assignOverviewFixture(ctx, schemeId, versionId, ids.slice(0, 12), {
            subject: { state: 'assigned', valueIds: ['life'] },
            topic: { state: 'assigned', valueIds: ['cells'] },
            difficulty: { state: 'assigned', valueIds: ['moderate'] },
          });
          if (
            !((await applyBankCollectionCommand(ctx, crypto.randomUUID(), {
              _tag: 'Create',
              collectionId,
              name: 'Science collection',
              description: '',
              position: 0,
            })).ok)
          ) {
            expect.unreachable(
              "Expected (await applyBankCollectionCommand(ctx, crypto.randomUUID(), { _tag: 'Create', collectionId",
            );
          }
          if (
            !((await applyBankCollectionCommand(ctx, crypto.randomUUID(), {
              _tag: 'AddItems',
              collectionId,
              questionIds: ids.slice(0, 12),
            })).ok)
          ) {
            expect.unreachable(
              "Expected (await applyBankCollectionCommand(ctx, crypto.randomUUID(), { _tag: 'AddItems', collection",
            );
          }
          await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5250, lastExclusive: 5260 },
              environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
            },
            headless: true,
          });
          const browser: import('playwright').BrowserContext = await app.newContext({
            authSession: await createSession({ tenantId: ctx.tenantId, userId: ctx.userId }),
            browser: { viewport: { width: 1440, height: 1000 } },
          });
          const page: import('playwright').Page = await browser.newPage();
          page.setDefaultTimeout(20000);
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
          await page.goto(`${app.baseUrl}/assessments/${assessment.id}`);
          await page.getByRole('button', { name: 'Add question', exact: true }).click();
          const responseReady = page.waitForResponse((response) =>
            response.url().includes('/api/items/search?')
          );
          await page.getByRole('tab', { name: 'From library', exact: true }).click();
          const initialResponse = await responseReady;
          expect(initialResponse.status(), 'Picker API should accept the initial query.')
            .toStrictEqual(200);
          await page.waitForFunction(() => !document.body.innerText.includes('Searching…'));
          const dialog = page.getByRole('region', { name: 'Insert question', exact: true });
          const collection = dialog.getByRole('combobox', { name: 'Collection', exact: true });
          await collection.locator(`option[value="${collectionId}"]`).waitFor({
            state: 'attached',
          });
          await collection.selectOption(collectionId);
          await dialog.getByText('12 results', { exact: true }).waitFor();
          await dialog.getByRole('button', { name: 'Next', exact: true }).click();
          await dialog.getByText('Page 2 of 2', { exact: true }).waitFor();
          await page.waitForFunction(() =>
            document.querySelectorAll('[data-library-item]').length === 2
          );
          const scheme = dialog.getByRole('combobox', { name: 'Category set', exact: true });
          await scheme.selectOption(schemeId);
          await dialog.getByText('Page 1 of 2', { exact: true }).waitFor();
          const subject = dialog.getByRole('combobox', { name: 'Subject', exact: true });
          await subject.locator(`option[value="${versionId}:life"]`).waitFor({ state: 'attached' });
          await subject.selectOption(`${versionId}:life`);
          await dialog.getByRole('combobox', { name: 'Topic', exact: true }).selectOption(
            `${versionId}:cells`,
          );
          await dialog.getByRole('combobox', { name: 'Difficulty', exact: true }).selectOption(
            `${versionId}:moderate`,
          );
          await dialog.getByText('12 results', { exact: true }).waitFor();
          // Hold the real API request so stale facets can be checked independently of response speed.
          const categoryResponse = Promise.withResolvers<void>();
          const searchRoute = '**/api/items/search?**';
          await page.route(searchRoute, async (route) => {
            if (new URL(route.request().url()).searchParams.get('scheme') === advancedSchemeId) {
              await categoryResponse.promise;
            }
            await route.continue();
          });
          try {
            await scheme.selectOption(advancedSchemeId);
            await page.waitForFunction(() =>
              document.querySelector<HTMLSelectElement>('select[name="subject"]')?.disabled
            );
            expect(await subject.locator(`option[value="${versionId}:life"]`).count())
              .toStrictEqual(0);
            expect(await dialog.locator('[data-library-item]').count()).toStrictEqual(0);
            expect(await dialog.getByText(/Audience:/).count()).toStrictEqual(0);
            categoryResponse.resolve();
            await subject.locator(`option[value="${advancedVersionId}:life"]`).waitFor({
              state: 'attached',
            });
            await dialog.getByText('Audience: Advanced students', { exact: true })
              .waitFor();
          } finally {
            categoryResponse.resolve();
            await page.unroute(searchRoute);
          }
          await scheme.selectOption(schemeId);
          await subject.locator(`option[value="${versionId}:life"]`).waitFor({ state: 'attached' });
          await subject.selectOption(`${versionId}:life`);
          await dialog.getByRole('combobox', { name: 'Topic', exact: true }).selectOption(
            `${versionId}:cells`,
          );
          await dialog.getByRole('combobox', { name: 'Difficulty', exact: true }).selectOption(
            `${versionId}:moderate`,
          );
          await dialog.getByText('12 results', { exact: true }).waitFor();
          const first = dialog.locator('[data-library-item]').nth(1);
          await first.waitFor();
          assertStringIncludes(await first.innerText(), 'Life science');
          assertStringIncludes(await first.innerText(), 'Cells');
          assertStringIncludes(await first.innerText(), 'Moderate');
          const selectedId = await first.getAttribute('data-library-item');
          if (!selectedId) expect.unreachable('Expected selectedId');
          await first.getByRole('button', { name: 'Preview question', exact: true }).click();
          await first.getByText('Correct answer', { exact: true }).waitFor();
          await first.getByText('Preview ready.', { exact: true }).waitFor();
          expect(await first.getByRole('radio').count()).toStrictEqual(2);
          await assertNoBlockingA11y(page);
          await first.locator('[data-qti-preview-host]').scrollIntoViewIfNeeded();
          const screenshots = [{
            path: 'output/playwright/bank-picker-desktop.png',
            data: await page.screenshot({ fullPage: true }),
          }];
          await page.setViewportSize({ width: 390, height: 844 });
          if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
            expect.unreachable(
              'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
            );
          }
          await first.locator('[data-qti-preview-host]').scrollIntoViewIfNeeded();
          screenshots.push({
            path: 'output/playwright/bank-picker-mobile.png',
            data: await page.screenshot({ fullPage: true }),
          });
          await page.setViewportSize({ width: 1440, height: 1000 });
          const documentUrl = page.url();
          await first.getByText('Correct answer', { exact: true }).waitFor();
          await first.getByRole('listitem').filter({ hasText: /^Nucleus$/ }).waitFor();
          expect(browser.pages().length).toStrictEqual(1);
          await first.getByRole('checkbox').check();
          await dialog.getByRole('button', { name: 'Next', exact: true }).click();
          await page.waitForFunction(() =>
            document.querySelectorAll('[data-library-item]').length === 2
          );
          const second = dialog.locator('[data-library-item]').first();
          const secondId = await second.getAttribute('data-library-item');
          if (!(secondId && secondId !== selectedId)) {
            expect.unreachable('Expected secondId && secondId !== selectedId');
          }
          await second.getByRole('checkbox').check();
          await dialog.getByRole('button', { name: 'Add 2 questions', exact: true }).waitFor();
          // Changing filters retains selections from both pages.
          const search = dialog.getByLabel('Search library', { exact: true });
          await search.fill('nothing matches this query');
          await dialog.getByText('No matches yet', { exact: true }).waitFor();
          await dialog.getByRole('button', { name: 'Add 2 questions', exact: true }).waitFor();
          await search.fill('');
          await dialog.getByText('12 results', { exact: true }).waitFor();
          await search.press('Enter');
          await dialog.getByText('12 results', { exact: true }).waitFor();
          expect((await getAssessment(ctx, assessment.id))?.parts[0].placements.length)
            .toStrictEqual(0);
          const documents: string[] = [];
          page.on('request', (request) => {
            if (request.resourceType() === 'document') documents.push(request.url());
          });
          await dialog.getByRole('button', { name: 'Add 2 questions', exact: true }).click();
          await dialog.getByText('2 questions added to Part 1.', { exact: true }).waitFor();
          expect(await collection.inputValue()).toStrictEqual(collectionId);
          expect(await subject.inputValue()).toStrictEqual(`${versionId}:life`);
          expect(page.url()).toStrictEqual(documentUrl);
          expect(documents).toStrictEqual([]);
          if (!(await dialog.isVisible())) expect.unreachable('Expected await dialog.isVisible()');
          const included = dialog.locator(`[data-library-item="${selectedId}"]`);
          if (!(await included.getByRole('checkbox').isDisabled())) {
            expect.unreachable("Expected await included.getByRole('checkbox').isDisabled()");
          }
          assertStringIncludes(await included.innerText(), 'Already in assessment');
          const saved = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(saved);
          expect(saved?.parts[0].placements.map((placement) => placement.itemId)).toStrictEqual([
            selectedId,
            secondId,
          ]);
          expect(saved?.parts[0].placements.map((placement) => placement.snapshotRev))
            .toStrictEqual([
              1,
              1,
            ]);
          await dialog.getByRole('button', { name: 'Close add-question dialog' }).click();
          await page.getByText('2 questions in reading order.', { exact: true }).waitFor();
          expect(await page.locator('[data-authoring-card]').count()).toStrictEqual(2);
          expect(errors).toStrictEqual([]);
          await browser.close();
          await mkdir('output/playwright', { recursive: true });
          for (const shot of screenshots) await writeFile(shot.path, shot.data);
        } finally {
          await app?.close();
          await deleteAssessment(ctx, assessment.id);
          await db.delete(authSessions).where(eq(authSessions.userId, ctx.userId));
          await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, ctx.userId));
          await db.delete(bankCollectionItems).where(
            eq(bankCollectionItems.tenantId, ctx.tenantId),
          );
          await db.delete(editorialEvents).where(eq(editorialEvents.tenantId, ctx.tenantId));
          await db.delete(bankCollections).where(eq(bankCollections.tenantId, ctx.tenantId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
  90000,
);

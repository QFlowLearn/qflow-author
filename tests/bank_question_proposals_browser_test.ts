import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, questions, userSettingsTable } from '../lib/db/schema.ts';
import { bankCollectionItems, bankCollections, editorialEvents } from '../lib/db/bank_schema.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { applyBankCollectionCommand } from '../lib/services/bank_collections.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { assignOverviewFixture } from './helpers/enrichment_overview_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';

testCase(
  'authors choose a difficulty mix, retain manual choices, replace, preview and retry a committed add',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!(databaseUrl && /test/.test(new URL(databaseUrl).pathname))) {
      expect.unreachable('Expected databaseUrl && /test/.test(new URL(databaseUrl).pathname)');
    }
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        let app: LocalAppBrowser | undefined;
        const assessment = await createAssessmentDraft(ctx, { title: 'Question mix' });
        try {
          const ids = await addEnrichmentQuestions(ctx, 28, db, { distinctContent: true });
          const schemeId = crypto.randomUUID(),
            versionId = crypto.randomUUID(),
            collectionId = crypto.randomUUID();
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
          for (
            const [difficultyId, subset] of [
              ['easy', ids.slice(0, 8)],
              ['moderate', ids.slice(8, 16)],
              ['hard', ids.slice(16)],
            ] as const
          ) {
            await assignOverviewFixture(ctx, schemeId, versionId, subset, {
              subject: { state: 'assigned', valueIds: ['life'] },
              topic: { state: 'assigned', valueIds: ['cells'] },
              difficulty: { state: 'assigned', valueIds: [difficultyId] },
            });
          }
          if (
            !((await applyBankCollectionCommand(ctx, crypto.randomUUID(), {
              _tag: 'Create',
              collectionId,
              name: 'Proposal collection',
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
              questionIds: ids.slice(0, 20),
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
              portRange: { first: 5260, lastExclusive: 5270 },
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
          page.on('pageerror', (error) => errors.push(error.message));
          const draws: string[] = [], documents: string[] = [], adds: string[] = [];
          page.on('request', (request) => {
            if (
              request.url().endsWith('/question-proposals') &&
              request.postDataJSON().kind !== 'inspect'
            ) draws.push(request.postData() ?? '');
            if (request.url().endsWith('/placements')) adds.push(request.postData() ?? '');
            if (request.resourceType() === 'document') documents.push(request.url());
          });
          await page.goto(`${app.baseUrl}/assessments/${assessment.id}`);
          await page.getByRole('button', { name: '+ Add Question', exact: true }).click();
          await page.getByRole('tab', { name: 'From library', exact: true }).click();
          const insertPicker = page.getByRole('region', { name: 'Insert question', exact: true });
          await insertPicker.getByRole('combobox', { name: 'Collection', exact: true })
            .selectOption(
              collectionId,
            );
          await insertPicker.getByRole('combobox', { name: 'Category set', exact: true })
            .selectOption(
              schemeId,
            );
          await insertPicker.getByRole('combobox', { name: 'Subject', exact: true }).selectOption(
            `${versionId}:life`,
          );
          await insertPicker.getByRole('combobox', { name: 'Topic', exact: true }).selectOption(
            `${versionId}:cells`,
          );
          await insertPicker.getByText('20 results', { exact: true }).waitFor();
          const manual = insertPicker.locator(`[data-library-item="${ids[0]}"]`);
          await manual.getByRole('checkbox').check();
          const chooser = insertPicker.getByRole('region', {
            name: 'Choose questions for me',
            exact: true,
          });
          const toggle = chooser.getByRole('button', {
            name: 'Choose questions for me',
            exact: true,
          });
          await toggle.focus();
          await page.keyboard.press('Enter');
          await chooser.getByRole('radio', { name: 'Difficulty', exact: true }).check();
          await chooser.getByRole('spinbutton', { name: /^Hard/ }).fill('5');
          await chooser.getByText('Only 4 available', { exact: true }).waitFor();
          if (
            !(await chooser.getByRole('button', { name: 'Choose questions', exact: true })
              .isDisabled())
          ) {
            expect.unreachable(
              "Expected await chooser.getByRole('button', { name: 'Choose questions', exact: true }) .isDisabled()",
            );
          }
          await chooser.getByRole('spinbutton', { name: /^Easy/ }).fill('2');
          await chooser.getByRole('spinbutton', { name: /^Moderate/ }).fill('3');
          await chooser.getByRole('spinbutton', { name: /^Hard/ }).fill('4');
          // Counts can change between inspection and draw. Keep the request and refresh its one count snapshot.
          await db.update(questions).set({
            lifecycleState: 'archived',
            archivedAt: new Date(),
            archivedBy: ctx.userId,
          }).where(eq(questions.id, ids[19]));
          await chooser.getByRole('button', { name: 'Choose questions', exact: true }).click();
          await chooser.getByText('Only 3 available', { exact: true }).waitFor();
          expect(await chooser.getByRole('spinbutton', { name: /^Hard/ }).inputValue())
            .toStrictEqual('4');
          if (
            !(await chooser.getByRole('button', { name: 'Choose questions', exact: true })
              .isDisabled())
          ) {
            expect.unreachable(
              "Expected await chooser.getByRole('button', { name: 'Choose questions', exact: true }) .isDisabled()",
            );
          }
          expect(await insertPicker.locator('[data-selected-question]').count()).toStrictEqual(1);
          await db.update(questions).set({
            lifecycleState: 'active',
            archivedAt: null,
            archivedBy: null,
          }).where(eq(questions.id, ids[19]));
          await toggle.click();
          await toggle.click();
          await chooser.getByText('4 available', { exact: true }).waitFor();
          expect(await chooser.getByRole('spinbutton', { name: /^Hard/ }).inputValue())
            .toStrictEqual('4');

          await chooser.scrollIntoViewIfNeeded();
          await page.screenshot({ path: '/tmp/qflow-question-chooser-desktop.png' });
          await page.setViewportSize({ width: 390, height: 844 });
          await chooser.scrollIntoViewIfNeeded();
          if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
            expect.unreachable(
              'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
            );
          }
          await page.screenshot({ path: '/tmp/qflow-question-chooser-mobile.png' });
          await page.setViewportSize({ width: 1440, height: 1000 });

          await chooser.getByRole('button', { name: 'Choose questions', exact: true }).focus();
          await page.keyboard.press('Enter');
          const selected = insertPicker.locator('[data-selected-questions]');
          await insertPicker.getByRole('button', { name: 'Add 10 questions', exact: true })
            .waitFor();
          expect(await selected.locator('[data-selected-question]').count()).toStrictEqual(10);
          expect(await selected.locator(`[data-selected-question="${ids[0]}"]`).count())
            .toStrictEqual(1);
          const initialIds = await selected.locator('[data-selected-question]').evaluateAll((
            rows,
          ) => rows.map((row) => row.getAttribute('data-selected-question')));
          // Filter changes affect future counts, not the already-reviewed proposal.
          await insertPicker.getByRole('combobox', { name: 'Difficulty', exact: true })
            .selectOption(
              `${versionId}:moderate`,
            );
          await insertPicker.getByText('8 results', { exact: true }).waitFor();
          expect(
            await selected.locator('[data-selected-question]').evaluateAll((rows) =>
              rows.map((row) => row.getAttribute('data-selected-question'))
            ),
          ).toStrictEqual(initialIds);
          await toggle.click();
          await chooser.getByRole('spinbutton', { name: /^Moderate/ }).waitFor();
          expect(await chooser.getByRole('spinbutton').count()).toStrictEqual(1);
          await toggle.click();
          expect(draws.length).toStrictEqual(2);
          // Replace uses the question's original Easy bucket even though browsing now shows Moderate.
          const easy = selected.locator('[data-selected-question]').filter({
            hasText: 'Suggested · Easy',
          }).first();
          const oldEasyId = await easy.getAttribute('data-selected-question');
          await easy.getByRole('button', { name: 'Replace', exact: true }).click();
          await selected.locator(`[data-selected-question="${oldEasyId}"]`).waitFor({
            state: 'detached',
          });
          const nextEasy = selected.locator('[data-selected-question]').filter({
            hasText: 'Suggested · Easy',
          }).first();
          await nextEasy.getByRole('button', { name: 'Preview question', exact: true }).click();
          await nextEasy.getByText('Preview ready.', { exact: true }).waitFor();
          await nextEasy.getByRole('listitem').filter({ hasText: /^Nucleus$/ }).waitFor();
          const hard = selected.locator('[data-selected-question]').filter({
            hasText: 'Suggested · Hard',
          }).first();
          const hardId = await hard.getAttribute('data-selected-question');
          await hard.getByRole('button', { name: 'Replace', exact: true }).click();
          await hard.getByText(
            'No other distinct question matches these filters and category. The selected question is kept.',
            { exact: true },
          ).waitFor();
          expect(await hard.getAttribute('data-selected-question')).toStrictEqual(hardId);
          // Keep evidence outside the watched source tree so Fresh does not reload the insertPicker.
          await selected.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: '/tmp/qflow-question-proposal-desktop.png',
            fullPage: true,
          });
          await page.setViewportSize({ width: 390, height: 844 });
          if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
            expect.unreachable(
              'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
            );
          }
          await page.screenshot({
            path: '/tmp/qflow-question-proposal-mobile.png',
            fullPage: true,
          });
          await page.setViewportSize({ width: 1440, height: 1000 });
          const documentsBefore = documents.length;
          await page.route('**/placements', async (route) => {
            const response = await route.fetch();
            expect(response.status()).toStrictEqual(201);
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'storage_failed' }),
            });
          });
          await insertPicker.getByRole('button', { name: 'Add 10 questions', exact: true }).click();
          await insertPicker.getByText(
            'Could not confirm the addition. Your selection is saved here. Try again; questions will not be added twice.',
            { exact: true },
          ).waitFor();
          expect((await getAssessment(ctx, assessment.id))?.targetCount).toStrictEqual(10);
          expect(await selected.locator('[data-selected-question]').count()).toStrictEqual(10);
          await page.unroute('**/placements');
          await insertPicker.getByRole('button', { name: 'Add 10 questions', exact: true }).click();
          await insertPicker.getByText('10 questions added to Part 1.', { exact: true }).waitFor();
          expect(adds.length).toStrictEqual(2);
          expect(adds[0]).toStrictEqual(adds[1]);
          expect(documents.length).toStrictEqual(documentsBefore);
          expect((await getAssessment(ctx, assessment.id))?.targetCount).toStrictEqual(10);
          expect(
            await insertPicker.getByRole('combobox', { name: 'Collection', exact: true })
              .inputValue(),
          ).toStrictEqual(collectionId);
          expect(draws.length).toStrictEqual(4);
          // With historical definitions present, an author must choose a version explicitly.
          const newerId = crypto.randomUUID();
          if (
            !((await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, {
              id: newerId,
              schemeId,
              expectedVersion: 1,
              definition: { ...enrichmentDefinitionFixture(), audience: 'Advanced students' },
            })).ok)
          ) {
            expect.unreachable(
              'Expected (await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, { id: newerId, schem',
            );
          }
          for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
            const i18n = createI18n(locale, catalogForLocale(locale));
            await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
            await page.goto(`${app.baseUrl}/assessments/${assessment.id}`);
            await page.getByRole('button', {
              name: `+ ${i18n.t('list.builder.header.addQuestion')}`,
              exact: true,
            }).click();
            await page.getByRole('tab', {
              name: i18n.t('assessments.builder.fromLibrary'),
              exact: true,
            }).click();
            const picker = page.locator('[data-library-picker]');
            await picker.locator('select[name="collection"]').selectOption(collectionId);
            await picker.locator('select[name="scheme"]').selectOption(schemeId);
            await picker.getByRole('button', {
              name: i18n.t('assessments.builder.proposal.title'),
              exact: true,
            }).click();
            const form = picker.getByRole('region', {
              name: i18n.t('assessments.builder.proposal.title'),
              exact: true,
            });
            await form.getByRole('radio', {
              name: i18n.t('assessments.builder.proposal.mode.difficulty'),
              exact: true,
            }).check();
            const version = form.locator('select[name="proposal-version"]');
            await version.waitFor();
            expect(await version.inputValue()).toStrictEqual('');
            expect(await form.getByRole('spinbutton').count()).toStrictEqual(0);
            await version.selectOption(versionId);
            await form.locator('input[name="hard"]').fill('1');
            await form.getByText(i18n.t('assessments.builder.proposal.shortfall', { count: 0 }), {
              exact: true,
            }).waitFor();
            if (
              !(await form.getByRole('button', {
                name: i18n.t('assessments.builder.proposal.choose'),
                exact: true,
              }).isDisabled())
            ) {
              expect.unreachable(
                "Expected await form.getByRole('button', { name: i18n.t('assessments.builder.proposal.choose'), exac",
              );
            }
          }
          expect(errors).toStrictEqual([]);
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
);

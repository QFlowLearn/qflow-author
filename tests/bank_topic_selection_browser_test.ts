import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, userSettingsTable } from '../lib/db/schema.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { assignOverviewFixture } from './helpers/enrichment_overview_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';

testCase(
  'author chooses a topic mix with no difficulty, sees distinct shortfall and adds through the normal picker',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!(databaseUrl && /test/.test(new URL(databaseUrl).pathname))) {
      expect.unreachable('Expected databaseUrl && /test/.test(new URL(databaseUrl).pathname)');
    }
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Topic-only quiz' });
        let app: LocalAppBrowser | undefined;
        try {
          // Titles differ but content repeats: only two distinct questions in this bank.
          const ids = await addEnrichmentQuestions(ctx, 6);
          const schemeId = crypto.randomUUID(),
            versionId = crypto.randomUUID(),
            base = enrichmentDefinitionFixture();
          if (
            !((await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, {
              id: versionId,
              schemeId,
              expectedVersion: 0,
              definition: {
                ...base,
                topics: [base.topics[0], {
                  id: 'organelles',
                  label: 'Organelles',
                  definition: 'Cell structures.',
                  subjectId: 'life',
                }],
              },
            })).ok)
          ) {
            expect.unreachable(
              'Expected (await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, { id: versionId, sch',
            );
          }
          await assignOverviewFixture(ctx, schemeId, versionId, ids, {
            subject: { state: 'assigned', valueIds: ['life'] },
            topic: { state: 'assigned', valueIds: ['cells', 'organelles'] },
            difficulty: { state: 'unassigned', reason: 'insufficient_context' },
          });
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
          await page.goto(`${app.baseUrl}/assessments/${assessment.id}`);
          await page.getByRole('button', { name: '+ Add Question', exact: true }).click();
          await page.getByRole('tab', { name: 'From library', exact: true }).click();
          const insertPicker = page.getByRole('region', { name: 'Insert question', exact: true });
          await insertPicker.getByRole('combobox', { name: 'Category set', exact: true })
            .selectOption(
              schemeId,
            );
          const chooser = insertPicker.getByRole('region', {
            name: 'Choose questions for me',
            exact: true,
          });
          await chooser.getByRole('button', { name: 'Choose questions for me', exact: true })
            .click();
          if (!(await chooser.getByRole('radio', { name: 'Topic', exact: true }).isChecked())) {
            expect.unreachable(
              "Expected await chooser.getByRole('radio', { name: 'Topic', exact: true }).isChecked()",
            );
          }
          await chooser.getByRole('spinbutton', { name: /^Cells/ }).fill('2');
          await chooser.getByRole('spinbutton', { name: /^Organelles/ }).fill('2');
          await chooser.getByRole('button', { name: 'Choose questions', exact: true }).click();
          await chooser.getByText(
            'Only 2 distinct questions can satisfy this mix. Reduce the counts or change the filters.',
            { exact: true },
          ).waitFor();
          expect(await insertPicker.locator('[data-selected-question]').count()).toStrictEqual(0);
          await page.screenshot({
            path: '/tmp/qflow-topic-shortfall.png',
            fullPage: true,
          });
          await chooser.getByRole('spinbutton', { name: /^Cells/ }).fill('1');
          await chooser.getByRole('spinbutton', { name: /^Organelles/ }).fill('1');
          await chooser.getByRole('button', { name: 'Choose questions', exact: true }).click();
          const selected = insertPicker.locator('[data-selected-questions]');
          await selected.getByText('Suggested · Cells · Grade 6 science', { exact: true })
            .waitFor();
          await selected.getByText('Suggested · Organelles · Grade 6 science', { exact: true })
            .waitFor();
          expect(await selected.locator('[data-selected-question]').count()).toStrictEqual(2);
          await insertPicker.getByRole('button', { name: 'Add 2 questions', exact: true }).click({
            trial: true,
          });
          await page.setViewportSize({ width: 390, height: 844 });
          if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
            expect.unreachable(
              'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
            );
          }
          await page.screenshot({
            path: '/tmp/qflow-topic-selection-mobile.png',
            fullPage: true,
          });
          await insertPicker.getByRole('button', { name: 'Add 2 questions', exact: true }).click();
          await insertPicker.getByText('2 questions added to Part 1.', { exact: true }).waitFor();
          const saved = await getAssessment(ctx, assessment.id);
          if (!saved) expect.unreachable('Expected saved');
          expect(saved.targetCount).toStrictEqual(2);
          expect(errors).toStrictEqual([]);
        } finally {
          await app?.close();
          await deleteAssessment(ctx, assessment.id);
          await db.delete(authSessions).where(eq(authSessions.userId, ctx.userId));
          await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, ctx.userId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

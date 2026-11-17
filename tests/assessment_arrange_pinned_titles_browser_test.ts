import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, questionRevisions } from '../lib/db/schema.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import { captureQuestionProtectionFields } from './helpers/question_protection_browser.ts';

testCase(
  'Arrange protects the selected pinned revision instead of labeling it with latest content',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
        const i18n = createI18n('en-US', catalogForLocale('en-US'));
        const assessment = await createAssessmentDraft(ctx, {
          title: 'Pinned protection regression',
        });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          const draft = (title: string, maximumScore: number) => ({
            type: 'single_select' as const,
            title,
            maximumScore,
            itemLanguage: newAuthoringItemLanguage(),
            bodyHtml: '<p>Choose Paris.</p>',
            choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
            correctId: 'A',
          });
          const created = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId: initial.parts[0].id,
            draft: draft('Original pinned title', 3.125),
          });
          if (!(created.ok)) expect.unreachable('Expected created.ok');
          const revised = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Revise',
            expectedParentRevision: created.value.revision,
            placementId: created.value.placementId,
            itemId: created.value.itemId,
            draft: draft('Different latest title', 2.5),
          });
          if (!(revised.ok)) expect.unreachable('Expected revised.ok');
          expect(revised.value.revision).toStrictEqual(2);
          const latest = await getAssessment(ctx, assessment.id);
          if (!latest) expect.unreachable('Expected latest');
          await saveAssessmentArrangementFixture(
            ctx,
            assessment.id,
            latest.parts.map((part) => ({
              ...part,
              placements: part.placements.map((placement) => ({ ...placement, snapshotRev: 1 })),
            })),
          );
          const pinned = await getAssessment(ctx, assessment.id);
          if (!pinned) expect.unreachable('Expected pinned');
          const revisions = await db.select().from(questionRevisions).where(
            eq(questionRevisions.tenantId, ctx.tenantId),
          ).orderBy(questionRevisions.id);
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5440, lastExclusive: 5450 },
              environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
            },
            headless: true,
          });
          const context: import('playwright').BrowserContext = await app.newContext({
            authSession: await createSession(ctx),
          });
          try {
            const page: import('playwright').Page = await context.newPage();
            page.setDefaultTimeout(20000);
            const errors: string[] = [];
            page.on('pageerror', (cause) => errors.push(safeErrorSummary(cause)));
            try {
              await page.goto(`${app.baseUrl}/assessments/${assessment.id}/arrange`, {
                waitUntil: 'networkidle',
              });
              const handle = page.getByRole('button', {
                name: i18n.t('assessments.arrange.dragQuestion', {
                  count: 1,
                  title: 'Original pinned title',
                }),
                exact: true,
              });
              await handle.waitFor();
              expect(await page.getByText('Different latest title', { exact: true }).count())
                .toStrictEqual(0);
              await page.getByRole('button', {
                name: i18n.t('assessments.arrange.partSettings'),
                exact: true,
              }).click();
              const modal = page.getByRole('dialog', {
                name: i18n.t('assessments.arrange.modal.title', { part: 1 }),
                exact: true,
              });
              await modal.locator('summary').filter({
                hasText: i18n.t('assessments.partSettings.fixedQuestions'),
              }).click();
              const control = modal.getByRole('checkbox', { name: /Original pinned title$/ });
              expect(await control.isChecked()).toStrictEqual(false);
              await control.check();
              await captureQuestionProtectionFields(
                page,
                modal,
                i18n,
                evidence,
                'qflow-arrange-pinned-protection',
              );
              await modal.getByRole('button', {
                name: i18n.t('assessments.arrange.modal.close'),
                exact: true,
              }).click();
              const [response] = await Promise.all([
                page.waitForResponse((r) =>
                  r.request().method() === 'POST' && r.url().endsWith('/arrange')
                ),
                page.getByRole('button', { name: i18n.t('assessments.arrange.save'), exact: true })
                  .click(),
              ]);
              expect(response.status()).toStrictEqual(200);
              await page.getByRole('status').filter({
                hasText: i18n.t('assessments.arrange.saved'),
              }).waitFor();
              const after = await getAssessment(ctx, assessment.id);
              if (!after) expect.unreachable('Expected after');
              expect(after.parts[0].placements).toStrictEqual(
                pinned.parts[0].placements.map((placement) => ({ ...placement, fixed: true })),
              );
              expect(
                await db.select().from(questionRevisions).where(
                  eq(questionRevisions.tenantId, ctx.tenantId),
                ).orderBy(questionRevisions.id),
              ).toStrictEqual(revisions);
              await page.reload({ waitUntil: 'networkidle' });
              await handle.waitFor();
              expect(errors).toStrictEqual([]);
            } catch (cause: unknown) {
              await captureBrowserFailure(page, evidence, 'qflow-arrange-pinned-protection');
              throw cause;
            }
          } finally {
            await context.close();
          }
        } finally {
          await deleteAssessment(ctx, assessment.id);
          await db.delete(authSessions).where(eq(authSessions.tenantId, ctx.tenantId));
        }
      });
    } finally {
      await app?.close();
      await shutdownDb();
    }
  },
);

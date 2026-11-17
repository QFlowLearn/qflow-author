import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { shutdownDb } from '../lib/db.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { questionPointsInputText } from '../lib/question_points.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { readInstructorDefaults } from '../lib/services/instructor_defaults.ts';
import { getUserSettings, saveUserSettings } from '../lib/services/user_settings.ts';
import { authoringPreferencesService } from '../lib/services/authoring_preferences.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';

testCase(
  'instructor point defaults recover invalid forms, save in five locales and seed only new eligible questions without rewriting overrides',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Point defaults QA' });
        const original = await getAssessment(ctx, assessment.id);
        assertQuestionOnlyAssessmentFixture(original);
        const created = await saveAssessmentQuestion(ctx, assessment.id, {
          _tag: 'Create',
          partId: original.parts[0].id,
          draft: {
            type: 'single_select',
            itemLanguage: newAuthoringItemLanguage(),
            title: 'Existing five points',
            bodyHtml: '<p>Choose Alpha.</p>',
            choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }],
            correctId: 'A',
            maximumScore: 5,
          },
        });
        if (!(created.ok)) expect.unreachable('Expected created.ok');
        const app = await openLocalAppBrowser({
          endpoint: {
            _tag: 'ManagedLocalApp',
            portRange: { first: 5410, lastExclusive: 5420 },
            environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
          },
          headless: true,
        });
        const context: import('playwright').BrowserContext = await app.newContext({
          authSession: await createSession({ tenantId: ctx.tenantId, userId: ctx.userId }),
          browser: { viewport: { width: 1280, height: 900 } },
        });
        const page: import('playwright').Page = await context.newPage();
        page.setDefaultTimeout(20_000);
        const errors: string[] = [];
        page.on('pageerror', (cause) => errors.push(safeErrorSummary(cause)));
        const editorUrl = `${app.baseUrl}/settings/editor`;
        const url = `${app.baseUrl}/assessments/${assessment.id}`;
        const endpoint = `${app.baseUrl}/api/assessments/${assessment.id}/questions`;
        const points = page.locator('[data-editor-field="maximumScore"] input');
        try {
          for (const locale of INTERFACE_LOCALES) {
            await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
            const i18n = createI18n(locale, catalogForLocale(locale));
            await page.goto(editorUrl);
            const preference = page.getByLabel(i18n.t('settings.editor.newQuestionPoints'), {
              exact: true,
            });
            const order = page.getByLabel(i18n.t('settings.editor.answerChoiceOrder'), {
              exact: true,
            });
            const richText = page.getByLabel(i18n.t('settings.editor.choiceRichText'), {
              exact: true,
            });
            const save = page.getByRole('button', {
              name: i18n.t('settings.editor.save'),
              exact: true,
            });
            const prior = await readInstructorDefaults(ctx);
            await preference.fill('-');
            await order.selectOption('authored');
            await richText.check();
            const [rejected] = await Promise.all([
              page.waitForResponse((response) =>
                response.url() === editorUrl && response.request().method() === 'POST'
              ),
              save.click(),
            ]);
            expect(rejected.status()).toStrictEqual(400);
            await page.getByText(i18n.t('settings.editor.pointsInvalid'), { exact: true })
              .waitFor();
            expect(await preference.inputValue()).toStrictEqual('-');
            expect(await preference.getAttribute('aria-invalid')).toStrictEqual('true');
            expect(await order.inputValue()).toStrictEqual('authored');
            expect(await richText.isChecked()).toStrictEqual(true);
            expect(await readInstructorDefaults(ctx)).toStrictEqual(prior);
            expect((await getUserSettings(ctx.userId)).choiceRichText).toStrictEqual(false);
            await preference.fill(questionPointsInputText(3.125, locale));
            await order.selectOption('question-default');
            await richText.uncheck();
            await save.focus();
            await Promise.all([
              page.waitForURL('**/settings/editor?success=1'),
              page.keyboard.press('Enter'),
            ]);
            expect(await readInstructorDefaults(ctx)).toStrictEqual({
              answerChoiceOrder: null,
              maximumScore: 3.125,
            });
            expect(await preference.inputValue()).toStrictEqual(
              questionPointsInputText(3.125, locale),
            );
            for (const theme of ['light', 'dark']) {
              await page.evaluate(
                (value) => document.documentElement.setAttribute('data-theme', value),
                theme,
              );
              for (const width of [1280, 390]) {
                await page.setViewportSize({ width, height: 900 });
                await preference.scrollIntoViewIfNeeded();
                expect(
                  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                ).toStrictEqual(true);
                await page.screenshot({
                  path: evidence.path(`instructor-points-${locale}-${theme}-${width}.png`),
                  fullPage: true,
                  animations: 'disabled',
                });
              }
            }
            await page.setViewportSize({ width: 1280, height: 900 });
          }
          await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
          const savePreference = async (value: string) => {
            await page.goto(editorUrl);
            await page.getByLabel('Points for new questions', { exact: true }).fill(value);
            await Promise.all([
              page.waitForURL('**/settings/editor?success=1'),
              page.getByRole('button', { name: 'Save preferences', exact: true }).click(),
            ]);
          };
          const start = async (type = 'Single select') => {
            await page.goto(url);
            await page.getByRole('button', { name: '+ Add Question', exact: true }).click();
            await page.locator('[data-type-option]').filter({ hasText: type }).click();
            if (type === 'Inline choice') {
              await page.getByLabel('Shuffle options', { exact: true }).waitFor();
            } else await points.waitFor();
          };
          await savePreference('0');
          expect(await readInstructorDefaults(ctx)).toStrictEqual({
            answerChoiceOrder: null,
            maximumScore: 0,
          });
          await start();
          expect(await points.inputValue()).toStrictEqual('0');
          await start('Multiple select');
          expect(await points.inputValue()).toStrictEqual('0');
          await start('Inline choice');
          expect(await points.count()).toStrictEqual(0);
          await page.goto(url);
          await page.getByRole('button', {
            name: 'Edit question 1.1: Existing five points',
            exact: true,
          }).click();
          await points.waitFor();
          expect(await points.inputValue()).toStrictEqual('5');
          await savePreference('2');
          await start();
          expect(await points.inputValue()).toStrictEqual('2');
          await points.fill('3');
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          await page.locator('[data-settings-group="details"] h3 button').click();
          const i18n = createI18n('en-US', catalogForLocale('en-US'));
          await page.getByText(
            i18n.t('assessments.builder.workspaceDefaultPoints', { points: '2' }),
            { exact: true },
          ).waitFor();
          const [saved] = await Promise.all([
            page.waitForResponse((response) =>
              response.url() === endpoint && response.request().method() === 'POST'
            ),
            page.getByRole('button', { name: 'Save question', exact: true }).click(),
          ]);
          expect(saved.status()).toStrictEqual(201);
          expect(await readInstructorDefaults(ctx)).toStrictEqual({
            answerChoiceOrder: null,
            maximumScore: 2,
          });
          expect(await authoringPreferencesService.read(ctx, assessment.id)).toStrictEqual([]);
          await page.goto(url);
          await page.getByRole('button', { name: /^Edit question 1\.2:/ }).click();
          await points.waitFor();
          expect(await points.inputValue()).toStrictEqual('3');
          const view = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(view);
          const placement = view.parts[0].placements[1];
          if (!(placement.snapshotRev !== null)) {
            expect.unreachable('Expected placement.snapshotRev !== null');
          }
          const revision = await getQuestionRevision(ctx, placement.itemId, placement.snapshotRev);
          if (!(revision?.qtiXml)) expect.unreachable('Expected revision?.qtiXml');
          expect(parsePersistedDraft(revision.body, 'single_select').maximumScore).toStrictEqual(3);
          const result = scoreQtiItemServerSide({
            itemXml: revision.qtiXml,
            trustedResponses: { RESPONSE: 'A' },
          });
          if (!(result.ok)) expect.unreachable('Expected result.ok');
          expect(result.score).toStrictEqual(3);
          await start();
          expect(await points.inputValue()).toStrictEqual('2');
          await savePreference('');
          expect(await readInstructorDefaults(ctx)).toStrictEqual(null);
          await start();
          expect(await points.inputValue()).toStrictEqual('1');
          expect(errors).toStrictEqual([]);
        } catch (cause: unknown) {
          await captureBrowserFailure(page, evidence, 'instructor-point-defaults');
          throw cause;
        } finally {
          await context.close();
          await app.close();
          await deleteAssessment(ctx, assessment.id);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

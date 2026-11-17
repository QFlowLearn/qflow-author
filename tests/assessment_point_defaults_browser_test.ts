import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import axe from 'axe-core';
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
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { saveEditorPreferences } from '../lib/services/instructor_defaults.ts';
import {
  readAssessmentQuestionPointDefault,
  saveAssessmentQuestionPointDefault,
} from '../lib/services/assessment_question_defaults.ts';
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
  'shared assessment point defaults preserve raw edits, exact retries, conflicts and open drafts in five locales',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Shared point defaults QA' });
        const initial = await getAssessment(ctx, assessment.id);
        assertQuestionOnlyAssessmentFixture(initial);
        const created = await saveAssessmentQuestion(ctx, assessment.id, {
          _tag: 'Create',
          partId: initial.parts[0].id,
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
        const before = await getAssessment(ctx, assessment.id);
        assertQuestionOnlyAssessmentFixture(before);
        const app = await openLocalAppBrowser({
          endpoint: {
            _tag: 'ManagedLocalApp',
            portRange: { first: 5460, lastExclusive: 5470 },
            environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
          },
          headless: true,
        });
        const context: import('playwright').BrowserContext = await app.newContext({
          authSession: await createSession(ctx),
          browser: { viewport: { width: 1280, height: 900 } },
        });
        const page: import('playwright').Page = await context.newPage();
        page.setDefaultTimeout(20_000);
        const errors: string[] = [];
        page.on('pageerror', (cause) => errors.push(safeErrorSummary(cause)));
        const url = `${app.baseUrl}/assessments/${assessment.id}`;
        const endpoint = `${app.baseUrl}/api/assessments/${assessment.id}/question-defaults`;
        let i18n = createI18n('en-US', catalogForLocale('en-US'));
        const field = () =>
          page.getByLabel(i18n.t('assessments.questionDefaults.points'), { exact: true });
        const rail = () =>
          page.getByRole('complementary', {
            name: i18n.t('assessments.settings.title'),
            exact: true,
          });
        const submit = () =>
          rail().getByRole('button', {
            name: i18n.t('assessments.questionDefaults.save'),
            exact: true,
          });
        async function openDefaults() {
          await page.getByRole('button', {
            name: new RegExp(`^${i18n.t('assessments.settings.title')}`),
          }).click();
          const toggle = rail().getByRole('button').filter({
            hasText: i18n.t('assessments.questionDefaults.title'),
          });
          await toggle.waitFor();
          if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
          await field().waitFor();
        }
        async function write(text: string) {
          await field().fill(text);
          const [response] = await Promise.all([
            page.waitForResponse((response) =>
              response.url() === endpoint && response.request().method() === 'PATCH'
            ),
            submit().click(),
          ]);
          expect(response.status()).toStrictEqual(200);
          await rail().getByText(i18n.t('assessments.questionDefaults.saved'), { exact: true })
            .waitFor();
          expect(await field().inputValue()).toStrictEqual(text);
        }
        async function saved(value: number | null) {
          expect(await readAssessmentQuestionPointDefault(ctx, assessment.id)).toStrictEqual({
            _tag: 'Found',
            value,
          });
        }
        const points = page.locator('[data-editor-field="maximumScore"] input');
        async function start(type = 'Single select') {
          await page.getByRole('button', { name: '+ Add Question', exact: true }).click();
          await page.locator('[data-type-option]').filter({ hasText: type }).click();
          await points.waitFor();
        }
        try {
          for (const locale of INTERFACE_LOCALES) {
            await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
            i18n = createI18n(locale, catalogForLocale(locale));
            await page.goto(url);
            await openDefaults();
            for (const raw of ['-', '-3', '1e309']) {
              await field().fill(raw);
              await field().press('Tab');
              expect(await field().inputValue()).toStrictEqual(raw);
              expect(await field().getAttribute('aria-invalid')).toStrictEqual('true');
              await rail().getByText(i18n.t('assessments.questionDefaults.invalid'), {
                exact: true,
              }).waitFor();
            }
            await submit().click();
            if (!(await field().evaluate((element) => element === document.activeElement))) {
              expect.unreachable(
                'Expected await field().evaluate((element) => element === document.activeElement)',
              );
            }
            await saved(null);
            await write(questionPointsInputText(3.125, locale));
            await saved(3.125);
            for (const theme of ['light', 'dark']) {
              await page.evaluate(
                (theme) => document.documentElement.setAttribute('data-theme', theme),
                theme,
              );
              for (const width of [1280, 390, 320]) {
                await page.setViewportSize({ width, height: 900 });
                if (
                  !(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
                ) {
                  expect.unreachable(
                    'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
                  );
                }
                if (!(await field().isVisible())) {
                  expect.unreachable('Expected await field().isVisible()');
                }
                await page.screenshot({
                  path: evidence.path(`shared-points-${locale}-${theme}-${width}.png`),
                  fullPage: true,
                });
              }
              await page.addScriptTag({ content: axe.source });
              const violations: unknown = await page.evaluate(
                "globalThis.axe.run(document.querySelector('#assessment-settings-inspector')).then(result => result.violations.map(v => v.id))",
              );
              expect(violations).toStrictEqual([]);
            }
            await write('0');
            await saved(0);
            await field().fill('');
            await field().press('Tab');
            await submit().focus();
            await Promise.all([
              page.waitForResponse((response) =>
                response.url() === endpoint && response.request().method() === 'PATCH'
              ),
              submit().press('Enter'),
            ]);
            await rail().getByText(i18n.t('assessments.questionDefaults.saved'), { exact: true })
              .waitFor();
            await saved(null);
            expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(before.parts);
          }
          await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
          await saveEditorPreferences(ctx, {
            choiceRichText: false,
            instructorDefaults: { answerChoiceOrder: null, maximumScore: 2 },
          });
          i18n = createI18n('en-US', catalogForLocale('en-US'));
          await page.setViewportSize({ width: 1280, height: 900 });
          await page.goto(url);
          await start();
          expect(await points.inputValue()).toStrictEqual('2');
          await openDefaults();
          for (
            const body of [
              '{',
              JSON.stringify({ expected: null, desired: '3' }),
              JSON.stringify({ expected: null, desired: -1 }),
              JSON.stringify({ expected: null, desired: 3, extra: true }),
            ]
          ) {
            const response = await context.request.patch(endpoint, {
              headers: { origin: app.baseUrl, 'content-type': 'application/json' },
              data: body,
            });
            expect(response.status()).toStrictEqual(400);
            expect(response.headers()['cache-control']).toStrictEqual('private, no-store');
            await saved(null);
          }
          const denied = await context.request.patch(endpoint, {
            headers: { origin: 'https://untrusted.example' },
            data: { expected: null, desired: 4 },
          });
          expect(denied.status()).toStrictEqual(403);
          await saved(null);
          await write('3');
          await rail().getByRole('button', {
            name: i18n.t('assessments.settings.close'),
            exact: true,
          }).click();
          expect(await points.inputValue()).toStrictEqual('2');
          await page.goto(url);
          await start();
          expect(await points.inputValue()).toStrictEqual('3');
          // Generated scoring requires a value. Explicit zero must not inherit the assessment default.
          await points.fill('');
          expect(
            await page.getByRole('button', { name: i18n.t('editor.save'), exact: true })
              .isEnabled(),
          ).toStrictEqual(false);
          await points.fill('0');
          const questionEndpoint = `${app.baseUrl}/api/assessments/${assessment.id}/questions`;
          const [questionSave] = await Promise.all([
            page.waitForResponse((response) =>
              response.url() === questionEndpoint && response.request().method() === 'POST'
            ),
            page.getByRole('button', { name: i18n.t('editor.save'), exact: true }).click(),
          ]);
          expect(questionSave.status(), await questionSave.text()).toStrictEqual(201);
          await page.getByRole('status').filter({ hasText: i18n.t('editor.itemSaved') }).waitFor();
          const view = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(view);
          const placement = view.parts[0].placements[1];
          if (!(placement.snapshotRev !== null)) {
            expect.unreachable('Expected placement.snapshotRev !== null');
          }
          const revision = await getQuestionRevision(ctx, placement.itemId, placement.snapshotRev);
          if (!revision) expect.unreachable('Expected revision');
          expect(parsePersistedDraft(revision.body, 'single_select').maximumScore).toStrictEqual(0);
          const existing = before.parts[0].placements[0];
          if (!(existing.snapshotRev !== null)) {
            expect.unreachable('Expected existing.snapshotRev !== null');
          }
          const original = await getQuestionRevision(ctx, existing.itemId, existing.snapshotRev);
          if (!(original?.qtiXml)) expect.unreachable('Expected original?.qtiXml');
          const grade = scoreQtiItemServerSide({
            itemXml: original.qtiXml,
            trustedResponses: { RESPONSE: 'A' },
          });
          if (!(grade.ok)) expect.unreachable('Expected grade.ok');
          expect(grade.score).toStrictEqual(5);
          await page.goto(url);
          await start('Multiple select');
          expect(await points.inputValue()).toStrictEqual('3');
          await page.goto(url);
          await page.getByRole('button', {
            name: 'Edit question 1.1: Existing five points',
            exact: true,
          }).click();
          await points.waitFor();
          expect(await points.inputValue()).toStrictEqual('5');
          await points.fill('7.5');
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          await page.locator('[data-settings-group="details"] h3 button').click();
          await page.getByText(
            i18n.t('assessments.builder.questionPointsOverride', { points: '7.5' }),
            { exact: true },
          ).waitFor();
          const [overrideSave] = await Promise.all([
            page.waitForResponse((response) =>
              response.url() === questionEndpoint && response.request().method() === 'POST'
            ),
            page.getByRole('button', { name: 'Save question', exact: true }).click(),
          ]);
          expect(overrideSave.status()).toStrictEqual(201);
          await saved(3);
          const overrideView = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(overrideView);
          const overridden = overrideView.parts[0].placements[0];
          if (!(overridden.snapshotRev !== null)) {
            expect.unreachable('Expected overridden.snapshotRev !== null');
          }
          const overrideRevision = await getQuestionRevision(
            ctx,
            overridden.itemId,
            overridden.snapshotRev,
          );
          if (!(overrideRevision?.qtiXml)) expect.unreachable('Expected overrideRevision?.qtiXml');
          expect(parsePersistedDraft(overrideRevision.body, 'single_select').maximumScore)
            .toStrictEqual(7.5);
          for (const [answer, score] of [['A', 7.5], ['B', 0]] as const) {
            const grade = scoreQtiItemServerSide({
              itemXml: overrideRevision.qtiXml,
              trustedResponses: { RESPONSE: answer },
            });
            if (!(grade.ok)) expect.unreachable('Expected grade.ok');
            expect(grade.score).toStrictEqual(score);
          }
          await openDefaults();
          // The server commits six; losing its response requires retrying six before saving seven.
          const commands: string[] = [];
          await page.route(endpoint, async (route) => {
            commands.push(route.request().postData() ?? '');
            const result = await route.fetch();
            expect(result.status()).toStrictEqual(200);
            await route.abort('failed');
          }, { times: 1 });
          await field().fill('6');
          await submit().click();
          await rail().getByText(i18n.t('assessments.questionDefaults.Uncertain'), { exact: true })
            .waitFor();
          await saved(6);
          await field().fill('7');
          await page.route(endpoint, async (route) => {
            commands.push(route.request().postData() ?? '');
            await route.continue();
          }, { times: 1 });
          await rail().getByRole('button', {
            name: i18n.t('assessments.questionDefaults.retry'),
            exact: true,
          }).click();
          await rail().getByText(i18n.t('assessments.questionDefaults.unsaved'), { exact: true })
            .waitFor();
          expect(commands.length).toStrictEqual(2);
          expect(commands[0]).toStrictEqual(commands[1]);
          expect(await field().inputValue()).toStrictEqual('7');
          await saved(6);
          await write('7');
          await saveAssessmentQuestionPointDefault(ctx, assessment.id, { expected: 7, desired: 8 });
          await field().fill('9');
          await submit().click();
          await rail().getByText(i18n.t('assessments.questionDefaults.Conflict'), { exact: true })
            .waitFor();
          await saved(8);
          await page.route(
            endpoint,
            (route) =>
              route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ _tag: 'Found', value: '8' }),
              }),
            { times: 1 },
          );
          await rail().getByRole('button', {
            name: i18n.t('assessments.questionDefaults.refresh'),
            exact: true,
          }).click();
          await rail().getByText(i18n.t('assessments.questionDefaults.RefreshFailed'), {
            exact: true,
          }).waitFor();
          expect(await field().inputValue()).toStrictEqual('9');
          if (!(await submit().isDisabled())) {
            expect.unreachable('Expected await submit().isDisabled()');
          }
          await rail().getByRole('button', {
            name: i18n.t('assessments.questionDefaults.refresh'),
            exact: true,
          }).click();
          await submit().waitFor({ state: 'visible' });
          await page.waitForFunction(() =>
            document.querySelector('input[name="maximumScore"]')?.getAttribute('aria-invalid') ===
              null
          );
          expect(await field().inputValue()).toStrictEqual('9');
          await write('9');
          // A later invalid edit must survive an acknowledgement of the captured valid command.
          const gate = Promise.withResolvers<void>();
          await page.route(endpoint, async (route) => {
            const response = await route.fetch();
            await gate.promise;
            await route.fulfill({ response });
          }, { times: 1 });
          try {
            await field().fill('10');
            await Promise.all([
              page.waitForRequest((request) =>
                request.url() === endpoint && request.method() === 'PATCH'
              ),
              submit().click(),
            ]);
            await field().fill('-');
            gate.resolve();
            await rail().getByText(i18n.t('assessments.questionDefaults.unsaved'), { exact: true })
              .waitFor();
            await field().press('Tab');
            expect(await field().inputValue()).toStrictEqual('-');
            expect(await field().getAttribute('aria-invalid')).toStrictEqual('true');
            await saved(10);
          } finally {
            gate.resolve();
          }
          await page.route(endpoint, async (route) => {
            const response = await route.fetch();
            expect(response.status()).toStrictEqual(200);
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ _tag: 'Saved', value: 12 }),
            });
          }, { times: 1 });
          await field().fill('11');
          await submit().click();
          await rail().getByText(i18n.t('assessments.questionDefaults.Uncertain'), { exact: true })
            .waitFor();
          await saved(11);
          expect(await field().inputValue()).toStrictEqual('11');
          await rail().getByRole('button', {
            name: i18n.t('assessments.questionDefaults.retry'),
            exact: true,
          }).click();
          await rail().getByText(i18n.t('assessments.questionDefaults.saved'), { exact: true })
            .waitFor();
          await saved(11);
          await write('3.125');
          expect(errors).toStrictEqual([]);
        } catch (cause: unknown) {
          await captureBrowserFailure(page, evidence, 'shared-point-defaults');
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

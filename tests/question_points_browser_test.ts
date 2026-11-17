import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { shutdownDb } from '../lib/db.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { captureBrowserLoading, observeBrowserLoading } from './helpers/browser_loading.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { questionPointsInputText } from '../lib/question_points.ts';
import { openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';

testCase(
  'live choice Points controls retain zero and fractions, invalid drafts, conflicts and locale layouts through actual revisions and grading',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Point controls QA' });
        const initial = await getAssessment(ctx, assessment.id);
        assertQuestionOnlyAssessmentFixture(initial);
        const created = await saveAssessmentQuestion(ctx, assessment.id, {
          _tag: 'Create',
          partId: initial.parts[0].id,
          draft: {
            type: 'single_select',
            itemLanguage: newAuthoringItemLanguage(),
            title: 'Choose Alpha',
            bodyHtml: '<p>Choose Alpha.</p>',
            choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }],
            correctId: 'A',
            responseMode: 'all_or_nothing',
          },
        });
        if (!(created.ok)) expect.unreachable(JSON.stringify(created));
        const multiple = await saveAssessmentQuestion(ctx, assessment.id, {
          _tag: 'Create',
          partId: initial.parts[0].id,
          draft: {
            type: 'multi_select',
            itemLanguage: newAuthoringItemLanguage(),
            title: 'Choose Alpha and Beta',
            bodyHtml: '<p>Choose Alpha and Beta.</p>',
            choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }, {
              id: 'C',
              text: 'Other',
            }],
            correctIds: ['A', 'B'],
            responseMode: 'partial',
          },
        });
        if (!(multiple.ok)) expect.unreachable(JSON.stringify(multiple));
        const app = await openLocalAppBrowser({
          endpoint: {
            _tag: 'ManagedLocalApp',
            portRange: { first: 5400, lastExclusive: 5410 },
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
        page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
        const loading = observeBrowserLoading(page, app.baseUrl, () => currentI18n.locale);
        const url = `${app.baseUrl}/assessments/${assessment.id}`;
        const endpoint = `${app.baseUrl}/api/assessments/${assessment.id}/questions`;
        const points = page.locator('[data-editor-field="maximumScore"] input');
        const save = () =>
          page.getByRole('button', {
            name: currentI18n.t('assessments.builder.saveQuestion'),
            exact: true,
          });
        let currentI18n = createI18n('en-US', catalogForLocale('en-US'));
        async function open() {
          await page.goto(url);
          await page.getByRole('button', {
            name: currentI18n.t('assessments.builder.editQuestion', {
              number: '1.1',
              title: 'Choose Alpha',
            }),
            exact: true,
          }).click();
          await points.waitFor();
        }
        async function openSettings() {
          await page.getByRole('button', {
            name: currentI18n.t('assessments.builder.questionSettings'),
            exact: true,
          }).click();
        }
        async function closeSettings() {
          await page.getByRole('button', {
            name: currentI18n.t('assessments.builder.closeQuestionSettings'),
            exact: true,
          }).click();
        }
        async function saveRevision() {
          await openSettings();
          const [response] = await Promise.all([
            page.waitForResponse((response) =>
              response.url() === endpoint && response.request().method() === 'POST'
            ),
            save().click(),
          ]);
          expect(response.status(), await response.text()).toStrictEqual(201);
          await page.getByText(currentI18n.t('editor.itemSaved'), { exact: true })
            .waitFor();
          await closeSettings();
        }
        async function grade(expected: number) {
          const view = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(view);
          const placement = view.parts[0].placements[0];
          if (!(placement.snapshotRev !== null)) {
            expect.unreachable('Expected placement.snapshotRev !== null');
          }
          const revision = await getQuestionRevision(ctx, placement.itemId, placement.snapshotRev);
          if (!revision) expect.unreachable('Expected revision');
          const draft = parsePersistedDraft(revision.body, 'single_select');
          expect(draft.maximumScore).toStrictEqual(expected);
          const preview = buildQtiPreviewXml(draft);
          if (!(preview.ok)) expect.unreachable('Expected preview.ok');
          for (const xml of [revision.qtiXml, preview.xml]) {
            if (!xml) expect.unreachable('Expected xml');
            for (const [response, score] of [['A', expected], ['B', 0]] as const) {
              const result = scoreQtiItemServerSide({
                itemXml: xml,
                trustedResponses: { RESPONSE: response },
              });
              if (!(result.ok)) expect.unreachable(JSON.stringify(result.diagnostics));
              expect(result.score).toStrictEqual(score);
            }
          }
        }
        try {
          for (const locale of INTERFACE_LOCALES) {
            await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
            currentI18n = createI18n(locale, catalogForLocale(locale));
            await open();
            if (locale === 'en-US') {
              expect(await points.inputValue()).toStrictEqual('1');
              await points.fill('');
              await points.press('Tab');
              expect(await points.inputValue()).toStrictEqual('1');
            }
            const labeled = page.getByLabel(currentI18n.t('driver.points.label'), { exact: true });
            expect(await labeled.count()).toStrictEqual(1);
            for (const value of [3, 0, 3.125]) {
              await points.fill(questionPointsInputText(value, locale));
              await points.press('Tab');
              await saveRevision();
              await grade(value);
              await open();
              expect(await points.inputValue()).toStrictEqual(
                questionPointsInputText(value, locale),
              );
              if (locale === 'en-US' && value === 3) {
                await page.getByRole('tab', {
                  name: currentI18n.t('editor.preview'),
                  exact: true,
                }).click();
                const preview = page.locator('[data-qti-preview-host="true"]');
                await preview.getByText(currentI18n.t('preview.ready'), { exact: true }).waitFor();
                for (const [answer, expected] of [['Alpha', 3], ['Beta', 0]] as const) {
                  await preview.getByRole('radio', { name: new RegExp(answer) }).click();
                  await preview.getByRole('button', {
                    name: currentI18n.t('preview.check'),
                    exact: true,
                  }).click();
                  await preview.getByText(currentI18n.t('preview.score'), { exact: true })
                    .waitFor();
                  const score = await preview.locator('qti-assessment-item-player').evaluate(
                    (element) => {
                      const serialize: unknown = Reflect.get(element, 'serialize');
                      if (typeof serialize !== 'function') {
                        throw new Error('Preview serialize API missing.');
                      }
                      const state: unknown = serialize.call(element);
                      if (!state || typeof state !== 'object') {
                        throw new Error('Preview state missing.');
                      }
                      const outcomes: unknown = Reflect.get(state, 'outcomes');
                      if (!outcomes || typeof outcomes !== 'object') {
                        throw new Error('Preview outcomes missing.');
                      }
                      return Reflect.get(outcomes, 'SCORE');
                    },
                  );
                  expect(score).toStrictEqual(expected);
                  await preview.getByRole('button', {
                    name: currentI18n.t('preview.resetButton'),
                    exact: true,
                  }).click();
                  await preview.getByText(currentI18n.t('preview.reset'), { exact: true })
                    .waitFor();
                }
                await page.getByRole('tab', {
                  name: currentI18n.t('editor.content'),
                  exact: true,
                }).click();
              }
            }
            const before = await getAssessment(ctx, assessment.id);
            for (const invalid of ['-', '-3', '1e309']) {
              await points.fill(invalid);
              await points.press('Tab');
              expect(await points.inputValue()).toStrictEqual(invalid);
              expect(await points.getAttribute('aria-invalid')).toStrictEqual('true');
              await page.getByText(currentI18n.t('driver.points.invalid'), { exact: true }).first()
                .waitFor();
              await openSettings();
              expect(await save().isDisabled()).toStrictEqual(true);
              await page.getByRole('button', {
                name: currentI18n.t('inspector.reviewPoints'),
                exact: true,
              }).click();
              await page.waitForFunction(() =>
                document.activeElement?.closest('[data-editor-field="maximumScore"]') !== null
              );
              expect(await getAssessment(ctx, assessment.id)).toStrictEqual(before);
            }
            await points.fill(questionPointsInputText(3.125, locale));
            await points.press('Tab');
            expect(await points.getAttribute('aria-invalid')).toStrictEqual(null);
          }
          // A transport conflict preserves the author's point input and the saved placement.
          const beforeConflict = await getAssessment(ctx, assessment.id);
          await points.fill('9');
          await page.route(
            endpoint,
            (route) =>
              route.fulfill({
                status: 409,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'revision_conflict' }),
              }),
            { times: 1 },
          );
          await openSettings();
          const [conflict] = await Promise.all([
            page.waitForResponse((response) =>
              response.url() === endpoint && response.status() === 409
            ),
            save().click(),
          ]);
          expect(conflict.status()).toStrictEqual(409);
          await closeSettings();
          expect(await points.inputValue()).toStrictEqual('9');
          expect(await getAssessment(ctx, assessment.id)).toStrictEqual(beforeConflict);
          await points.fill('0');
          await saveRevision();
          await grade(0);
          await open();
          expect(await points.inputValue()).toStrictEqual('0');
          await points.focus();
          await points.press('End');
          await points.press('5');
          expect(await points.inputValue()).toStrictEqual('05');
          await points.press('ControlOrMeta+Z');
          expect(await points.inputValue()).toStrictEqual('0');
          // Later raw editing during a real pending revision stays dirty after that snapshot saves.
          const gate = Promise.withResolvers<void>();
          const requested = Promise.withResolvers<void>();
          await page.route(endpoint, async (route) => {
            requested.resolve();
            await gate.promise;
            await route.continue();
          }, { times: 1 });
          try {
            await points.fill('9');
            await openSettings();
            const response = page.waitForResponse((response) =>
              response.url() === endpoint && response.request().method() === 'POST'
            );
            await save().click();
            await requested.promise;
            await closeSettings();
            await points.fill('-');
            gate.resolve();
            expect((await response).status()).toStrictEqual(201);
            await grade(9);
            expect(await points.inputValue()).toStrictEqual('-');
            await openSettings();
            await page.getByText(currentI18n.t('editor.unsavedChanges'), {
              exact: true,
            }).waitFor();
            expect(await save().isDisabled()).toStrictEqual(true);
            await closeSettings();
          } finally {
            gate.resolve();
            await page.unrouteAll({ behavior: 'wait' });
          }
          await points.fill('0');
          await saveRevision();
          await grade(0);
          await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
          currentI18n = createI18n('en-US', catalogForLocale('en-US'));
          await page.goto(url);
          await page.getByRole('button', {
            name: 'Edit question 1.2: Choose Alpha and Beta',
            exact: true,
          }).click();
          await points.waitFor();
          expect(await points.inputValue()).toStrictEqual('2');
          await points.fill('2.5');
          await page.getByText(currentI18n.t('driver.points.help'), { exact: true }).click();
          await page.getByText(currentI18n.t('driver.points.partial'), { exact: true }).waitFor();
          await saveRevision();
          await page.goto(url);
          await page.getByRole('button', {
            name: 'Edit question 1.2: Choose Alpha and Beta',
            exact: true,
          }).click();
          await points.waitFor();
          expect(await points.inputValue()).toStrictEqual('2.5');
          const multiView = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(multiView);
          const placement = multiView.parts[0].placements[1];
          if (!(placement.snapshotRev !== null)) {
            expect.unreachable('Expected placement.snapshotRev !== null');
          }
          const savedMulti = await getQuestionRevision(
            ctx,
            placement.itemId,
            placement.snapshotRev,
          );
          if (!savedMulti) expect.unreachable('Expected savedMulti');
          const multiDraft = parsePersistedDraft(savedMulti.body, 'multi_select');
          const multiPreview = buildQtiPreviewXml(multiDraft);
          if (!(multiPreview.ok)) expect.unreachable('Expected multiPreview.ok');
          for (const xml of [savedMulti.qtiXml, multiPreview.xml]) {
            if (!xml) expect.unreachable('Expected xml');
            for (
              const [responses, score] of [[['A'], 1.25], [['A', 'B'], 2.5], [['C'], 0], [[
                'A',
                'C',
              ], 1.25], [['A', 'B', 'C'], 2.5]] as const
            ) {
              const result = scoreQtiItemServerSide({
                itemXml: xml,
                trustedResponses: { RESPONSE: [...responses] },
              });
              if (!(result.ok)) expect.unreachable(JSON.stringify(result.diagnostics));
              expect(result.score).toStrictEqual(score);
            }
          }
          for (const locale of INTERFACE_LOCALES) {
            await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
            currentI18n = createI18n(locale, catalogForLocale(locale));
            await open();
            await points.fill(questionPointsInputText(3.125, locale));
            await points.press('Tab');
            for (const theme of ['light', 'dark']) {
              await page.evaluate(
                (value) => document.documentElement.setAttribute('data-theme', value),
                theme,
              );
              for (const width of [1280, 390]) {
                await page.setViewportSize({ width, height: 900 });
                await points.scrollIntoViewIfNeeded();
                await page.waitForFunction(() =>
                  document.documentElement.scrollWidth <= innerWidth
                );
                expect(
                  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                ).toStrictEqual(true);
                await page.screenshot({
                  path: evidence.path(`qflow-points-${locale}-${theme}-${width}.png`),
                  fullPage: true,
                  animations: 'disabled',
                });
              }
            }
            await page.setViewportSize({ width: 1280, height: 900 });
            await points.fill('0');
          }
          // A real newer save in another tab cannot be replaced by this tab's presentation edit.
          await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
          currentI18n = createI18n('en-US', catalogForLocale('en-US'));
          await open();
          const oldView = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(oldView);
          const oldPlacement = oldView.parts[0].placements[0];
          if (!(oldPlacement.snapshotRev !== null)) {
            expect.unreachable('Expected oldPlacement.snapshotRev !== null');
          }
          const oldRevision = await getQuestionRevision(
            ctx,
            oldPlacement.itemId,
            oldPlacement.snapshotRev,
          );
          if (!oldRevision) expect.unreachable('Expected oldRevision');
          const oldDraft = parsePersistedDraft(oldRevision.body, 'single_select');
          const presentation = page.getByRole('combobox', { name: 'Question type', exact: true });
          await presentation.selectOption('inline_choice');
          await page.getByPlaceholder('Choice A').fill('Older tab answer');
          const newer = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Revise',
            itemId: oldPlacement.itemId,
            placementId: oldPlacement.id,
            expectedParentRevision: oldPlacement.snapshotRev,
            draft: { ...oldDraft, title: 'Changed in another tab' },
          });
          if (!(newer.ok)) expect.unreachable('Expected newer.ok');
          const newerView = await getAssessment(ctx, assessment.id);
          const newerRevision = await getQuestionRevision(ctx, oldPlacement.itemId);
          await openSettings();
          const [stale] = await Promise.all([
            page.waitForResponse((response) =>
              response.url() === endpoint && response.request().method() === 'POST'
            ),
            save().click(),
          ]);
          expect(stale.status()).toStrictEqual(409);
          expect((await stale.json()).error).toStrictEqual('stale_parent_revision');
          expect(stale.request().postDataJSON().expectedParentRevision).toStrictEqual(
            oldPlacement.snapshotRev,
          );
          await closeSettings();
          await page.getByRole('alert').filter({ hasText: currentI18n.t('editor.staleRevision') })
            .waitFor();
          expect(await presentation.inputValue()).toStrictEqual('inline_choice');
          expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
            'Older tab answer',
          );
          const undoPresentation = page.getByRole('button', {
            name: 'Undo type change',
            exact: true,
          });
          if (!(await undoPresentation.isEnabled())) {
            expect.unreachable('Expected await undoPresentation.isEnabled()');
          }
          await undoPresentation.click();
          expect(await presentation.inputValue()).toStrictEqual('single_select');
          expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
            'Older tab answer',
          );
          expect(await getAssessment(ctx, assessment.id)).toStrictEqual(newerView);
          expect(await getQuestionRevision(ctx, oldPlacement.itemId)).toStrictEqual(newerRevision);
          await page.screenshot({
            path: evidence.path('stale-presentation-save.png'),
            fullPage: true,
          });
          expect(errors).toStrictEqual([]);
        } catch (cause: unknown) {
          const layout = await page.evaluate(() => ({
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            toolbar: [...document.querySelectorAll('.rte-toolbar')].map((element) => ({
              width: element.getBoundingClientRect().width,
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              overflowX: getComputedStyle(element).overflowX,
              overflowY: getComputedStyle(element).overflowY,
            })),
            roots: [document.documentElement, document.body].map((element) => ({
              tag: element.tagName,
              width: element.clientWidth,
              scroll: element.scrollWidth,
              rect: element.getBoundingClientRect().toJSON(),
              overflow: getComputedStyle(element).overflowX,
            })),
            overflowBoxes: [...document.querySelectorAll('body *')].filter((element) =>
              element.scrollWidth > element.clientWidth + 1
            ).map((element) => ({
              tag: element.tagName,
              classes: String(element.className),
              width: element.clientWidth,
              scroll: element.scrollWidth,
              rect: element.getBoundingClientRect().toJSON(),
              overflow: getComputedStyle(element).overflowX,
            })).slice(0, 25),
            outside: [...document.querySelectorAll('body *')].flatMap((element) => {
              const r = element.getBoundingClientRect();
              return r.right > innerWidth && r.width > 0
                ? [{
                  tag: element.tagName,
                  id: element.id,
                  classes: String(element.className),
                  right: r.right,
                  width: r.width,
                  overflow: getComputedStyle(element).overflowX,
                }]
                : [];
            }).slice(0, 20),
          }));
          console.log('Point layout diagnostic:', JSON.stringify(layout));
          await captureBrowserFailure(page, evidence, 'qflow-points-controls');
          await captureBrowserLoading(loading, evidence, 'qflow-points-controls');
          throw cause;
        } finally {
          loading.stop();
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

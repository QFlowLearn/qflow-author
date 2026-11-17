import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';

import { assertProtectedQuestionShuffle } from './helpers/assessment_question_order_assertions.ts';
import { assertAssessmentSettingsVisuals } from './helpers/assessment_settings_visual_assertions.ts';
import { eq } from 'drizzle-orm';
import axe from 'axe-core';
import { db, shutdownDb } from '../lib/db.ts';
import { assessments, authSessions, questionRevisions } from '../lib/db/schema.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { buildAssessmentTestXml } from '../lib/test_export.ts';
import { parseAssessmentPartOptions } from '../lib/assessment_arrangement.ts';
testCase(
  'real assessment settings preserve drafts, canonical parts and save recovery across locales and themes',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        app = await openLocalAppBrowser({
          endpoint: {
            _tag: 'ManagedLocalApp',
            portRange: { first: 5430, lastExclusive: 5440 },
            environment: {
              ...builtWorkerBrowserEnvironment,
              DATABASE_URL: databaseUrl,
              QFLOW_DELIVERY_PUBLISH_URL: '',
              QFLOW_DELIVERY_SIGNING_SECRET: '',
              QFLOW_DELIVERY_CAPABILITY_URL: '',
              QFLOW_DELIVERY_STATE_URL: '',
            },
          },
          headless: true,
        });
        for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
          await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
          const i18n = createI18n(locale, catalogForLocale(locale));
          for (const theme of ['wireframe', 'dark']) {
            const exerciseSaveProtocol = locale === 'en-US' && theme === 'wireframe';
            const assessment = await createAssessmentDraft(ctx, {
              title: 'Assessment settings regression',
            });
            const initial = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(initial);
            const options = {
              navigationMode: 'nonlinear',
              submissionMode: 'simultaneous',
              timeLimits: { minTime: 10, maxTime: 300 },
              instructionsHtml: '<p>Keep authored instructions.</p>',
              feedback: [{
                id: crypto.randomUUID(),
                access: 'atEnd',
                showHide: 'show',
                outcomeIdentifier: 'TEST_FEEDBACK',
                html: '<p>Keep feedback.</p>',
              }],
            };
            const otherPartId = crypto.randomUUID();
            await saveAssessmentArrangementFixture(ctx, assessment.id, [{
              ...initial.parts[0],
              options,
            }, {
              id: otherPartId,
              title: 'Independent part',
              options: { shuffleQuestions: false },
              placements: [],
            }]);
            const items: Array<{ itemId: string; placementId: string }> = [];
            for (const title of ['First question', 'Second question', 'Protected question']) {
              const saved = await saveAssessmentQuestion(ctx, assessment.id, {
                _tag: 'Create',
                partId: initial.parts[0].id,
                draft: {
                  type: 'single_select',
                  title,
                  itemLanguage: newAuthoringItemLanguage(),
                  bodyHtml: '<p>Which city is in France?</p>',
                  choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
                  correctId: 'A',
                },
              });
              if (!(saved.ok)) expect.unreachable('Expected saved.ok');
              items.push(saved.value);
            }
            const created = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(created);
            await saveAssessmentArrangementFixture(
              ctx,
              assessment.id,
              created.parts.map((part, index) => ({
                ...part,
                placements: part.placements.map((placement, position) => ({
                  ...placement,
                  fixed: index === 0 && position === 2,
                })),
              })),
            );
            const version = crypto.randomUUID();
            const adminUrl = `https://delivery.example/assessments?assessmentVersionId=${version}`;
            await db.update(assessments).set({
              metadata: {
                delivery: {
                  latestPublish: {
                    assessmentVersionId: version,
                    adminUrl,
                    publishedAt: '2026-10-06T12:00:00.000Z',
                  },
                },
              },
            }).where(eq(assessments.id, assessment.id));
            const before = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(before);
            const revisions = await db.select().from(questionRevisions).where(
              eq(questionRevisions.tenantId, ctx.tenantId),
            ).orderBy(questionRevisions.id);
            const context: import('playwright').BrowserContext = await app.newContext({
              authSession: await createSession(ctx),
              browser: { viewport: { width: 390, height: 844 } },
            });
            const page: import('playwright').Page = await context.newPage();
            page.setDefaultTimeout(20000);
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
            const confirmReplies: boolean[] = [];
            page.on('dialog', async (dialog) => {
              expect(dialog.type()).toStrictEqual('confirm');
              if (confirmReplies.shift()) await dialog.accept();
              else await dialog.dismiss();
            });
            let writes = 0;
            page.on('request', (request) => {
              if (request.method() === 'POST' && request.url().endsWith('/arrange')) writes++;
            });
            const rail = page.getByRole('complementary', {
              name: i18n.t('assessments.settings.title'),
              exact: true,
            });
            const entry = page.getByRole('button', {
              name: new RegExp(`^${i18n.t('assessments.settings.title')}`),
            });
            const partTitle = i18n.t('assessments.settings.part', {
              number: 1,
              title: before.parts[0].title,
            });
            const partToggle = rail.getByRole('button').filter({ hasText: partTitle });
            const shuffle = rail.getByRole('checkbox', {
              name: i18n.t('assessments.partSettings.shuffleQuestions'),
              exact: true,
            });
            const protectionSummary = rail.locator('summary').filter({
              hasText: i18n.t('assessments.partSettings.fixedQuestions'),
            });
            const firstFixed = rail.getByRole('checkbox', { name: /First question$/ });
            const secondFixed = rail.getByRole('checkbox', { name: /Second question$/ });
            const thirdFixed = rail.getByRole('checkbox', { name: /Protected question$/ });
            const openProtection = async () => {
              const open = await protectionSummary.locator('..').getAttribute('open');
              if (open === null) await protectionSummary.click();
            };
            const minimum = rail.getByRole('textbox', {
              name: i18n.t('assessments.arrange.modal.minTime'),
              exact: true,
            });
            const maximum = rail.getByRole('textbox', {
              name: i18n.t('assessments.arrange.modal.maxTime'),
              exact: true,
            });
            const save = rail.getByRole('button', {
              name: i18n.t('assessments.settings.save'),
              exact: true,
            });
            const endpoint = `**/api/assessments/${assessment.id}/arrange`;
            const close = () =>
              rail.getByRole('button', { name: i18n.t('assessments.settings.close'), exact: true })
                .click();
            const savedStatus = () =>
              rail.getByRole('status').filter({ hasText: i18n.t('assessments.settings.saved') })
                .waitFor();
            const saveResponse = async (status = 200) => {
              const [response] = await Promise.all([
                page.waitForResponse((r) =>
                  r.request().method() === 'POST' && r.url().endsWith('/arrange')
                ),
                save.click(),
              ]);
              expect(response.status()).toStrictEqual(status);
              return response;
            };
            try {
              await page.goto(`${app.baseUrl}/assessments/${assessment.id}`, {
                waitUntil: 'networkidle',
              });
              await page.evaluate(
                (value) => document.documentElement.setAttribute('data-theme', value),
                theme,
              );
              expect(await page.locator('input[data-retained-question]').count()).toStrictEqual(0);
              await entry.click();
              await rail.waitFor();
              expect(await partToggle.getAttribute('aria-expanded')).toStrictEqual('false');
              expect(await partToggle.innerText()).toContain(
                i18n.t('assessments.partSettings.authoredQuestionOrder'),
              );
              expect(await partToggle.innerText()).toContain(
                i18n.t('assessments.settings.maximum', { seconds: '300' }),
              );
              expect(await partToggle.innerText()).toContain(
                i18n.t('assessments.settings.feedbackCount', { count: 1 }),
              );
              if (!(await save.isDisabled())) {
                expect.unreachable('Expected await save.isDisabled()');
              }
              await rail.getByRole('button').filter({
                hasText: i18n.t('assessments.settings.delivery'),
              }).click();
              expect(
                await rail.getByRole('link', {
                  name: i18n.t('assessments.settings.manageDelivery'),
                  exact: true,
                }).getAttribute('href'),
              ).toStrictEqual(adminUrl);
              await rail.getByText(i18n.t('assessments.settings.version', { version }), {
                exact: true,
              }).waitFor();
              await partToggle.click();
              expect(await shuffle.isChecked()).toStrictEqual(false);
              expect(await shuffle.getAttribute('aria-describedby') ?? '').toContain(
                'question-shuffle-help',
              );
              await shuffle.focus();
              await shuffle.press('Space');
              expect(await shuffle.isChecked()).toStrictEqual(true);
              await openProtection();
              expect(await protectionSummary.innerText()).toContain(
                i18n.t('assessments.partSettings.fixedQuestionCount', { count: 1 }),
              );
              expect(await firstFixed.isChecked()).toStrictEqual(false);
              expect(await secondFixed.isChecked()).toStrictEqual(false);
              expect(await thirdFixed.isChecked()).toStrictEqual(true);
              await firstFixed.focus();
              await firstFixed.press('Space');
              expect(await firstFixed.isChecked()).toStrictEqual(true);
              await maximum.fill('600');
              await partToggle.click();
              expect(await partToggle.innerText()).toContain(
                i18n.t('assessments.partSettings.shuffledQuestionOrder'),
              );
              expect(await partToggle.innerText()).toContain(
                i18n.t('assessments.settings.maximum', { seconds: '600' }),
              );
              const [keyboardSave] = await Promise.all([
                page.waitForResponse((response) =>
                  response.request().method() === 'POST' && response.url().endsWith('/arrange')
                ),
                save.press('Enter'),
              ]);
              expect(keyboardSave.status()).toStrictEqual(200);
              await savedStatus();
              const firstSaved = await getAssessment(ctx, assessment.id);
              assertQuestionOnlyAssessmentFixture(firstSaved);
              expect(firstSaved.parts[0].placements).toStrictEqual(
                before.parts[0].placements.map((placement, index) => ({
                  ...placement,
                  fixed: index === 0 || placement.fixed,
                })),
              );
              expect(firstSaved.parts[0].options).toStrictEqual({
                ...options,
                shuffleQuestions: true,
                timeLimits: { minTime: 10, maxTime: 600 },
              });
              expect(firstSaved.parts[1]).toStrictEqual(before.parts[1]);
              expect(
                await db.select().from(questionRevisions).where(
                  eq(questionRevisions.tenantId, ctx.tenantId),
                ).orderBy(questionRevisions.id),
              ).toStrictEqual(revisions);
              await close();
              expect(await entry.evaluate((node) => node === document.activeElement)).toStrictEqual(
                true,
              );
              await page.reload({ waitUntil: 'networkidle' });
              await page.evaluate(
                (value) => document.documentElement.setAttribute('data-theme', value),
                theme,
              );
              await entry.click();
              await partToggle.click();
              expect(await maximum.inputValue()).toStrictEqual('600');
              expect(await shuffle.isChecked()).toStrictEqual(true);
              await openProtection();
              expect(await firstFixed.isChecked()).toStrictEqual(true);
              expect(await thirdFixed.isChecked()).toStrictEqual(true);
              await partToggle.click();
              const otherPartToggle = rail.getByRole('button').filter({
                hasText: i18n.t('assessments.settings.part', {
                  number: 2,
                  title: 'Independent part',
                }),
              });
              expect(await otherPartToggle.innerText()).toContain(
                i18n.t('assessments.partSettings.authoredQuestionOrder'),
              );
              await otherPartToggle.click();
              expect(await shuffle.isChecked()).toStrictEqual(false);
              if (!(await save.isDisabled())) {
                expect.unreachable('Expected await save.isDisabled()');
              }
              await otherPartToggle.click();
              await partToggle.click();
              expect(await shuffle.isChecked()).toStrictEqual(true);
              await close();

              const card = page.locator(`#assessment-question-${items[1].placementId}`);
              const saveQuestion = async () => {
                const [response] = await Promise.all([
                  page.waitForResponse((response) =>
                    response.request().method() === 'POST' && response.url().endsWith('/questions')
                  ),
                  card.getByRole('button', { name: i18n.t('editor.save'), exact: true }).click(),
                ]);
                expect(response.status()).toStrictEqual(201);
                await card.getByRole('status').filter({ hasText: i18n.t('editor.itemSaved') })
                  .waitFor();
              };
              await card.getByRole('button', {
                name: i18n.t('assessments.builder.editQuestion', {
                  number: '1.2',
                  title: 'Second question',
                }),
                exact: true,
              }).getByText('Second question', { exact: true }).click();
              const answer = card.getByRole('textbox', {
                name: i18n.t('driver.choicePlaceholder', { id: 'A' }),
                exact: true,
              });
              await answer.fill('Unsaved city');
              await answer.press('End');
              await page.keyboard.type('!');
              await answer.evaluate((node) => node.setAttribute('data-retained-question', 'yes'));
              await entry.click();
              await close();
              await answer.focus();
              await answer.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
              expect(await answer.inputValue()).toStrictEqual('Unsaved city');
              await answer.press('End');
              await page.keyboard.type('!');
              await entry.click();
              await minimum.fill('-');
              await thirdFixed.uncheck();
              expect(await minimum.inputValue()).toStrictEqual('-');
              await shuffle.uncheck();
              expect(await minimum.inputValue()).toStrictEqual('-');
              await openProtection();
              expect(await thirdFixed.isChecked()).toStrictEqual(false);
              await thirdFixed.check();
              expect(await minimum.inputValue()).toStrictEqual('-');
              await shuffle.check();
              await maximum.focus();
              await rail.getByText(i18n.t('assessments.partSettings.timeNumber'), { exact: true })
                .waitFor();
              if (!(await save.isDisabled())) {
                expect.unreachable('Expected await save.isDisabled()');
              }
              const invalidWrites = writes;
              await partToggle.click();
              await close();
              await entry.click();
              expect(await partToggle.getAttribute('aria-expanded')).toStrictEqual('false');
              await partToggle.click();
              expect(await minimum.inputValue()).toStrictEqual('-');
              await minimum.fill('700');
              await maximum.focus();
              await rail.getByText(i18n.t('assessments.partSettings.timeRange'), { exact: true })
                .waitFor();
              expect(writes).toStrictEqual(invalidWrites);
              await page.addScriptTag({ content: axe.source });
              await rail.getByText(i18n.t('assessments.partSettings.timeRange'), { exact: true })
                .scrollIntoViewIfNeeded();
              const contrast: unknown = await page.evaluate(
                `globalThis.axe.run(document.querySelector('#assessment-settings-inspector [role="alert"][id]'),{runOnly:{type:'rule',values:['color-contrast']}}).then(result=>({violations:result.violations.length,incomplete:result.incomplete.length,checked:result.passes.length>0}))`,
              );
              expect(contrast).toStrictEqual({ violations: 0, incomplete: 0, checked: true });
              if (
                !(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
              ) {
                expect.unreachable(
                  'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
                );
              }
              await page.screenshot({
                path: evidence.path(`qflow-assessment-settings-${locale}-${theme}-invalid.png`),
              });
              await minimum.fill('10');
              await close();
              expect(await answer.getAttribute('data-retained-question')).toStrictEqual('yes');
              expect(await answer.inputValue()).toStrictEqual('Unsaved city!');

              // Keep real localized saves in the matrix and exhaustive commit/replay races once.
              let remote = firstSaved;
              if (exerciseSaveProtocol) {
                // A committed settings response waits while newer raw edits return to the prior value.
                await entry.click();
                await minimum.fill('20');
                const committed = Promise.withResolvers<void>(),
                  release = Promise.withResolvers<void>();
                await page.route(endpoint, async (route) => {
                  const response = await route.fetch();
                  expect(response.status()).toStrictEqual(200);
                  committed.resolve();
                  await release.promise;
                  await route.fulfill({ response });
                });
                await save.click();
                await committed.promise;
                await minimum.fill('10');
                await shuffle.uncheck();
                await firstFixed.uncheck();
                await close();
                const move = page.locator(`#move-question-${items[1].placementId}`);
                expect(await move.getAttribute('aria-disabled')).toStrictEqual('true');
                const blockedWrites = writes;
                await move.press('ArrowUp');
                expect(writes).toStrictEqual(blockedWrites);
                release.resolve();
                await entry.click();
                await rail.getByRole('status').filter({
                  hasText: i18n.t('assessments.settings.unsaved'),
                }).waitFor();
                expect(await minimum.inputValue()).toStrictEqual('10');
                expect(await shuffle.isChecked()).toStrictEqual(false);
                expect(await firstFixed.isChecked()).toStrictEqual(false);
                expect((await getAssessment(ctx, assessment.id))?.parts[0].placements[0].fixed)
                  .toStrictEqual(true);
                expect((await getAssessment(ctx, assessment.id))?.parts[0].options.shuffleQuestions)
                  .toStrictEqual(true);
                expect((await getAssessment(ctx, assessment.id))?.parts[0].options.timeLimits)
                  .toStrictEqual({
                    minTime: 20,
                    maxTime: 600,
                  });
                await page.unroute(endpoint);
                await saveResponse();
                await savedStatus();
                expect((await getAssessment(ctx, assessment.id))?.parts[0].options.shuffleQuestions)
                  .toStrictEqual(false);
                expect((await getAssessment(ctx, assessment.id))?.parts[0].placements[0].fixed)
                  .toStrictEqual(false);
                await shuffle.check();
                await saveResponse();
                await savedStatus();

                // A confirmed own question save during a pending settings response retains its newer pin.
                const ownCommitted = Promise.withResolvers<void>(),
                  ownRelease = Promise.withResolvers<void>();
                await page.route(endpoint, async (route) => {
                  const response = await route.fetch();
                  expect(response.status()).toStrictEqual(200);
                  ownCommitted.resolve();
                  await ownRelease.promise;
                  await route.fulfill({ response });
                });
                await maximum.fill('700');
                await secondFixed.check();
                await save.click();
                await ownCommitted.promise;
                expect((await getAssessment(ctx, assessment.id))?.parts[0].placements[1].fixed)
                  .toStrictEqual(true);
                await secondFixed.uncheck();
                await close();
                await answer.fill('Concurrent question save');
                await saveQuestion();
                ownRelease.resolve();
                await entry.click();
                await rail.getByRole('status').filter({
                  hasText: i18n.t('assessments.settings.unsaved'),
                }).waitFor();
                expect(await secondFixed.isChecked()).toStrictEqual(false);
                await page.unroute(endpoint);
                await maximum.fill('750');
                await saveResponse();
                await savedStatus();
                const ownSaved = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(ownSaved);
                expect(ownSaved.parts[0].placements[1].snapshotRev).toStrictEqual(2);
                expect(ownSaved.parts[0].placements[1].fixed).toStrictEqual(false);
                expect(ownSaved.parts[0].placements.map((p) => p.id)).toStrictEqual(
                  before.parts[0].placements.map((p) => p.id),
                );

                // A genuinely lost committed response retries the exact command despite newer invalid input.
                let lost: string | null = null;
                await page.route(endpoint, async (route) => {
                  lost = route.request().postData();
                  const response = await route.fetch();
                  expect(response.status()).toStrictEqual(200);
                  await route.abort('failed');
                });
                await maximum.fill('800');
                await save.click();
                await rail.getByText(i18n.t('assessments.settings.uncertain'), { exact: true })
                  .waitFor();
                if (!lost) expect.unreachable('Expected lost');
                await maximum.fill('-');
                await thirdFixed.uncheck();
                await minimum.focus();
                await page.unroute(endpoint);
                const [retry] = await Promise.all([
                  page.waitForResponse((r) =>
                    r.request().method() === 'POST' && r.url().endsWith('/arrange')
                  ),
                  rail.getByRole('button', {
                    name: i18n.t('assessments.builder.tool.retry'),
                    exact: true,
                  }).click(),
                ]);
                expect(retry.status()).toStrictEqual(200);
                expect(retry.request().postData()).toStrictEqual(lost);
                await rail.getByRole('status').filter({
                  hasText: i18n.t('assessments.settings.unsaved'),
                }).waitFor();
                expect(await maximum.inputValue()).toStrictEqual('-');
                expect(await thirdFixed.isChecked()).toStrictEqual(false);
                if (!(await save.isDisabled())) {
                  expect.unreachable('Expected await save.isDisabled()');
                }
                await thirdFixed.check();
                await maximum.fill('900');
                await saveResponse();
                await savedStatus();
                const preserved = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(preserved);
                expect(preserved.parts[0].options).toStrictEqual({
                  ...options,
                  shuffleQuestions: true,
                  timeLimits: { minTime: 10, maxTime: 900 },
                });
                const parsed = parseAssessmentPartOptions(preserved.parts[0].options);
                if (!(parsed.ok)) expect.unreachable('Expected parsed.ok');
                const xml = buildAssessmentTestXml(preserved, [{
                  ...preserved.parts[0],
                  options: parsed.options,
                  placements: preserved.parts[0].placements.map((p) => ({
                    ...p,
                    snapshotRev: p.snapshotRev ?? undefined,
                  })),
                }]);
                expect(xml).toContain('max-time="900"');
                expect(xml).toContain('min-time="10"');
                assertProtectedQuestionShuffle(xml);
                expect(preserved.parts[1]).toStrictEqual(before.parts[1]);
                expect(preserved.parts[0].placements.map((placement) => placement.fixed))
                  .toStrictEqual([false, false, true]);
                expect(preserved.metadata).toStrictEqual(before.metadata);

                await close();
                await answer.fill('Dirty question after settings save');
                await entry.click();
                await saveAssessmentArrangementFixture(
                  ctx,
                  assessment.id,
                  preserved.parts.map((part) => ({
                    ...part,
                    options: {
                      ...part.options,
                      instructionsHtml: '<p>Remote instructions win.</p>',
                    },
                  })),
                );
                await maximum.fill('950');
                await saveResponse(409);
                await rail.getByText(i18n.t('assessments.settings.conflict'), { exact: true })
                  .waitFor();
                const reload = rail.getByRole('button', {
                  name: i18n.t('assessments.arrange.reloadSaved'),
                  exact: true,
                });
                confirmReplies.push(false);
                await reload.click();
                expect(await maximum.inputValue()).toStrictEqual('950');
                confirmReplies.push(true);
                await reload.click();
                const guard = page.getByRole('dialog', {
                  name: i18n.t('assessments.builder.keepDraftTitle'),
                  exact: true,
                });
                await guard.getByRole('button', {
                  name: i18n.t('assessments.builder.cancelDraftSwitch'),
                  exact: true,
                }).click();
                expect(await maximum.inputValue()).toStrictEqual('950');
                expect(await answer.inputValue()).toStrictEqual(
                  'Dirty question after settings save',
                );
                confirmReplies.push(true);
                await reload.click();
                await Promise.all([
                  page.waitForEvent('load'),
                  guard.getByRole('button', {
                    name: i18n.t('assessments.builder.saveAndContinue'),
                    exact: true,
                  }).click(),
                ]);
                await page.waitForLoadState('networkidle');
                const reloaded = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(reloaded);
                remote = reloaded;
                expect(remote.parts[0].placements[1].snapshotRev).toStrictEqual(3);
                expect(remote.parts[0].options.instructionsHtml).toStrictEqual(
                  '<p>Remote instructions win.</p>',
                );
              } else {
                await saveQuestion();
                await page.reload({ waitUntil: 'networkidle' });
                const reloaded = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(reloaded);
                remote = reloaded;
                expect(remote.parts[0].placements[1].snapshotRev).toStrictEqual(2);
                await card.getByRole('button', {
                  name: i18n.t('assessments.builder.editQuestion', {
                    number: '1.2',
                    title: 'Second question',
                  }),
                  exact: true,
                }).getByText('Second question', { exact: true }).click();
                expect(await answer.inputValue()).toStrictEqual('Unsaved city!');
              }
              await entry.click();
              await partToggle.click();
              await assertAssessmentSettingsVisuals({
                page,
                rail,
                card,
                i18n,
                evidence,
                locale,
                theme,
                maximum: exerciseSaveProtocol ? '900' : '600',
                statusEndpoint: exerciseSaveProtocol ? null : endpoint,
                fixed: exerciseSaveProtocol ? [false, false, true] : [true, false, true],
                instructionsHtml: exerciseSaveProtocol
                  ? '<p>Remote instructions win.</p>'
                  : options.instructionsHtml,
              });
              await rail.getByRole('button', {
                name: i18n.t('assessments.settings.close'),
                exact: true,
              }).press('Escape');
              expect(await entry.evaluate((node) => node === document.activeElement)).toStrictEqual(
                true,
              );
              if (exerciseSaveProtocol) {
                await db.update(assessments).set({
                  metadata: {
                    delivery: {
                      latestPublish: {
                        assessmentVersionId: version,
                        publishedAt: '2026-10-06T12:00:00.000Z',
                      },
                    },
                  },
                }).where(eq(assessments.id, assessment.id));
                await page.reload({ waitUntil: 'networkidle' });
                await entry.click();
                const delivery = rail.getByRole('button').filter({
                  hasText: i18n.t('assessments.settings.delivery'),
                });
                await delivery.click();
                await rail.getByText(i18n.t('assessments.settings.noHandoff'), { exact: true })
                  .waitFor();
                expect(
                  await rail.getByRole('link', {
                    name: i18n.t('assessments.settings.manageDelivery'),
                    exact: true,
                  }).count(),
                ).toStrictEqual(0);
                await close();
                await db.update(assessments).set({ metadata: {} }).where(
                  eq(assessments.id, assessment.id),
                );
                await page.reload({ waitUntil: 'networkidle' });
                await entry.click();
                await delivery.click();
                await rail.getByText(i18n.t('assessments.settings.publishFirst'), { exact: true })
                  .waitFor();
                await rail.getByRole('button', {
                  name: i18n.t('assessments.settings.publish'),
                  exact: true,
                }).click();
                await page.getByText(i18n.t('list.actions.publish.notConfigured'), { exact: true })
                  .waitFor();
                expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(
                  remote.parts,
                );
              }
              expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(remote.parts);
              expect(errors).toStrictEqual([]);
              expect(confirmReplies).toStrictEqual([]);
            } catch (cause: unknown) {
              await captureBrowserFailure(page, evidence, 'qflow-assessment-settings');
              throw cause;
            } finally {
              await context.close();
              await deleteAssessment(ctx, assessment.id);
            }
          }
        }
        await app?.close();
        app = undefined;
        await db.delete(authSessions).where(eq(authSessions.userId, ctx.userId));
      });
    } finally {
      await app?.close();
      await shutdownDb();
    }
  },
);

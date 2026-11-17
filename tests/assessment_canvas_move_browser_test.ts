import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';
import { verifyCanvasOrderExport } from './helpers/canvas_order_export.ts';
import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';
import { assertCanvasMoveFailureMessages } from './helpers/assessment_arrangement_status_browser.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, questionRevisions } from '../lib/db/schema.ts';
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
import { updateAssessmentBlueprint } from '../lib/services/assessment_structure.ts';
import { testAssessmentBlueprint } from './assessment_blueprint_fixture.ts';
testCase(
  'real canvas movement preserves dirty editors, settings, identities and concurrent own saves across locales and themes',
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
            portRange: { first: 5410, lastExclusive: 5420 },
            environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
          },
          headless: true,
        });
        for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
          await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
          const i18n = createI18n(locale, catalogForLocale(locale));
          for (const theme of ['wireframe', 'dark']) {
            const exerciseMoveProtocol = locale === 'en-US' && theme === 'wireframe';
            const assessment = await createAssessmentDraft(ctx, {
              title: 'Canvas movement regression',
            });
            const initial = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(initial);
            const partId = initial.parts[0].id, otherPartId = crypto.randomUUID();
            await updateAssessmentBlueprint(
              ctx,
              assessment.id,
              testAssessmentBlueprint([
                { id: 'target-a', questionType: 'single_select', count: 5 },
                { id: 'target-b', questionType: 'single_select', count: 5 },
              ]),
            );
            const options = {
              navigationMode: 'nonlinear',
              submissionMode: 'simultaneous',
              instructionsHtml: '<p>Read carefully.</p>',
              timeLimits: { minTime: 10, maxTime: 300 },
              feedback: [{
                id: crypto.randomUUID(),
                access: 'atEnd',
                showHide: 'show',
                outcomeIdentifier: 'TEST_FEEDBACK',
                html: '<p>Finished.</p>',
              }],
            };
            await saveAssessmentArrangementFixture(ctx, assessment.id, [{
              ...initial.parts[0],
              options,
            }, {
              id: otherPartId,
              title: 'Fixed part',
              options: { navigationMode: 'linear' },
              placements: [],
            }]);
            const items: Array<{ itemId: string; placementId: string }> = [];
            for (
              const [index, title] of [
                'First question',
                'Middle question',
                'Last question',
                'Fixed first',
                'Fixed last',
              ].entries()
            ) {
              const result = await saveAssessmentQuestion(ctx, assessment.id, {
                _tag: 'Create',
                partId: index < 3 ? partId : otherPartId,
                blueprintTargetId: 'target-a',
                draft: {
                  type: 'single_select',
                  title,
                  itemLanguage: newAuthoringItemLanguage(),
                  bodyHtml: '<p>Which <strong>city</strong> is in France?</p>',
                  choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
                  correctId: 'A',
                },
              });
              if (!(result.ok)) expect.unreachable('Expected result.ok');
              items.push(result.value);
            }
            const before = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(before);
            const source = await db.select().from(questionRevisions).where(
              eq(questionRevisions.tenantId, ctx.tenantId),
            ).orderBy(questionRevisions.id);
            const context: import('playwright').BrowserContext = await app.newContext({
              authSession: await createSession(ctx),
              browser: { viewport: { width: 390, height: 844 }, hasTouch: true },
            });
            const page: import('playwright').Page = await context.newPage();
            page.setDefaultTimeout(20000);
            const errors: string[] = [], dialogs: string[] = [];
            const origin = app.baseUrl;
            const loadingStarted = performance.now();
            const loadingEvents: Array<{
              readonly event: 'response' | 'failed' | 'pageerror';
              readonly elapsedMs: number;
              readonly path?: string;
              readonly status?: number;
              readonly cause?: string;
            }> = [];
            const recordLoading = (event: typeof loadingEvents[number]) => {
              loadingEvents.push(event);
              if (loadingEvents.length > 256) loadingEvents.shift();
            };
            const scriptPath = (url: string) => {
              const parsed = new URL(url);
              return parsed.origin === origin ? parsed.pathname : '[external script]';
            };
            page.on('pageerror', (cause) =>
              recordLoading({
                event: 'pageerror',
                elapsedMs: Math.round(performance.now() - loadingStarted),
                cause: safeErrorSummary(cause),
              }));
            page.on('response', (response) => {
              if (response.request().resourceType() !== 'script') return;
              recordLoading({
                event: 'response',
                elapsedMs: Math.round(performance.now() - loadingStarted),
                path: scriptPath(response.url()),
                status: response.status(),
              });
            });
            page.on('requestfailed', (request) => {
              if (request.resourceType() !== 'script') return;
              const cause = request.failure()?.errorText;
              recordLoading({
                event: 'failed',
                elapsedMs: Math.round(performance.now() - loadingStarted),
                path: scriptPath(request.url()),
                cause: cause === 'net::ERR_ABORTED' ? 'aborted' : 'network-failure',
              });
            });
            let arrangementWrites = 0;
            page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
            page.on('request', (request) => {
              if (request.method() === 'POST' && request.url().endsWith('/arrange')) {
                arrangementWrites++;
              }
              if (request.method() !== 'GET') {
                console.log(
                  `Canvas request: ${request.method()} ${new URL(request.url()).pathname}${
                    new URL(request.url()).search
                  }`,
                );
              }
            });
            page.on('dialog', async (dialog) => {
              dialogs.push(dialog.type());
              await dialog.dismiss();
            });
            const cards = page.locator('article[id^="assessment-question-"]');
            const endpoint = `**/api/assessments/${assessment.id}/arrange`;
            let expectedTarget = 'target-a', expectedInstructions = options.instructionsHtml;
            const handle = (index: number) =>
              page.locator(`#move-question-${items[index].placementId}`);
            const middle = page.locator(`#assessment-question-${items[1].placementId}`);
            const saveQuestion = async () => {
              const [response] = await Promise.all([
                page.waitForResponse((response) =>
                  response.request().method() === 'POST' && response.url().endsWith('/questions')
                ),
                middle.getByRole('button', { name: i18n.t('editor.save'), exact: true }).click(),
              ]);
              expect(response.status()).toStrictEqual(201);
              await middle.getByRole('status').filter({ hasText: i18n.t('editor.itemSaved') })
                .waitFor();
            };
            const order = async (indices: number[]) => {
              const ids = indices.map((index) => `assessment-question-${items[index].placementId}`);
              await page.waitForFunction(
                (expected) =>
                  JSON.stringify(
                    [...document.querySelectorAll('article[id^="assessment-question-"]')].map((
                      node,
                    ) => node.id),
                  ) === JSON.stringify(expected),
                ids,
              );
              const saved = await getAssessment(ctx, assessment.id);
              assertQuestionOnlyAssessmentFixture(saved);
              expect(
                saved.parts.flatMap((part) => part.placements.map((placement) => placement.id)),
              ).toStrictEqual(indices.map((index) => items[index].placementId));
              expect(saved.targetCount).toStrictEqual(5);
              expect(saved.parts[0].options).toStrictEqual({
                ...options,
                instructionsHtml: expectedInstructions,
              });
              expect(saved.parts[1]).toStrictEqual(before.parts[1]);
              for (const placement of saved.parts[0].placements) {
                const original:
                  | import('../lib/services/assessment_structure.ts').AssessmentPlacement
                  | undefined = before.parts[0].placements.find((p) => p.id === placement.id);
                if (!original) expect.unreachable('Expected original');
                expect(placement.itemId).toStrictEqual(original.itemId);
                const target: string | null = placement.id === items[1].placementId
                  ? expectedTarget
                  : original.blueprintTargetId;
                expect(placement.blueprintTargetId).toStrictEqual(target);
              }
              return saved;
            };
            const key = async (index: number, value: string) => {
              await handle(index).focus();
              const [response] = await Promise.all([
                page.waitForResponse((result) =>
                  result.request().method() === 'POST' && result.url().endsWith('/arrange')
                ),
                handle(index).press(value),
              ]);
              expect(response.status()).toStrictEqual(200);
            };
            try {
              await page.goto(`${app.baseUrl}/assessments/${assessment.id}`, {
                waitUntil: 'networkidle',
              });
              await page.evaluate(
                (value) => document.documentElement.setAttribute('data-theme', value),
                theme,
              );
              await page.getByRole('button', {
                name: i18n.t('assessments.builder.editQuestion', {
                  number: '1.2',
                  title: 'Middle question',
                }),
                exact: true,
              }).getByText('Middle question', { exact: true }).click();
              const answer = middle.getByRole('textbox', {
                name: i18n.t('driver.choicePlaceholder', { id: 'A' }),
                exact: true,
              });
              await answer.fill('Dirty answer stays');
              await answer.evaluate((node) => node.setAttribute('data-retained-editor', 'yes'));
              await middle.getByRole('button', {
                name: i18n.t('assessments.builder.questionSettings'),
                exact: true,
              }).click();
              const shuffle = page.getByLabel(i18n.t('driver.rightRail.shuffle'), { exact: true });
              await page.getByRole('button', { name: i18n.t('inspector.details'), exact: true })
                .click();
              const [alignment] = await Promise.all([
                page.waitForResponse((response) =>
                  response.request().method() === 'PATCH' &&
                  response.url().includes('action=align-blueprint-target')
                ),
                page.getByRole('combobox', { name: i18n.t('inspector.planTarget'), exact: true })
                  .selectOption('target-b'),
              ]);
              expect(alignment.status()).toStrictEqual(200);
              expectedTarget = 'target-b';
              await shuffle.check();
              await page.getByRole('button', {
                name: i18n.t('assessments.builder.closeQuestionSettings'),
                exact: true,
              }).click();
              await page.waitForFunction(
                (label) => document.activeElement?.textContent?.trim() === label,
                i18n.t('assessments.builder.questionSettings'),
              );
              await key(1, 'ArrowUp');
              await order([1, 0, 2, 3, 4]);
              await page.getByRole('status').filter({
                hasText: i18n.t('assessments.builder.moveSaved', {
                  title: 'Middle question',
                  number: '1.1',
                }),
              }).waitFor();
              await page.waitForFunction(
                (id) => document.activeElement?.id === id,
                `move-question-${items[1].placementId}`,
              );
              expect(await answer.inputValue()).toStrictEqual('Dirty answer stays');
              expect(await page.locator('[data-retained-editor="yes"]').count()).toStrictEqual(1);
              await answer.press('End');
              await answer.pressSequentially('!');
              await answer.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
              expect(await answer.inputValue()).toStrictEqual('Dirty answer stays');
              await key(1, 'End');
              await order([0, 2, 1, 3, 4]);
              await key(1, 'Home');
              await order([1, 0, 2, 3, 4]);
              await key(1, 'ArrowDown');
              await order([0, 1, 2, 3, 4]);
              await handle(1).tap();
              await page.getByRole('button', {
                name: i18n.t('assessments.builder.moveLast'),
                exact: true,
              }).tap();
              await order([0, 2, 1, 3, 4]);
              await handle(1).tap();
              await page.getByRole('button', {
                name: i18n.t('assessments.builder.moveFirst'),
                exact: true,
              }).tap();
              await order([1, 0, 2, 3, 4]);
              await page.setViewportSize({ width: 1280, height: 1800 });
              await handle(1).dragTo(
                page.locator(`#assessment-question-${items[2].placementId}`).locator('..'),
                { targetPosition: { x: 30, y: 10 } },
              );
              await order([0, 1, 2, 3, 4]);
              // Native cancellation and cross-part rejection do not depend on translated controls.
              if (exerciseMoveProtocol) {
                // Observe real native drag events, then cancel with Escape and reject a cross-part drop.
                await page.evaluate(() => {
                  const root = document.documentElement;
                  root.dataset.dragStarts = '0';
                  root.dataset.dragEnds = '0';
                  document.addEventListener('dragstart', () => {
                    root.dataset.dragStarts = String(Number(root.dataset.dragStarts) + 1);
                  });
                  document.addEventListener('dragend', () => {
                    root.dataset.dragEnds = String(Number(root.dataset.dragEnds) + 1);
                  });
                });
                const writesBeforeCancellation = arrangementWrites;
                await handle(1).hover();
                const dragHandle = await handle(1).boundingBox();
                if (!dragHandle) expect.unreachable('Expected dragHandle');
                const pointerX = dragHandle.x + dragHandle.width / 2;
                const pointerY = dragHandle.y + dragHandle.height / 2;
                await page.mouse.move(pointerX, pointerY);
                await page.mouse.down();
                await page.mouse.move(pointerX + 20, pointerY + 40, { steps: 10 });
                await page.waitForFunction(() =>
                  document.documentElement.dataset.dragStarts === '1'
                );
                await page.keyboard.press('Escape');
                await page.mouse.up();
                await page.waitForFunction(() => document.documentElement.dataset.dragEnds === '1');
                expect(arrangementWrites).toStrictEqual(writesBeforeCancellation);
                await page.setViewportSize({ width: 1280, height: 3000 });
                await handle(1).dragTo(
                  page.locator(`#assessment-question-${items[3].placementId}`).locator('..'),
                  { targetPosition: { x: 30, y: 10 } },
                );
                await page.waitForFunction(() =>
                  document.documentElement.dataset.dragStarts === '2' &&
                  document.documentElement.dataset.dragEnds === '2'
                );
                expect(arrangementWrites).toStrictEqual(writesBeforeCancellation);
                await order([0, 1, 2, 3, 4]);
              }
              expect(await answer.inputValue()).toStrictEqual('Dirty answer stays');
              expect(await page.locator('[data-retained-editor="yes"]').count()).toStrictEqual(1);
              await page.setViewportSize({ width: 390, height: 844 });
              expect(await handle(3).getAttribute('aria-disabled')).toStrictEqual('true');
              await handle(3).press('End');
              await order([0, 1, 2, 3, 4]);
              expect(
                await db.select().from(questionRevisions).where(
                  eq(questionRevisions.tenantId, ctx.tenantId),
                ).orderBy(questionRevisions.id),
              ).toStrictEqual(source);
              await middle.getByRole('tab', { name: i18n.t('editor.preview'), exact: true })
                .click();
              await middle.getByText('Dirty answer stays', { exact: true }).waitFor();
              await middle.getByRole('tab', { name: i18n.t('editor.content'), exact: true })
                .click();
              expect(await answer.inputValue()).toStrictEqual('Dirty answer stays');
              await middle.getByRole('button', {
                name: i18n.t('assessments.builder.questionSettings'),
                exact: true,
              }).click();
              expect(await shuffle.isChecked()).toStrictEqual(true);
              await page.getByRole('button', {
                name: i18n.t('assessments.builder.closeQuestionSettings'),
                exact: true,
              }).click();
              for (const width of [320, 390, 1280]) {
                await page.setViewportSize({ width, height: 900 });
                expect(await page.locator('#question-settings-inspector').isHidden()).toStrictEqual(
                  true,
                );
                await page.waitForFunction(() =>
                  document.documentElement.scrollWidth <= innerWidth
                );
                await handle(1).click();
                const actions = page.locator(`#move-question-${items[1].placementId}-actions`);
                const bounds = await actions.boundingBox();
                if (!(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width)) {
                  expect.unreachable(
                    'Expected bounds && bounds.x >= 0 && bounds.x + bounds.width <= width',
                  );
                }
                for (const button of await actions.getByRole('button').all()) {
                  const actionBounds = await button.boundingBox();
                  if (!(actionBounds && actionBounds.height >= 44)) {
                    expect.unreachable('Expected actionBounds && actionBounds.height >= 44');
                  }
                }
                const target = await handle(1).boundingBox();
                if (!(target && target.width >= 44 && target.height >= 44)) {
                  expect.unreachable(
                    'Expected target && target.width >= 44 && target.height >= 44',
                  );
                }
                await page.screenshot({
                  path: evidence.path(`qflow-canvas-move-${locale}-${theme}-${width}.png`),
                });
                await handle(1).press('Escape');
              }
              await page.setViewportSize({ width: 390, height: 844 });
              // The matrix keeps real editing, movement and save/reload persistence.
              // Exhaustive transport races and remote conflicts execute once.
              if (exerciseMoveProtocol) {
                // The server commits a move, its response waits, then a real question save commits a newer pin.
                const committed = Promise.withResolvers<void>(),
                  release = Promise.withResolvers<void>();
                await page.route(endpoint, async (route) => {
                  const response = await route.fetch();
                  expect(response.status()).toStrictEqual(200);
                  committed.resolve();
                  await release.promise;
                  await route.fulfill({ response });
                });
                await handle(1).press('End');
                await committed.promise;
                await answer.fill('Concurrent question save');
                await saveQuestion();
                release.resolve();
                await order([0, 2, 1, 3, 4]);
                await page.unroute(endpoint);
                expect(await answer.inputValue()).toStrictEqual('Concurrent question save');
                await key(1, 'Home');
                const concurrent = await order([1, 0, 2, 3, 4]);
                expect(concurrent.parts[0].placements[0].snapshotRev).toStrictEqual(2);
                // The response is genuinely lost after commitment; retry must be byte-for-byte the same command.
                let lost: string | null = null;
                await page.route(endpoint, async (route) => {
                  lost = route.request().postData();
                  const response = await route.fetch();
                  expect(response.status()).toStrictEqual(200);
                  await route.abort('failed');
                });
                await handle(1).press('End');
                await page.getByRole('status').filter({
                  hasText: i18n.t('assessments.builder.moveUncertain'),
                }).waitFor();
                if (!lost) expect.unreachable('Expected lost');
                await answer.fill('New edit after lost response');
                await page.unroute(endpoint);
                const [retry] = await Promise.all([
                  page.waitForResponse((response) =>
                    response.request().method() === 'POST' && response.url().endsWith('/arrange')
                  ),
                  page.getByRole('button', {
                    name: i18n.t('assessments.builder.tool.retry'),
                    exact: true,
                  }).click(),
                ]);
                expect(retry.status()).toStrictEqual(200);
                expect(retry.request().postData()).toStrictEqual(lost);
                const recovered = await order([0, 2, 1, 3, 4]);
                expect(await answer.inputValue()).toStrictEqual('New edit after lost response');
                const exportedIds = recovered.parts.flatMap((part) =>
                  part.placements.map((p) => `item-${p.itemId}-r${p.snapshotRev}`)
                );
                await verifyCanvasOrderExport(ctx, assessment.id, exportedIds);
                // Rejection leaves the draft and order intact; another permitted move can still be saved.
                await page.route(
                  endpoint,
                  (route) => route.fulfill({ status: 403, json: { ok: false } }),
                );
                await handle(1).press('Home');
                await page.getByRole('status').filter({
                  hasText: i18n.t('assessments.builder.moveRejected'),
                }).waitFor();
                await order([0, 2, 1, 3, 4]);
                expect(await answer.inputValue()).toStrictEqual('New edit after lost response');
                await page.unroute(endpoint);
                await key(1, 'Home');
                await order([1, 0, 2, 3, 4]);
                // A concurrent remote settings change must win; canceling Reload preserves the dirty editor.
                const current = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(current);
                await saveAssessmentArrangementFixture(
                  ctx,
                  assessment.id,
                  current.parts.map((part) =>
                    part.id === partId
                      ? {
                        ...part,
                        options: {
                          ...part.options,
                          instructionsHtml: '<p>Remote instructions win.</p>',
                        },
                      }
                      : part
                  ),
                );
                const [conflict] = await Promise.all([
                  page.waitForResponse((response) =>
                    response.request().method() === 'POST' && response.url().endsWith('/arrange')
                  ),
                  handle(1).press('End'),
                ]);
                expect(conflict.status()).toStrictEqual(409);
                await page.getByRole('status').filter({
                  hasText: i18n.t('assessments.builder.moveConflict'),
                }).waitFor();
                await page.getByRole('button', {
                  name: i18n.t('assessments.arrange.reloadSaved'),
                  exact: true,
                }).click();
                const guard = page.getByRole('dialog', {
                  name: i18n.t('assessments.builder.keepDraftTitle'),
                  exact: true,
                });
                await guard.getByRole('button', {
                  name: i18n.t('assessments.builder.cancelDraftSwitch'),
                  exact: true,
                }).click();
                expect(await answer.inputValue()).toStrictEqual('New edit after lost response');
                const remote = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(remote);
                expect(remote.parts[0].options.instructionsHtml).toStrictEqual(
                  '<p>Remote instructions win.</p>',
                );
                expect(remote.parts[0].placements.map((placement) => placement.id)).toStrictEqual([
                  items[1].placementId,
                  items[0].placementId,
                  items[2].placementId,
                ]);
                await page.getByRole('button', {
                  name: i18n.t('assessments.arrange.reloadSaved'),
                  exact: true,
                }).click();
                await Promise.all([
                  page.waitForEvent('framenavigated', {
                    predicate: (frame) => frame === page.mainFrame(),
                  }),
                  guard.getByRole('button', {
                    name: i18n.t('assessments.builder.saveAndContinue'),
                    exact: true,
                  }).click(),
                ]);
                await page.waitForLoadState('networkidle');
                expect(await cards.count()).toStrictEqual(5);
              } else {
                await key(1, 'Home');
                await order([1, 0, 2, 3, 4]);
                await saveQuestion();
                await page.reload({ waitUntil: 'networkidle' });
                await page.getByRole('button', {
                  name: i18n.t('assessments.builder.editQuestion', {
                    number: '1.1',
                    title: 'Middle question',
                  }),
                  exact: true,
                }).getByText('Middle question', { exact: true }).click();
                expect(await answer.inputValue()).toStrictEqual('Dirty answer stays');
              }
              const final = await getAssessment(ctx, assessment.id);
              assertQuestionOnlyAssessmentFixture(final);
              expect(final.parts[0].placements[0].snapshotRev).toStrictEqual(
                exerciseMoveProtocol ? 3 : 2,
              );
              expectedInstructions = exerciseMoveProtocol
                ? '<p>Remote instructions win.</p>'
                : options.instructionsHtml;
              expect(final.parts[0].options.instructionsHtml).toStrictEqual(expectedInstructions);
              await saveAssessmentArrangementFixture(
                ctx,
                assessment.id,
                final.parts.map((part, partIndex) => ({
                  ...part,
                  placements: part.placements.map((placement, index) => ({
                    ...placement,
                    fixed: partIndex === 0 && index === 0,
                  })),
                })),
              );
              await page.reload({ waitUntil: 'networkidle' });
              await page.evaluate(
                (value) => document.documentElement.setAttribute('data-theme', value),
                theme,
              );
              await page.getByText(i18n.t('assessments.builder.moveFixedPositions'), {
                exact: true,
              }).waitFor();
              expect(await handle(1).getAttribute('aria-disabled')).toStrictEqual('true');
              expect(await handle(1).getAttribute('draggable')).toStrictEqual('false');
              await handle(1).press('ArrowDown');
              await handle(1).press('Home');
              await page.evaluate(() =>
                new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
              );
              const protectedBefore = await getAssessment(ctx, assessment.id);
              assertQuestionOnlyAssessmentFixture(protectedBefore);
              expect(protectedBefore.parts[0].placements.map((placement) => placement.id))
                .toStrictEqual(final.parts[0].placements.map((placement) => placement.id));
              await handle(0).click();
              expect(
                await page.getByRole('button', {
                  name: i18n.t('assessments.builder.moveFirst'),
                  exact: true,
                }).isDisabled(),
              ).toStrictEqual(true);
              expect(
                await page.getByRole('button', {
                  name: i18n.t('assessments.builder.moveLast'),
                  exact: true,
                }).isDisabled(),
              ).toStrictEqual(false);
              await page.getByRole('button', {
                name: i18n.t('assessments.builder.moveLast'),
                exact: true,
              }).click();
              await page.waitForFunction(
                (ids) =>
                  JSON.stringify(
                    [...document.querySelectorAll('article[id^="assessment-question-"]')].map((
                      node,
                    ) => node.id),
                  ) === JSON.stringify(ids),
                [1, 2, 0, 3, 4].map((index) => `assessment-question-${items[index].placementId}`),
              );
              const protectedAfter = await getAssessment(ctx, assessment.id);
              expect(protectedAfter?.parts[0].placements.map((placement) => placement.id))
                .toStrictEqual([1, 2, 0].map((index) => items[index].placementId));
              expect(protectedAfter?.parts[0].placements.map((placement) => placement.fixed))
                .toStrictEqual([true, false, false]);
              // First/last mean eligible positions, including when a protected slot comes first.
              await handle(0).click();
              const moveFirst = page.getByRole('button', {
                name: i18n.t('assessments.builder.moveFirst'),
                exact: true,
              });
              expect(await moveFirst.isDisabled()).toStrictEqual(false);
              await moveFirst.click();
              await order([1, 0, 2, 3, 4]);
              await key(0, 'End');
              await order([1, 2, 0, 3, 4]);
              await key(0, 'Home');
              await order([1, 0, 2, 3, 4]);
              const bounded = await getAssessment(ctx, assessment.id);
              expect(bounded?.parts[0].placements[0]).toStrictEqual(
                protectedAfter?.parts[0].placements[0],
              );
              await page.screenshot({
                path: evidence.path(`qflow-fixed-position-${locale}-${theme}.png`),
                fullPage: true,
              });
              assertQuestionOnlyAssessmentFixture(bounded);
              await saveAssessmentArrangementFixture(
                ctx,
                assessment.id,
                bounded.parts.map((part, partIndex) => ({
                  ...part,
                  placements: part.placements.map((placement, index) => ({
                    ...placement,
                    fixed: partIndex === 0 && index === 2,
                  })),
                })),
              );
              await page.reload({ waitUntil: 'networkidle' });
              await page.evaluate(
                (value) => document.documentElement.setAttribute('data-theme', value),
                theme,
              );
              await key(0, 'Home');
              await order([0, 1, 2, 3, 4]);
              await key(0, 'End');
              await order([1, 0, 2, 3, 4]);
              await key(0, 'Home');
              await handle(0).click();
              const moveLast = page.getByRole('button', {
                name: i18n.t('assessments.builder.moveLast'),
                exact: true,
              });
              expect(await moveLast.isDisabled()).toStrictEqual(false);
              await moveLast.click();
              await order([1, 0, 2, 3, 4]);
              expect((await getAssessment(ctx, assessment.id))?.parts[0].placements[2])
                .toStrictEqual({ ...bounded.parts[0].placements[2], fixed: true });
              expect(await page.locator('html').getAttribute('data-theme')).toStrictEqual(theme);
              if (!exerciseMoveProtocol) {
                const protectedFinal = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(protectedFinal);
                await assertCanvasMoveFailureMessages(page, endpoint, handle(0), i18n);
                expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(
                  protectedFinal.parts,
                );
              }
              expect(errors).toStrictEqual([]);
              expect(dialogs).toStrictEqual([]);
            } catch (cause: unknown) {
              await _fs.writeFile(
                evidence.path('qflow-canvas-move-loading.json'),
                JSON.stringify(loadingEvents, null, 2) + '\n',
                'utf8',
              ).catch((cause: unknown) => {
                console.error('Canvas loading evidence unavailable:', safeErrorSummary(cause));
              });
              await captureBrowserFailure(page, evidence, 'qflow-canvas-move');
              throw cause;
            } finally {
              await context.close();
              await db.delete(authSessions).where(eq(authSessions.userId, ctx.userId));
              await deleteAssessment(ctx, assessment.id);
            }
          }
        }
      });
    } finally {
      await app?.close();
      await shutdownDb();
    }
  },
);

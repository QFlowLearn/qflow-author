import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';

import { and, eq, isNull } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  assessmentPlacementRemovals,
  authSessions,
  organizationMemberships,
  questionRevisions,
} from '../lib/db/schema.ts';
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
import { parsePlacementRemovalReceipt } from '../lib/assessment_placement_removal.ts';

testCase(
  'persisted placement Undo survives real app reload and protects open drafts across locales, themes and failures',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        try {
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5390, lastExclusive: 5400 },
              environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
            },
            headless: true,
          });
          for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
            await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
            const i18n = createI18n(locale, catalogForLocale(locale));
            for (const theme of ['light', 'dark']) {
              const exerciseRecoveryProtocol = locale === 'en-US' && theme === 'light';
              const assessment = await createAssessmentDraft(ctx, {
                title: 'Recovery browser assessment',
              });
              const record = await getAssessment(ctx, assessment.id);
              assertQuestionOnlyAssessmentFixture(record);
              const partId = record.parts[0].id;
              const items: Array<{ readonly itemId: string; readonly placementId: string }> = [];
              for (const title of ['First question', 'Middle question', 'Last question']) {
                const result = await saveAssessmentQuestion(ctx, assessment.id, {
                  _tag: 'Create',
                  partId,
                  draft: {
                    type: 'single_select',
                    itemLanguage: newAuthoringItemLanguage(),
                    title,
                    bodyHtml: '<p>Which city is in France?</p>',
                    choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
                    correctId: 'A',
                  },
                });
                if (!(result.ok)) expect.unreachable('Expected result.ok');
                items.push(result.value);
              }
              const authored = await getAssessment(ctx, assessment.id);
              assertQuestionOnlyAssessmentFixture(authored);
              await saveAssessmentArrangementFixture(
                ctx,
                assessment.id,
                authored.parts.map((part) => ({
                  ...part,
                  options: { shuffleQuestions: true },
                  placements: part.placements.map((placement, index) => ({
                    ...placement,
                    fixed: index === 1,
                  })),
                })),
              );
              const context: import('playwright').BrowserContext = await app.newContext({
                authSession: await createSession(ctx),
                browser: { viewport: { width: 390, height: 844 } },
              });
              const page: import('playwright').Page = await context.newPage();
              if (locale === 'sv-SE' && theme === 'dark') await page.clock.install();
              page.setDefaultTimeout(20000);
              const errors: string[] = [], dialogs: string[] = [];
              page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
              page.on('dialog', async (dialog) => {
                dialogs.push(dialog.type());
                await dialog.dismiss();
              });
              const notice = page.getByRole('complementary', {
                name: i18n.t('assessments.builder.recoveryLabel'),
                exact: true,
              });
              const undo = notice.getByRole('button', {
                name: i18n.t('assessments.builder.recoveryUndo'),
                exact: true,
              });
              const remove = page.getByRole('button', {
                name: i18n.t('assessments.builder.deleteQuestion'),
                exact: true,
              });
              const cards = page.locator('article[id^="assessment-question-"]');
              const path = `/assessments/${assessment.id}`;
              const open = async (index: number) => {
                await page.getByRole('button', {
                  name: i18n.t('assessments.builder.editQuestion', {
                    number: `1.${index + 1}`,
                    title: ['First question', 'Middle question', 'Last question'][index],
                  }),
                  exact: true,
                }).getByText(['First question', 'Middle question', 'Last question'][index], {
                  exact: true,
                }).click();
                await page.locator(`#assessment-question-${items[index].placementId}`).getByRole(
                  'textbox',
                  { name: i18n.t('driver.choicePlaceholder', { id: 'A' }), exact: true },
                ).waitFor();
              };
              const removeMiddle = async () => {
                await open(1);
                const response = page.waitForResponse((r) =>
                  r.request().method() === 'DELETE' &&
                  r.url().endsWith(`/placements/${items[1].placementId}`)
                );
                await remove.click();
                expect((await response).status()).toStrictEqual(200);
                await undo.waitFor();
                expect(await cards.count()).toStrictEqual(2);
                expect(await undo.evaluate((button) => button === document.activeElement))
                  .toStrictEqual(true);
                expect(
                  await page.getByRole('status').filter({
                    hasText: i18n.t('assessments.builder.recoveryRemoved', {
                      title: 'Middle question',
                    }),
                  }).count(),
                ).toStrictEqual(1);
              };
              const assertOrder = async () => {
                expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.id)))
                  .toStrictEqual(items.map((item) => `assessment-question-${item.placementId}`));
                const current = await getAssessment(ctx, assessment.id);
                expect(current?.targetCount).toStrictEqual(3);
                expect(current?.parts[0].placements.map((row) => row.fixed)).toStrictEqual([
                  false,
                  true,
                  false,
                ]);
                expect(current?.parts[0].placements.map((row) => row.id)).toStrictEqual(
                  items.map((item) => item.placementId),
                );
              };
              try {
                await page.goto(`${app.baseUrl}${path}`, { waitUntil: 'networkidle' });
                await page.evaluate(
                  (value) => document.documentElement.setAttribute('data-theme', value),
                  theme,
                );
                const source = await db.select().from(questionRevisions).where(
                  eq(questionRevisions.tenantId, ctx.tenantId),
                ).orderBy(questionRevisions.id);
                // Clean keyboard Undo and LIFO replay are locale-independent protocol cases.
                if (exerciseRecoveryProtocol) {
                  await removeMiddle();
                  expect(await undo.evaluate((button) => button === document.activeElement))
                    .toStrictEqual(true);
                  await page.keyboard.press('Enter');
                  await notice.getByText(
                    i18n.t('assessments.builder.recoveryRestored', { title: 'Middle question' }),
                    { exact: true },
                  ).waitFor();
                  await assertOrder();
                  expect(
                    await page.locator('#assessment-removal-primary').evaluate((button) =>
                      button === document.activeElement
                    ),
                  ).toStrictEqual(true);
                  await notice.getByRole('button', {
                    name: i18n.t('assessments.builder.recoveryDismiss'),
                    exact: true,
                  }).click();
                  expect(
                    await page.locator('[data-authoring-tools] button').first().evaluate((button) =>
                      button === document.activeElement
                    ),
                  ).toStrictEqual(true);
                }
                if (exerciseRecoveryProtocol) {
                  await removeMiddle();
                  await open(0);
                  await remove.click();
                  await page.waitForFunction(() =>
                    document.querySelectorAll('article[id^="assessment-question-"]').length === 1
                  );
                  await page.reload({ waitUntil: 'networkidle' });
                  await undo.waitFor();
                  await undo.click();
                  await page.waitForFunction(() =>
                    document.querySelectorAll('article[id^="assessment-question-"]').length === 2
                  );
                  await notice.getByText(
                    i18n.t('assessments.builder.recoveryRemoved', { title: 'Middle question' }),
                    { exact: true },
                  ).waitFor();
                  await undo.click();
                  await notice.getByText(
                    i18n.t('assessments.builder.recoveryRestored', { title: 'Middle question' }),
                    { exact: true },
                  ).waitFor();
                  await assertOrder();
                  await notice.getByRole('button', {
                    name: i18n.t('assessments.builder.recoveryDismiss'),
                    exact: true,
                  }).click();
                }
                await removeMiddle();
                const [receipt] = await db.select().from(assessmentPlacementRemovals).where(
                  and(
                    eq(assessmentPlacementRemovals.assessmentId, assessment.id),
                    eq(assessmentPlacementRemovals.placementId, items[1].placementId),
                  ),
                ).orderBy(assessmentPlacementRemovals.removedAt);
                if (!receipt) expect.unreachable('Expected receipt');
                await page.reload({ waitUntil: 'networkidle' });
                await page.evaluate(
                  (value) => document.documentElement.setAttribute('data-theme', value),
                  theme,
                );
                await undo.waitFor();
                expect(await cards.count()).toStrictEqual(2);
                await open(0);
                const answer = page.locator(`#assessment-question-${items[0].placementId}`)
                  .getByRole('textbox', {
                    name: i18n.t('driver.choicePlaceholder', { id: 'A' }),
                    exact: true,
                  });
                await answer.fill('Keep my open draft');
                await answer.press('End');
                await answer.pressSequentially('!');
                await answer.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
                expect(await answer.inputValue()).toStrictEqual('Keep my open draft');
                expect(await cards.count()).toStrictEqual(2);
                await undo.press('Enter');
                await notice.getByText(
                  i18n.t('assessments.builder.recoveryRestored', { title: 'Middle question' }),
                  { exact: true },
                ).waitFor();
                expect(await answer.inputValue()).toStrictEqual('Keep my open draft');
                expect(
                  await page.locator(
                    `#assessment-question-${items[0].placementId}[data-authoring-card]`,
                  ).count(),
                ).toStrictEqual(1);
                await page.locator(`#assessment-question-${items[0].placementId}`)
                  .getByRole('status').filter({
                    hasText: i18n.t('editor.unsavedChanges'),
                  })
                  .waitFor();
                await assertOrder();
                expect(
                  await db.select().from(questionRevisions).where(
                    eq(questionRevisions.tenantId, ctx.tenantId),
                  ).orderBy(questionRevisions.id),
                ).toStrictEqual(source);
                await page.setViewportSize({ width: 320, height: 844 });
                await page.waitForFunction(() =>
                  document.documentElement.scrollWidth <= innerWidth
                );
                expect(await notice.evaluate((node) => getComputedStyle(node).position))
                  .toStrictEqual('relative');
                const target = await notice.getByRole('button', {
                  name: i18n.t('assessments.builder.recoveryDismiss'),
                  exact: true,
                }).boundingBox();
                if (!(target && target.width >= 44 && target.height >= 44)) {
                  expect.unreachable(
                    'Expected target && target.width >= 44 && target.height >= 44',
                  );
                }
                await page.screenshot({
                  path: evidence.path(`qflow-placement-undo-${locale}-${theme}.png`),
                });
                await page.setViewportSize({ width: 1280, height: 900 });
                await page.waitForFunction(() =>
                  document.documentElement.scrollWidth <= innerWidth
                );
                expect(await notice.evaluate((node) => getComputedStyle(node).position))
                  .toStrictEqual('fixed');
                await page.screenshot({
                  path: evidence.path(`qflow-placement-undo-${locale}-${theme}-desktop.png`),
                });
                await page.setViewportSize({ width: 390, height: 844 });
                await notice.getByRole('button', {
                  name: i18n.t('assessments.builder.recoveryDismiss'),
                  exact: true,
                }).click();
                // Dirty removal still passes through the canonical Save/Discard/Cancel guard.
                await remove.click();
                const guard = page.getByRole('dialog', {
                  name: i18n.t('assessments.builder.keepDraftTitle'),
                  exact: true,
                });
                await guard.getByRole('button', {
                  name: i18n.t('assessments.builder.cancelDraftSwitch'),
                  exact: true,
                }).click();
                expect(await answer.inputValue()).toStrictEqual('Keep my open draft');
                expect(await cards.count()).toStrictEqual(3);
                await remove.click();
                const deletion = page.waitForResponse((r) => r.request().method() === 'DELETE');
                await guard.getByRole('button', {
                  name: i18n.t('assessments.builder.saveAndContinue'),
                  exact: true,
                }).click();
                const deleted = await deletion;
                expect(deleted.status()).toStrictEqual(200);
                const payload: unknown = await deleted.json();
                if (!(payload && typeof payload === 'object')) {
                  expect.unreachable("Expected payload && typeof payload === 'object'");
                }
                const savedReceipt = parsePlacementRemovalReceipt(Reflect.get(payload, 'value'));
                if (!(savedReceipt && savedReceipt.snapshotRev === 2)) {
                  expect.unreachable('Expected savedReceipt && savedReceipt.snapshotRev === 2');
                }
                await undo.waitFor();
                await undo.click();
                await notice.getByText(
                  i18n.t('assessments.builder.recoveryRestored', { title: 'First question' }),
                  { exact: true },
                ).waitFor();
                await assertOrder();
                await open(0);
                expect(await answer.inputValue()).toStrictEqual('Keep my open draft');
                if (exerciseRecoveryProtocol) {
                  await notice.getByRole('button', {
                    name: i18n.t('assessments.builder.recoveryDismiss'),
                    exact: true,
                  }).click();
                  await removeMiddle();
                  // The real POST commits, but its response is lost. Retry must replay the same placement.
                  let lose = true;
                  await page.route('**/removals/*', async (route) => {
                    const response = await route.fetch();
                    if (lose && response.ok()) {
                      lose = false;
                      await route.abort('failed');
                    } else await route.fulfill({ response });
                  });
                  await undo.click();
                  await notice.getByRole('alert').filter({
                    hasText: i18n.t('assessments.builder.recoveryUncertain'),
                  }).waitFor();
                  expect((await getAssessment(ctx, assessment.id))?.targetCount).toStrictEqual(3);
                  await undo.click();
                  await notice.getByText(
                    i18n.t('assessments.builder.recoveryRestored', { title: 'Middle question' }),
                    { exact: true },
                  ).waitFor();
                  await assertOrder();
                  await page.unroute('**/removals/*');
                  await notice.getByRole('button', {
                    name: i18n.t('assessments.builder.recoveryDismiss'),
                    exact: true,
                  }).click();
                  await removeMiddle();
                  const changed = await getAssessment(ctx, assessment.id);
                  assertQuestionOnlyAssessmentFixture(changed);
                  await saveAssessmentArrangementFixture(
                    ctx,
                    assessment.id,
                    changed.parts.map((part) => ({
                      ...part,
                      placements: [...part.placements].reverse(),
                    })),
                  );
                  await undo.click();
                  await notice.getByRole('alert').filter({
                    hasText: i18n.t('assessments.builder.recoveryConflict'),
                  }).waitFor();
                  expect((await getAssessment(ctx, assessment.id))?.targetCount).toStrictEqual(2);
                  await open(0);
                  await answer.fill('Preserve after conflict');
                  await notice.getByRole('button', {
                    name: i18n.t('assessments.builder.recoveryReload'),
                    exact: true,
                  }).click();
                  await guard.getByRole('button', {
                    name: i18n.t('assessments.builder.cancelDraftSwitch'),
                    exact: true,
                  }).click();
                  expect(await answer.inputValue()).toStrictEqual('Preserve after conflict');
                  const [pending] = await db.select().from(assessmentPlacementRemovals).where(
                    and(
                      eq(assessmentPlacementRemovals.assessmentId, assessment.id),
                      isNull(assessmentPlacementRemovals.restoredAt),
                    ),
                  ).orderBy(assessmentPlacementRemovals.removedAt);
                  if (!pending) expect.unreachable('Expected pending');
                  await db.update(assessmentPlacementRemovals).set({
                    expiresAt: new Date(Date.now() - 1),
                  }).where(eq(assessmentPlacementRemovals.id, pending.id));
                  await undo.click();
                  await notice.getByRole('alert').filter({
                    hasText: i18n.t('assessments.builder.recoveryExpired'),
                  }).waitFor();
                  expect(await undo.getAttribute('aria-disabled')).toStrictEqual('true');
                  expect(await answer.inputValue()).toStrictEqual('Preserve after conflict');
                  await page.screenshot({
                    path: evidence.path('qflow-placement-undo-expired.png'),
                  });
                  await db.update(assessmentPlacementRemovals).set({
                    expiresAt: new Date(Date.now() + 300000),
                  }).where(eq(assessmentPlacementRemovals.id, pending.id));
                  const navigation = page.waitForNavigation();
                  await notice.getByRole('button', {
                    name: i18n.t('assessments.builder.recoveryReload'),
                    exact: true,
                  }).click();
                  await guard.getByRole('button', {
                    name: i18n.t('assessments.builder.saveAndContinue'),
                    exact: true,
                  }).click();
                  await navigation;
                  await undo.waitFor();
                  await db.update(organizationMemberships).set({ role: 'teaching_assistant' })
                    .where(
                      and(
                        eq(organizationMemberships.tenantId, ctx.tenantId),
                        eq(organizationMemberships.userId, ctx.userId),
                      ),
                    );
                  await undo.click();
                  await notice.getByRole('alert').filter({
                    hasText: i18n.t('assessments.builder.recoveryForbidden'),
                  }).waitFor();
                  expect(await undo.getAttribute('aria-disabled')).toStrictEqual('true');
                  expect((await getAssessment(ctx, assessment.id))?.targetCount).toStrictEqual(2);
                  await db.update(organizationMemberships).set({ role: 'owner' }).where(
                    and(
                      eq(organizationMemberships.tenantId, ctx.tenantId),
                      eq(organizationMemberships.userId, ctx.userId),
                    ),
                  );
                }
                if (locale === 'sv-SE' && theme === 'dark') {
                  await remove.click();
                  await undo.waitFor();
                  await page.clock.fastForward(300001);
                  await notice.getByText(i18n.t('assessments.builder.recoveryExpired'), {
                    exact: true,
                  }).waitFor();
                  expect(await undo.getAttribute('aria-disabled')).toStrictEqual('true');
                  expect(
                    await page.locator('#assessment-removal-primary').evaluate((button) =>
                      button === document.activeElement
                    ),
                  ).toStrictEqual(true);
                }
                expect(dialogs).toStrictEqual([]);
                expect(errors).toStrictEqual([]);
              } catch (cause: unknown) {
                await captureBrowserFailure(page, evidence, 'qflow-placement-undo');
                throw cause;
              } finally {
                await context.close();
                await deleteAssessment(ctx, assessment.id);
              }
            }
          }
        } finally {
          await app?.close();
          app = undefined;
          await db.delete(authSessions).where(eq(authSessions.userId, ctx.userId));
        }
      });
    } finally {
      await app?.close();
      await shutdownDb();
    }
  },
);

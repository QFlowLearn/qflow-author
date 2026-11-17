import { expect, test as testCase } from 'vitest';
import type { BrowserContext } from 'playwright';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

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
import { assertNativeFormAccessibility } from './helpers/browser_form_accessibility.ts';

testCase(
  'saved question order examples preserve fixed pins and parts across locales, themes and draft lifetimes',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Saved order examples' });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(initial);
          const draft = (title: string) => ({
            type: 'single_select' as const,
            title,
            itemLanguage: newAuthoringItemLanguage(),
            bodyHtml: '<p>Choose Paris.</p>',
            choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
            correctId: 'A',
          });
          const items = [];
          for (const title of ['Pinned original', 'Free two', 'Free three', 'Second part']) {
            const result = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Create',
              partId: initial.parts[0].id,
              draft: draft(title),
            });
            if (!(result.ok)) expect.unreachable('Expected result.ok');
            items.push(result.value);
          }
          const revised = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Revise',
            expectedParentRevision: items[0].revision,
            placementId: items[0].placementId,
            itemId: items[0].itemId,
            draft: draft('Changed latest'),
          });
          if (!(revised.ok)) expect.unreachable('Expected revised.ok');
          const created = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(created);
          const first = created.parts[0];
          await saveAssessmentArrangementFixture(ctx, assessment.id, [{
            ...first,
            options: { shuffleQuestions: true, timeLimits: { maxTime: 300 } },
            placements: first.placements.slice(0, 3).map((p, index) => ({
              ...p,
              snapshotRev: 1,
              fixed: index === 0,
            })),
          }, {
            id: crypto.randomUUID(),
            title: 'Second saved part',
            options: { shuffleQuestions: false },
            placements: first.placements.slice(3),
          }]);
          const before = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(before);
          const revisions = await db.select().from(questionRevisions).where(
            eq(questionRevisions.tenantId, ctx.tenantId),
          ).orderBy(questionRevisions.id);
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5450, lastExclusive: 5460 },
              environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
            },
            headless: true,
          });
          for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
            await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
            const i18n = createI18n(locale, catalogForLocale(locale));
            for (const theme of ['wireframe', 'dark']) {
              const context: BrowserContext = await app.newContext({
                authSession: await createSession(ctx),
              });
              const page: import('playwright').Page = await context.newPage();
              page.setDefaultTimeout(20000);
              const errors: string[] = [];
              page.on('pageerror', (cause) => errors.push(safeErrorSummary(cause)));
              const endpoint = `**/api/assessments/${assessment.id}/question-order-preview?*`;
              const rail = page.getByRole('complementary', {
                name: i18n.t('assessments.settings.title'),
                exact: true,
              });
              const entry = page.getByRole('button', {
                name: new RegExp(`^${i18n.t('assessments.settings.title')}`),
              });
              const toggle = rail.getByRole('button').filter({
                hasText: i18n.t('assessments.orderPreview.title'),
              });
              const example = rail.getByRole('region', {
                name: i18n.t('assessments.orderPreview.example'),
                exact: true,
              });
              const show = rail.getByRole('button', {
                name: i18n.t('assessments.orderPreview.show'),
                exact: true,
              });
              const another = rail.getByRole('button', {
                name: i18n.t('assessments.orderPreview.another'),
                exact: true,
              });
              let reads = 0, writes = 0;
              page.on('request', (request) => {
                if (request.url().includes('/question-order-preview?')) reads++;
                if (request.method() === 'POST' && request.url().endsWith('/arrange')) writes++;
              });
              const generate = async () => {
                await Promise.all([
                  page.waitForResponse((r) =>
                    r.url().includes('/question-order-preview?') && r.status() === 200
                  ),
                  (await another.count() ? another : show).click(),
                ]);
                await example.waitFor();
                await another.waitFor();
              };
              try {
                await page.goto(`${app.baseUrl}/assessments/${assessment.id}`, {
                  waitUntil: 'networkidle',
                });
                await entry.click();
                await toggle.click();
                await show.focus();
                await show.press('Enter');
                await example.waitFor();
                const membership = async () =>
                  await example.locator('li').evaluateAll((nodes) =>
                    nodes.map((node) => node.getAttribute('data-placement-id'))
                  );
                const firstOrder = await membership();
                expect(firstOrder[0]).toStrictEqual(items[0].placementId);
                expect(firstOrder.slice(0, 3).sort()).toStrictEqual(
                  items.slice(0, 3).map((i) => i.placementId).sort(),
                );
                expect(firstOrder[3]).toStrictEqual(items[3].placementId);
                expect(await example.getByText('Pinned original', { exact: true }).count())
                  .toStrictEqual(1);
                expect(await example.getByText('Changed latest', { exact: true }).count())
                  .toStrictEqual(0);
                expect(await example.locator('ol').count()).toStrictEqual(2);
                const stable = await example.innerText();
                const count = reads;
                await toggle.click();
                await toggle.click();
                expect(await example.innerText()).toStrictEqual(stable);
                expect(reads).toStrictEqual(count);
                await generate();
                if (!(await another.isEnabled())) {
                  expect.unreachable('Expected await another.isEnabled()');
                }
                // Measure the resting target after daisyUI's native press animation finishes.
                await another.evaluate((node) =>
                  Promise.allSettled(node.getAnimations().map((animation) => animation.finished))
                );
                const target = await another.boundingBox();
                if (!(target && target.height >= 48)) {
                  expect.unreachable(`Resting preview target height: ${target?.height}`);
                }
                expect((await membership())[0]).toStrictEqual(items[0].placementId);
                expect((await membership())[3]).toStrictEqual(items[3].placementId);
                expect(writes).toStrictEqual(0);
                expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(
                  before.parts,
                );
                expect(
                  await db.select().from(questionRevisions).where(
                    eq(questionRevisions.tenantId, ctx.tenantId),
                  ).orderBy(questionRevisions.id),
                ).toStrictEqual(revisions);
                await page.evaluate(
                  (value) => document.documentElement.setAttribute('data-theme', value),
                  theme,
                );
                const section = toggle.locator('..').locator('..');
                for (const width of [390, 1280]) {
                  await page.setViewportSize({ width, height: 844 });
                  await example.evaluate((node) => node.scrollIntoView({ block: 'end' }));
                  if (
                    !(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
                  ) {
                    expect.unreachable(
                      'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
                    );
                  }
                  await page.screenshot({
                    path: evidence.path(`qflow-order-preview-${locale}-${theme}-${width}.png`),
                    animations: 'disabled',
                  });
                }
                await assertNativeFormAccessibility(page, section);
                if (locale === 'en-US' && theme === 'wireframe') {
                  const partToggle = rail.getByRole('button').filter({
                    hasText: i18n.t('assessments.settings.part', {
                      number: 1,
                      title: before.parts[0].title,
                    }),
                  });
                  await partToggle.click();
                  const maximum = rail.getByRole('textbox', {
                    name: i18n.t('assessments.arrange.modal.maxTime'),
                    exact: true,
                  });
                  await maximum.fill('-');
                  if (!(await show.isDisabled())) {
                    expect.unreachable('Expected await show.isDisabled()');
                  }
                  expect(await example.count()).toStrictEqual(0);
                  expect(await maximum.inputValue()).toStrictEqual('-');
                  await maximum.fill('300');
                  if (!(await show.isEnabled())) {
                    expect.unreachable('Expected await show.isEnabled()');
                  }
                  let release: () => void = () => {};
                  let fetched: () => void = () => {};
                  const held = new Promise<void>((resolve) => {
                    release = resolve;
                  });
                  const upstream = new Promise<void>((resolve) => {
                    fetched = resolve;
                  });
                  let responseWork: Promise<void> | undefined;
                  await page.route(endpoint, (route) => {
                    responseWork = (async () => {
                      const response = await route.fetch();
                      fetched();
                      await held;
                      await route.fulfill({ response });
                    })();
                    return responseWork;
                  });
                  try {
                    await show.click();
                    await upstream;
                    const cancelled = page.waitForEvent('requestfailed', {
                      predicate: (request) => request.url().includes('/question-order-preview?'),
                    });
                    await maximum.fill('-');
                    release();
                    await Promise.all([responseWork, cancelled]);
                    expect(await example.count()).toStrictEqual(0);
                    if (!(await show.isDisabled())) {
                      expect.unreachable('Expected await show.isDisabled()');
                    }
                    expect(await maximum.inputValue()).toStrictEqual('-');
                  } finally {
                    release();
                    await responseWork;
                    await page.unroute(endpoint);
                  }
                  await maximum.fill('300');
                  await generate();
                  // A real remote arrangement edit is refused instead of showing stale policy.
                  await saveAssessmentArrangementFixture(
                    ctx,
                    assessment.id,
                    before.parts.map((part, index) => ({
                      ...part,
                      options: index === 0
                        ? { ...part.options, shuffleQuestions: false }
                        : part.options,
                    })),
                  );
                  await another.click();
                  await rail.getByRole('status').filter({
                    hasText: i18n.t('assessments.orderPreview.stale'),
                  }).waitFor();
                  expect(await example.count()).toStrictEqual(0);
                  await saveAssessmentArrangementFixture(ctx, assessment.id, before.parts);
                  await generate();
                  // A malformed real HTTP response must not become a visible example.
                  await page.route(endpoint, async (route) => {
                    const response = await route.fetch();
                    const body: unknown = await response.json();
                    if (!(body !== null && typeof body === 'object' && !Array.isArray(body))) {
                      expect.unreachable(
                        "Expected body !== null && typeof body === 'object' && !Array.isArray(body)",
                      );
                    }
                    await route.fulfill({ response, json: { ...body, unexpected: true } });
                  });
                  try {
                    await another.click();
                    await rail.getByRole('status').filter({
                      hasText: i18n.t('assessments.orderPreview.failed'),
                    }).waitFor();
                    expect(await example.count()).toStrictEqual(0);
                  } finally {
                    await page.unroute(endpoint);
                  }
                  await generate();
                  // Preview must release the canonical capture before an actual settings save.
                  const save = rail.getByRole('button', {
                    name: i18n.t('assessments.settings.save'),
                    exact: true,
                  });
                  const saveMaximum = async (value: string) => {
                    await maximum.fill(value);
                    const [response] = await Promise.all([
                      page.waitForResponse((r) =>
                        r.request().method() === 'POST' && r.url().endsWith('/arrange')
                      ),
                      save.click(),
                    ]);
                    expect(response.status()).toStrictEqual(200);
                    await rail.getByRole('status').filter({
                      hasText: i18n.t('assessments.settings.saved'),
                    }).waitFor();
                    await show.waitFor();
                    await generate();
                  };
                  await saveMaximum('600');
                  expect((await getAssessment(ctx, assessment.id))?.parts[0].options?.timeLimits)
                    .toStrictEqual({ maxTime: 600 });
                  await page.reload({ waitUntil: 'networkidle' });
                  await entry.click();
                  await toggle.click();
                  expect(await example.count()).toStrictEqual(0);
                  await generate();
                  await partToggle.click();
                  expect(await maximum.inputValue()).toStrictEqual('600');
                  await saveMaximum('300');
                  expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(
                    before.parts,
                  );
                }
                expect(errors).toStrictEqual([]);
                console.log(`Question order preview ${locale}/${theme}: verified`);
              } catch (cause: unknown) {
                await captureBrowserFailure(
                  page,
                  evidence,
                  `qflow-order-preview-${locale}-${theme}`,
                );
                throw cause;
              } finally {
                await context.close();
              }
            }
          }
          await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
          const i18n = createI18n('en-US', catalogForLocale('en-US'));
          const context: BrowserContext = await app.newContext({
            authSession: await createSession(ctx),
          });
          const page: import('playwright').Page = await context.newPage();
          page.setDefaultTimeout(20000);
          try {
            await page.goto(`${app.baseUrl}/assessments/${assessment.id}`, {
              waitUntil: 'networkidle',
            });
            const card = page.locator(`#assessment-question-${items[1].placementId}`);
            await card.getByRole('button', {
              name: i18n.t('assessments.builder.editQuestion', {
                number: '1.2',
                title: 'Free two',
              }),
              exact: true,
            }).getByText('Free two', { exact: true }).click();
            const answer = card.getByRole('textbox', {
              name: i18n.t('driver.choicePlaceholder', { id: 'A' }),
              exact: true,
            });
            await answer.fill('Unsaved answer');
            await page.getByRole('button', {
              name: new RegExp(`^${i18n.t('assessments.settings.title')}`),
            }).click();
            const rail = page.getByRole('complementary', {
              name: i18n.t('assessments.settings.title'),
              exact: true,
            });
            await rail.getByRole('button').filter({
              hasText: i18n.t('assessments.orderPreview.title'),
            }).click();
            const show = rail.getByRole('button', {
              name: i18n.t('assessments.orderPreview.show'),
              exact: true,
            });
            const guard = page.getByRole('dialog', {
              name: i18n.t('assessments.builder.keepDraftTitle'),
              exact: true,
            });
            let requests = 0;
            page.on('request', (request) => {
              if (request.url().includes('/question-order-preview?')) requests++;
            });
            await show.click();
            await guard.getByRole('button', {
              name: i18n.t('assessments.builder.cancelDraftSwitch'),
              exact: true,
            }).click();
            expect(requests).toStrictEqual(0);
            expect(await answer.inputValue()).toStrictEqual('Unsaved answer');
            await show.click();
            const [saved] = await Promise.all([
              page.waitForResponse((r) =>
                r.request().method() === 'POST' && r.url().endsWith('/questions')
              ),
              guard.getByRole('button', {
                name: i18n.t('assessments.builder.saveAndContinue'),
                exact: true,
              }).click(),
            ]);
            expect(saved.status()).toStrictEqual(201);
            await rail.getByRole('region', {
              name: i18n.t('assessments.orderPreview.example'),
              exact: true,
            }).waitFor();
            const confirmed = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(confirmed);
            expect(confirmed.parts[0].placements[1].snapshotRev).toStrictEqual(2);
            expect(confirmed.parts[0].placements[0].snapshotRev).toStrictEqual(1);
            expect(requests).toStrictEqual(1);
          } catch (cause: unknown) {
            await captureBrowserFailure(page, evidence, 'qflow-order-preview-draft-guard');
            throw cause;
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

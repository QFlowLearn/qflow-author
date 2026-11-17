import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';
import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';
import axe from 'axe-core';
import { chromium } from 'playwright';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions } from '../lib/db/schema.ts';
import { parseAssessmentPartOptions } from '../lib/assessment_arrangement.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { buildAssessmentTestXml } from '../lib/test_export.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { captureQuestionProtectionFields } from './helpers/question_protection_browser.ts';
import {
  type BrowserLoadingEvidence,
  captureBrowserLoading,
  observeBrowserLoading,
} from './helpers/browser_loading.ts';

testCase(
  'browser evidence uses the host temporary directory and remains nonthrowing after page closure',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const evidence = await createBrowserEvidenceDirectory();
    const browser = await chromium.launch({ headless: true });
    try {
      const page: import('playwright').Page = await browser.newPage();
      await page.setContent('<p>Original failure context</p>');
      await captureBrowserFailure(page, evidence, 'open-page');
      expect(await _fs.readFile(evidence.path('open-page-failure.txt'), 'utf8')).toStrictEqual(
        'Original failure context',
      );
      if (!((await _fs.stat(evidence.path('open-page-failure.png'))).size > 0)) {
        expect.unreachable(
          "Expected (await _fs.stat(evidence.path('open-page-failure.png'))).size > 0",
        );
      }
      await page.close();
      expect(await captureBrowserFailure(page, evidence, 'closed-page')).toStrictEqual(undefined);
    } finally {
      await browser.close();
    }
  },
);

testCase(
  'real Arrange reload and keyboard ordering preserve saved part settings across locales and themes',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, {
          title: 'Arrange settings regression',
        });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(initial);
          const partId = initial.parts[0].id;
          const titles = new Map<string, string>();
          for (const title of ['First question', 'Second question']) {
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
            titles.set(result.value.itemId, title);
          }
          const saved = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(saved);
          const options = {
            shuffleQuestions: true,
            navigationMode: 'linear',
            submissionMode: 'simultaneous',
            timeLimits: { minTime: 30, maxTime: 300 },
            instructionsHtml: '<p>Read each question carefully.</p>',
            feedback: [{
              id: crypto.randomUUID(),
              access: 'atEnd',
              showHide: 'show',
              outcomeIdentifier: 'TEST_FEEDBACK',
              html: '<p>Thank you.</p>',
            }],
          };
          await saveAssessmentArrangementFixture(ctx, assessment.id, [{
            ...saved.parts[0],
            options,
            placements: saved.parts[0].placements.map((placement, index) => ({
              ...placement,
              fixed: index === 0,
            })),
          }]);
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5400, lastExclusive: 5410 },
              environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
            },
            headless: true,
          });
          for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
            await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
            const i18n = createI18n(locale, catalogForLocale(locale));
            for (const theme of ['wireframe', 'dark']) {
              const context: import('playwright').BrowserContext = await app.newContext({
                authSession: await createSession(ctx),
                browser: { viewport: { width: 390, height: 844 } },
              });
              let loading: BrowserLoadingEvidence | undefined;
              try {
                const page: import('playwright').Page = await context.newPage();
                loading = observeBrowserLoading(page, app.baseUrl, () => `${locale}/${theme}`);
                page.setDefaultTimeout(20000);
                const errors: string[] = [];
                page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
                await page.goto(`${app.baseUrl}/assessments/${assessment.id}/arrange`, {
                  waitUntil: 'networkidle',
                });
                await page.evaluate(
                  (value) => document.documentElement.setAttribute('data-theme', value),
                  theme,
                );
                const settings = page.getByRole('button', {
                  name: i18n.t('assessments.arrange.partSettings'),
                  exact: true,
                });
                const modal = page.getByRole('dialog', {
                  name: i18n.t('assessments.arrange.modal.title', { part: 1 }),
                  exact: true,
                });
                const protectionSummary = modal.locator('summary').filter({
                  hasText: i18n.t('assessments.partSettings.fixedQuestions'),
                });
                const protectedQuestion = modal.getByRole('checkbox', { name: /First question$/ });
                const openProtection = async () => {
                  const open = await protectionSummary.locator('..').getAttribute('open');
                  if (open === null) await protectionSummary.click();
                  await protectedQuestion.waitFor({ state: 'visible' });
                };
                const checkSettings = async () => {
                  await settings.click();
                  expect(
                    await modal.getByRole('checkbox', {
                      name: i18n.t('assessments.partSettings.shuffleQuestions'),
                      exact: true,
                    }).isChecked(),
                  ).toStrictEqual(true);
                  expect(
                    await modal.getByRole('combobox', {
                      name: i18n.t('assessments.arrange.modal.navigation'),
                      exact: true,
                    }).inputValue(),
                  ).toStrictEqual(options.navigationMode);
                  expect(
                    await modal.getByRole('combobox', {
                      name: i18n.t('assessments.arrange.modal.submission'),
                      exact: true,
                    }).inputValue(),
                  ).toStrictEqual(options.submissionMode);
                  expect(
                    await modal.getByRole('textbox', {
                      name: i18n.t('assessments.arrange.modal.minTime'),
                      exact: true,
                    }).inputValue(),
                  ).toStrictEqual('30');
                  expect(
                    await modal.getByRole('textbox', {
                      name: i18n.t('assessments.arrange.modal.maxTime'),
                      exact: true,
                    }).inputValue(),
                  ).toStrictEqual('300');
                  expect(
                    await modal.getByRole('textbox', {
                      name: i18n.t('assessments.arrange.modal.instructions'),
                      exact: true,
                    }).inputValue(),
                  ).toStrictEqual(options.instructionsHtml);
                  await modal.locator('summary').filter({
                    hasText: i18n.t('assessments.arrange.modal.feedback'),
                  }).click();
                  expect(
                    await modal.getByRole('textbox', {
                      name: i18n.t('assessments.arrange.modal.outcome'),
                      exact: true,
                    }).inputValue(),
                  ).toStrictEqual('TEST_FEEDBACK');
                  expect(
                    await modal.getByRole('textbox', {
                      name: i18n.t('assessments.arrange.modal.feedbackHtml'),
                      exact: true,
                    }).inputValue(),
                  ).toStrictEqual(options.feedback[0].html);
                  await openProtection();
                  expect(await protectedQuestion.isChecked()).toStrictEqual(true);
                  await captureQuestionProtectionFields(
                    page,
                    modal,
                    i18n,
                    evidence,
                    `qflow-arrange-protection-${locale}-${theme}`,
                  );
                  await page.setViewportSize({ width: 390, height: 844 });
                  await modal.getByRole('button', {
                    name: i18n.t('assessments.arrange.modal.close'),
                    exact: true,
                  }).click();
                };
                await checkSettings();
                const protectedBase = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(protectedBase);
                for (const fixed of [false, true]) {
                  await settings.click();
                  await openProtection();
                  await protectedQuestion.focus();
                  await protectedQuestion.press('Space');
                  expect(await protectedQuestion.isChecked()).toStrictEqual(fixed);
                  await modal.getByRole('button', {
                    name: i18n.t('assessments.arrange.modal.close'),
                    exact: true,
                  }).click();
                  const [response] = await Promise.all([
                    page.waitForResponse((r) =>
                      r.request().method() === 'POST' && r.url().endsWith('/arrange')
                    ),
                    page.getByRole('button', {
                      name: i18n.t('assessments.arrange.save'),
                      exact: true,
                    }).click(),
                  ]);
                  expect(response.status()).toStrictEqual(200);
                  await page.getByRole('status').filter({
                    hasText: i18n.t('assessments.arrange.saved'),
                  }).waitFor();
                  const protectedSaved = await getAssessment(ctx, assessment.id);
                  assertQuestionOnlyAssessmentFixture(protectedSaved);
                  expect(protectedSaved.parts[0].options).toStrictEqual(options);
                  expect(protectedSaved.parts[0].placements).toStrictEqual(
                    protectedBase.parts[0].placements.map((placement) => ({
                      ...placement,
                      fixed: titles.get(placement.itemId) === 'First question'
                        ? fixed
                        : placement.fixed,
                    })),
                  );
                  await page.reload({ waitUntil: 'networkidle' });
                  await page.evaluate(
                    (value) => document.documentElement.setAttribute('data-theme', value),
                    theme,
                  );
                  await settings.click();
                  await openProtection();
                  expect(await protectedQuestion.isChecked()).toStrictEqual(fixed);
                  await modal.getByRole('button', {
                    name: i18n.t('assessments.arrange.modal.close'),
                    exact: true,
                  }).click();
                }
                // Raw invalid seconds stay editable across close/reopen and block every save path.
                let invalidWrites = 0;
                const countInvalidWrite = (request: import('playwright').Request) => {
                  if (request.method() === 'POST' && request.url().endsWith('/arrange')) {
                    invalidWrites++;
                  }
                };
                page.on('request', countInvalidWrite);
                await settings.click();
                const minimum = modal.getByRole('textbox', {
                  name: i18n.t('assessments.arrange.modal.minTime'),
                  exact: true,
                });
                const maximum = modal.getByRole('textbox', {
                  name: i18n.t('assessments.arrange.modal.maxTime'),
                  exact: true,
                });
                await minimum.fill('-');
                // Blurring inserts validation feedback above the disclosure. Finish that reflow
                // before clicking its summary so pointer activation cannot miss the moving target.
                await minimum.press('Tab');
                await modal.getByText(i18n.t('assessments.partSettings.timeNumber'), {
                  exact: true,
                }).waitFor();
                await openProtection();
                await protectedQuestion.uncheck();
                expect(await minimum.inputValue()).toStrictEqual('-');
                const shuffle = modal.getByRole('checkbox', {
                  name: i18n.t('assessments.partSettings.shuffleQuestions'),
                  exact: true,
                });
                await shuffle.uncheck();
                expect(await minimum.inputValue()).toStrictEqual('-');
                await maximum.focus();
                await modal.getByText(i18n.t('assessments.partSettings.timeNumber'), {
                  exact: true,
                }).waitFor();
                expect(await minimum.inputValue()).toStrictEqual('-');
                await modal.getByRole('button', {
                  name: i18n.t('assessments.arrange.modal.close'),
                  exact: true,
                }).click();
                await page.getByText(i18n.t('assessments.partSettings.review'), { exact: true })
                  .waitFor();
                if (
                  !(await page.getByRole('button', {
                    name: i18n.t('assessments.arrange.save'),
                    exact: true,
                  }).isDisabled())
                ) {
                  expect.unreachable(
                    "Expected await page.getByRole('button', { name: i18n.t('assessments.arrange.save'), exact: true, })",
                  );
                }
                await page.locator('div[tabindex="0"]').first().focus();
                await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
                await modal.waitFor();
                expect(await minimum.inputValue()).toStrictEqual('-');
                await openProtection();
                expect(await protectedQuestion.isChecked()).toStrictEqual(false);
                await protectedQuestion.check();
                expect(await minimum.inputValue()).toStrictEqual('-');
                expect(await shuffle.isChecked()).toStrictEqual(false);
                await shuffle.check();
                expect(await minimum.inputValue()).toStrictEqual('-');
                await minimum.fill('-1');
                expect(await minimum.inputValue()).toStrictEqual('-1');
                await minimum.fill('30.5');
                expect(await minimum.inputValue()).toStrictEqual('30.5');
                await minimum.fill('400');
                await maximum.focus();
                await modal.getByText(i18n.t('assessments.partSettings.timeRange'), { exact: true })
                  .waitFor();
                await modal.evaluate(async (element) => {
                  const settled = await Promise.allSettled(
                    element.getAnimations({ subtree: true }).map((animation) => animation.finished),
                  );
                  // Replaced transitions cancel normally; unrelated browser failures still reject.
                  for (const result of settled) {
                    if (result.status === 'fulfilled') continue;
                    if (
                      result.reason instanceof DOMException && result.reason.name === 'AbortError'
                    ) {
                      continue;
                    }
                    throw result.reason;
                  }
                });
                if (
                  !(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
                ) {
                  expect.unreachable(
                    'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
                  );
                }
                await page.addScriptTag({ content: axe.source });
                const contrast: unknown = await page.evaluate(
                  `(async () => {
                    const rule = {runOnly: {type: 'rule', values: ['color-contrast']}};
                    const dialog = document.querySelector('dialog[open]');
                    const modal = await globalThis.axe.run(dialog, rule);
                    // Icon-only controls and clipped fields need other checks. Require a
                    // complete contrast result for the visible validation message itself.
                    const message = await globalThis.axe.run(dialog.querySelector('[role="alert"]'), rule);
                    return {
                      violations: modal.violations.map(issue => ({id: issue.id, nodes: issue.nodes.map(node => node.html)})),
                      incomplete: message.incomplete.flatMap(issue => issue.nodes.map(node => ({html: node.html, reason: node.failureSummary}))),
                      issueChecked: message.passes.some(issue => issue.nodes.some(node => node.html.includes('role="alert"')))
                    };
                  })()`,
                );
                expect(contrast, `Part settings contrast: ${locale}/${theme}`).toStrictEqual({
                  violations: [],
                  incomplete: [],
                  issueChecked: true,
                });
                await page.screenshot({
                  path: evidence.path(`qflow-part-time-invalid-${locale}-${theme}.png`),
                });
                expect((await getAssessment(ctx, assessment.id))?.parts[0].options).toStrictEqual(
                  options,
                );
                expect(invalidWrites).toStrictEqual(0);
                await minimum.fill('30');
                await modal.getByRole('alert').waitFor({ state: 'detached' });
                await modal.getByRole('button', {
                  name: i18n.t('assessments.arrange.modal.close'),
                  exact: true,
                }).click();
                page.off('request', countInvalidWrite);
                const before = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(before);
                const first = before.parts[0].placements[0];
                const firstTitle = titles.get(first.itemId);
                if (!firstTitle) expect.unreachable('Expected firstTitle');
                const handle = page.getByRole('button', {
                  name: i18n.t('assessments.arrange.dragQuestion', {
                    count: 1,
                    title: firstTitle,
                  }),
                  exact: true,
                });
                await handle.click();
                await handle.press('ArrowDown');
                await page.getByRole('button', {
                  name: i18n.t('assessments.arrange.dragQuestion', {
                    count: 2,
                    title: firstTitle,
                  }),
                  exact: true,
                }).waitFor();
                const [response] = await Promise.all([
                  page.waitForResponse((r) =>
                    r.request().method() === 'POST' && r.url().endsWith('/arrange')
                  ),
                  page.getByRole('button', {
                    name: i18n.t('assessments.arrange.save'),
                    exact: true,
                  }).click(),
                ]);
                expect(response.status()).toStrictEqual(200);
                await page.getByRole('status').filter({
                  hasText: i18n.t('assessments.arrange.saved'),
                }).waitFor();
                const after = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(after);
                expect(after.parts[0].options).toStrictEqual(options);
                expect(after.targetCount).toStrictEqual(2);
                expect(after.parts[0].placements.filter((placement) => placement.fixed).length)
                  .toStrictEqual(1);
                expect(after.parts[0].placements).toStrictEqual(
                  [...before.parts[0].placements].reverse(),
                );
                const parsed = parseAssessmentPartOptions(after.parts[0].options);
                if (!(parsed.ok)) expect.unreachable('Expected parsed.ok');
                const xml = buildAssessmentTestXml(after, [{
                  ...after.parts[0],
                  options: parsed.options,
                  placements: after.parts[0].placements.map((p) => ({
                    ...p,
                    snapshotRev: p.snapshotRev ?? undefined,
                  })),
                }]);
                expect(xml).toContain('navigation-mode="linear"');
                expect(xml).toContain('submission-mode="simultaneous"');
                expect(xml).toContain('min-time="30"');
                expect(xml).toContain('max-time="300"');
                expect(xml).toContain('<qti-ordering shuffle="true"');
                await page.reload({ waitUntil: 'networkidle' });
                await page.evaluate(
                  (value) => document.documentElement.setAttribute('data-theme', value),
                  theme,
                );
                await checkSettings();
                await page.screenshot({
                  path: evidence.path(`qflow-arrange-settings-${locale}-${theme}.png`),
                });
                const saveButton = page.getByRole('button', {
                  name: i18n.t('assessments.arrange.save'),
                  exact: true,
                });
                const unsaved = page.getByText(i18n.t('assessments.arrange.unsaved'), {
                  exact: true,
                });
                const movedTitle = titles.get(after.parts[0].placements[0].itemId);
                if (!movedTitle) expect.unreachable('Expected movedTitle');
                const questionHandle = (position: number) =>
                  page.getByRole('button', {
                    name: i18n.t('assessments.arrange.dragQuestion', {
                      count: position,
                      title: movedTitle,
                    }),
                    exact: true,
                  });
                const moveDown = async () => {
                  await questionHandle(1).click();
                  await questionHandle(1).press('ArrowDown');
                  await questionHandle(2).waitFor();
                };
                const moveUp = async () => {
                  await questionHandle(2).click();
                  await questionHandle(2).press('ArrowUp');
                  await questionHandle(1).waitFor();
                };
                const endpoint = `**/api/assessments/${assessment.id}/arrange`;
                let release: (() => void) | undefined;
                let committed: (() => void) | undefined;
                const committedPromise = new Promise<void>((resolve) => committed = resolve);
                await page.route(endpoint, async (route) => {
                  const response = await route.fetch();
                  expect(response.status()).toStrictEqual(200);
                  committed?.();
                  await new Promise<void>((resolve) => release = resolve);
                  await route.fulfill({ response });
                });
                await moveDown();
                await saveButton.click();
                await committedPromise;
                await settings.click();
                await minimum.fill('-');
                await maximum.focus();
                await modal.getByRole('button', {
                  name: i18n.t('assessments.arrange.modal.close'),
                  exact: true,
                }).click();
                await unsaved.waitFor();
                if (!release) expect.unreachable('Expected release');
                release();
                await page.getByRole('status').filter({
                  hasText: i18n.t('assessments.arrange.newerEdits'),
                }).waitFor();
                await unsaved.waitFor();
                if (!(await saveButton.isDisabled())) {
                  expect.unreachable('Expected await saveButton.isDisabled()');
                }
                await settings.click();
                expect(await minimum.inputValue()).toStrictEqual('-');
                await minimum.fill('30');
                await modal.getByRole('button', {
                  name: i18n.t('assessments.arrange.modal.close'),
                  exact: true,
                }).click();
                await page.getByRole('status').filter({
                  hasText: i18n.t('assessments.arrange.saved'),
                }).waitFor();
                await moveUp();
                await unsaved.waitFor();
                const pendingSaved = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(pendingSaved);
                expect(pendingSaved.parts[0].placements).toStrictEqual(
                  [...after.parts[0].placements].reverse(),
                );
                await page.unroute(endpoint);
                await saveButton.click();
                await page.getByRole('status').filter({
                  hasText: i18n.t('assessments.arrange.saved'),
                }).waitFor();
                expect(await unsaved.count()).toStrictEqual(0);
                const latestSaved = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(latestSaved);
                expect(latestSaved.parts[0].placements).toStrictEqual(after.parts[0].placements);

                // Commit a real POST, then lose its response and change the local draft before retry.
                let lostRequest: string | null = null;
                await page.route(endpoint, async (route) => {
                  lostRequest = route.request().postData();
                  const response = await route.fetch();
                  expect(response.status()).toStrictEqual(200);
                  await route.abort('failed');
                });
                await moveDown();
                await saveButton.click();
                await page.getByRole('alert').filter({
                  hasText: i18n.t('assessments.arrange.saveFailed'),
                }).waitFor();
                if (!lostRequest) expect.unreachable('Expected lostRequest');
                await moveUp();
                await page.unroute(endpoint);
                const [retryResponse] = await Promise.all([
                  page.waitForResponse((r) =>
                    r.request().method() === 'POST' && r.url().endsWith('/arrange')
                  ),
                  saveButton.click(),
                ]);
                expect(retryResponse.status()).toStrictEqual(200);
                expect(retryResponse.request().postData()).toStrictEqual(lostRequest);
                await page.getByRole('status').filter({
                  hasText: i18n.t('assessments.arrange.newerEdits'),
                }).waitFor();
                await unsaved.waitFor();
                await saveButton.click();
                await page.getByRole('status').filter({
                  hasText: i18n.t('assessments.arrange.saved'),
                }).waitFor();
                const recovered = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(recovered);
                expect(recovered.parts[0].placements).toStrictEqual(after.parts[0].placements);
                expect(recovered.parts[0].options).toStrictEqual(options);

                // A second writer changes saved settings while this page keeps its own local move.
                await saveAssessmentArrangementFixture(
                  ctx,
                  assessment.id,
                  recovered.parts.map((part) => ({
                    ...part,
                    options: {
                      ...options,
                      instructionsHtml: '<p>Another editor changed the instructions.</p>',
                    },
                  })),
                );
                await moveDown();
                const [conflict] = await Promise.all([
                  page.waitForResponse((r) =>
                    r.request().method() === 'POST' && r.url().endsWith('/arrange')
                  ),
                  saveButton.click(),
                ]);
                expect(conflict.status()).toStrictEqual(409);
                await page.getByRole('alert').filter({
                  hasText: i18n.t('assessments.arrange.conflict'),
                }).waitFor();
                await questionHandle(2).waitFor();
                await unsaved.waitFor();
                await page.screenshot({
                  path: evidence.path(`qflow-arrange-save-conflict-${locale}-${theme}.png`),
                });
                const reloadSaved = page.getByRole('button', {
                  name: i18n.t('assessments.arrange.reloadSaved'),
                  exact: true,
                });
                let dialogReply: Promise<void> | undefined;
                page.once('dialog', (dialog) => dialogReply = dialog.dismiss());
                await reloadSaved.click();
                await dialogReply;
                await questionHandle(2).waitFor();
                page.once('dialog', (dialog) => dialogReply = dialog.accept());
                await Promise.all([
                  page.waitForEvent('load'),
                  reloadSaved.click(),
                ]);
                await dialogReply;
                await questionHandle(1).waitFor();
                const remote = await getAssessment(ctx, assessment.id);
                assertQuestionOnlyAssessmentFixture(remote);
                expect(remote.parts[0].options.instructionsHtml).toStrictEqual(
                  '<p>Another editor changed the instructions.</p>',
                );
                expect(remote.parts[0].placements).toStrictEqual(recovered.parts[0].placements);
                await saveAssessmentArrangementFixture(
                  ctx,
                  assessment.id,
                  remote.parts.map((part) => ({ ...part, options })),
                );

                if (locale === 'en-US' && theme === 'wireframe') {
                  // An explicitly empty feedback list can create its first canonical block.
                  await saveAssessmentArrangementFixture(
                    ctx,
                    assessment.id,
                    remote.parts.map((part) => ({
                      ...part,
                      options: { ...options, feedback: [] },
                    })),
                  );
                  await page.reload({ waitUntil: 'networkidle' });
                  await settings.click();
                  await modal.locator('summary').filter({
                    hasText: i18n.t('assessments.arrange.modal.feedback'),
                  }).click();
                  await modal.getByRole('textbox', {
                    name: i18n.t('assessments.arrange.modal.outcome'),
                    exact: true,
                  }).fill('FIRST_FEEDBACK');
                  await modal.getByRole('textbox', {
                    name: i18n.t('assessments.arrange.modal.feedbackHtml'),
                    exact: true,
                  }).fill('<p>New first feedback.</p>');
                  await modal.getByRole('button', {
                    name: i18n.t('assessments.arrange.modal.close'),
                    exact: true,
                  }).click();
                  const [feedbackResponse] = await Promise.all([
                    page.waitForResponse((response) =>
                      response.request().method() === 'POST' && response.url().endsWith('/arrange')
                    ),
                    saveButton.click(),
                  ]);
                  expect(feedbackResponse.status()).toStrictEqual(200);
                  const feedbackSaved = await getAssessment(ctx, assessment.id);
                  assertQuestionOnlyAssessmentFixture(feedbackSaved);
                  const feedbackOptions = parseAssessmentPartOptions(
                    feedbackSaved.parts[0].options,
                  );
                  if (!(feedbackOptions.ok)) expect.unreachable('Expected feedbackOptions.ok');
                  expect(feedbackOptions.options.feedback?.length).toStrictEqual(1);
                  expect(feedbackOptions.options.feedback?.[0].html).toStrictEqual(
                    '<p>New first feedback.</p>',
                  );
                  expect(feedbackOptions.options.feedback?.[0].outcomeIdentifier).toStrictEqual(
                    'FIRST_FEEDBACK',
                  );
                  expect(feedbackOptions.options.timeLimits).toStrictEqual(options.timeLimits);
                  expect(feedbackSaved.parts[0].placements).toStrictEqual(
                    remote.parts[0].placements,
                  );
                  await saveAssessmentArrangementFixture(
                    ctx,
                    assessment.id,
                    feedbackSaved.parts.map((part) => ({ ...part, options })),
                  );
                }
                expect(errors).toStrictEqual([]);
              } catch (cause: unknown) {
                const page = context.pages()[0];
                if (page) await captureBrowserFailure(page, evidence, 'qflow-arrange-settings');
                if (loading) {
                  await captureBrowserLoading(loading, evidence, 'qflow-arrange-settings');
                }
                throw cause;
              } finally {
                loading?.stop();
                await context.close();
              }
            }
          }
        } finally {
          await app?.close();
          app = undefined;
          await deleteAssessment(ctx, assessment.id);
          await db.delete(authSessions).where(eq(authSessions.userId, ctx.userId));
        }
      });
    } finally {
      await app?.close();
      await shutdownDb();
    }
  },
);

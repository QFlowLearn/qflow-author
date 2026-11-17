import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';

import { eq } from 'drizzle-orm';
import axe from 'axe-core';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions } from '../lib/db/schema.ts';
import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';

testCase(
  'real text editing preserves native undo, mixed order, drafts and exact uncertain retries',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Text editing acceptance' });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          for (const title of ['First real question', 'Second real question']) {
            const created = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Create',
              partId: initial.parts[0].id,
              draft: {
                type: 'single_select',
                title,
                itemLanguage: newAuthoringItemLanguage(),
                bodyHtml: '<p>Choose a city.</p>',
                choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
                correctId: 'A',
              },
            });
            if (!(created.ok)) expect.unreachable('Expected created.ok');
          }
          const saved = await getAssessment(ctx, assessment.id);
          if (!saved) expect.unreachable('Expected saved');
          const [first, second] = assessmentQuestionPlacements(saved.parts[0].placements);
          const text = {
            id: crypto.randomUUID(),
            content: { kind: 'text' as const, text: 'Initial instructions' },
            fixed: true as const,
          };
          await saveAssessmentArrangementFixture(ctx, assessment.id, [{
            ...saved.parts[0],
            placements: [first, text, second],
          }]);
          const original = await getAssessment(ctx, assessment.id);
          if (!original) expect.unreachable('Expected original');
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
            const i18n = createI18n(locale, catalogForLocale(locale));
            for (const theme of ['wireframe', 'dark'] as const) {
              await saveUserSettings(ctx.userId, { ...createInitialUserSettings(locale), theme });
              const context: import('playwright').BrowserContext = await app.newContext({
                authSession: await createSession(ctx),
                browser: { viewport: { width: 390, height: 844 } },
              });
              await context.addInitScript(
                (selected) => localStorage.setItem('qflow-theme', selected),
                theme,
              );
              const page: import('playwright').Page = await context.newPage();
              page.setDefaultTimeout(20000);
              const errors: string[] = [], dialogs: string[] = [];
              page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
              page.on('dialog', async (dialog) => {
                dialogs.push(dialog.type());
                await dialog.dismiss();
              });
              const editor = page.getByRole('article').filter({
                has: page.locator('textarea[name=text]'),
              });
              const input = editor.getByRole('textbox', {
                name: i18n.t('assessments.textEditor.label'),
                exact: true,
              });
              const save = editor.getByRole('button', {
                name: i18n.t('assessments.textEditor.save'),
                exact: true,
              });
              const guard = page.getByRole('dialog', {
                name: i18n.t('assessments.textEditor.keepDraftTitle'),
                exact: true,
              });
              const editButton = page.locator(`#edit-text-${text.id}`);
              const question = page.getByRole('button', {
                name: i18n.t('assessments.builder.editQuestion', {
                  number: '1.1',
                  title: 'First real question',
                }),
                exact: true,
              });
              const endpoint = `**/api/assessments/${assessment.id}/arrange`;
              const currentText = async (): Promise<string> => {
                const value = await getAssessment(ctx, assessment.id);
                if (!value) expect.unreachable('Expected value');
                expect(value.parts[0].options).toStrictEqual(original.parts[0].options);
                expect(assessmentQuestionPlacements(value.parts[0].placements)).toStrictEqual([
                  first,
                  second,
                ]);
                expect(value.parts[0].placements.map((placement) => placement.id)).toStrictEqual([
                  first.id,
                  text.id,
                  second.id,
                ]);
                const placement = value.parts[0].placements[1];
                if (!('content' in placement)) {
                  expect.unreachable("Expected 'content' in placement");
                }
                if (!(placement.content.kind === 'text')) {
                  expect.unreachable("Expected placement.content.kind === 'text'");
                }
                return placement.content.text;
              };
              try {
                await page.goto(`${app.baseUrl}/assessments/${assessment.id}`, {
                  waitUntil: 'networkidle',
                });
                await editButton.click();
                await input.waitFor();
                const baseline = await currentText();
                expect(await input.inputValue()).toStrictEqual(baseline);
                // A native edit and Undo retain the same controlled textarea and undo history.
                await input.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
                await page.keyboard.type('!');
                expect(await input.inputValue()).toStrictEqual(`${baseline}!`);
                await input.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
                expect(await input.inputValue()).toStrictEqual(baseline);
                const literal =
                  `  ${locale}/${theme}: <script>alert("unsafe")</script> & α\nhttps://example.com/path  `;
                await input.fill(literal);
                await input.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
                await page.keyboard.type('!');
                await question.click();
                await guard.waitFor();
                await page.waitForFunction(() =>
                  document.activeElement?.hasAttribute('data-cancel-draft') === true
                );
                if (locale === 'en-US' && theme === 'wireframe') {
                  // Audit the settled dialog rather than an intermediate fade/scale frame.
                  await guard.evaluate((element) =>
                    Promise.all(
                      element.getAnimations({ subtree: true }).map((animation) =>
                        animation.finished
                      ),
                    )
                  );
                  await page.addScriptTag({ content: axe.source });
                  const audit: unknown = await page.evaluate(
                    'globalThis.axe.run("dialog[open]").then(result => result.violations.map(violation => ({id: violation.id, nodes: violation.nodes.map(node => ({html: node.html, reason: node.failureSummary}))})))',
                  );
                  if (Array.isArray(audit) && audit.length) {
                    await _fs.writeFile(
                      evidence.path('text-draft-dialog-a11y.json'),
                      JSON.stringify(audit, null, 2),
                      'utf8',
                    );
                  }
                  expect(audit).toStrictEqual([]);
                }
                await guard.getByRole('button', {
                  name: i18n.t('assessments.builder.cancelDraftSwitch'),
                  exact: true,
                }).click();
                expect(await input.inputValue()).toStrictEqual(`${literal}!`);
                await input.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
                expect(await input.inputValue()).toStrictEqual(literal);
                expect(await currentText()).toStrictEqual(baseline);
                await input.fill('   ');
                await editor.getByRole('alert').filter({
                  hasText: i18n.t('assessments.textEditor.invalid'),
                }).waitFor();
                expect(await input.getAttribute('aria-invalid')).toStrictEqual('true');
                if (!(await save.isDisabled())) {
                  expect.unreachable('Expected await save.isDisabled()');
                }
                await input.fill(literal);
                await Promise.all([
                  page.waitForResponse((response) =>
                    response.url().endsWith(`/api/assessments/${assessment.id}/arrange`) &&
                    response.request().method() === 'POST'
                  ),
                  save.click(),
                ]);
                await editor.getByRole('status').filter({
                  hasText: i18n.t('assessments.textEditor.saved'),
                }).waitFor();
                expect(await currentText()).toStrictEqual(literal);
                expect(await input.inputValue()).toStrictEqual(literal);
                for (const width of [390, 1280]) {
                  await page.setViewportSize({ width, height: 844 });
                  const bounds = await editor.boundingBox();
                  if (!(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width)) {
                    expect.unreachable(
                      'Expected bounds && bounds.x >= 0 && bounds.x + bounds.width <= width',
                    );
                  }
                  if (
                    !(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
                  ) {
                    expect.unreachable(
                      'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
                    );
                  }
                  if (locale === 'en-US') {
                    await editor.scrollIntoViewIfNeeded();
                    await page.screenshot({
                      path: evidence.path(`text-edit-${theme}-${width}.png`),
                      fullPage: false,
                    });
                  }
                }
                await page.addScriptTag({ content: axe.source });
                const audit: unknown = await page.evaluate(
                  'globalThis.axe.run("main article").then(result => result.violations.map(violation => ({id: violation.id, nodes: violation.nodes.map(node => ({html: node.html, reason: node.failureSummary}))})))',
                );
                if (Array.isArray(audit) && audit.length) {
                  await _fs.writeFile(
                    evidence.path(`text-edit-${locale}-${theme}-a11y.json`),
                    JSON.stringify(audit, null, 2),
                    'utf8',
                  );
                }
                expect(audit).toStrictEqual([]);
                await editor.getByRole('button', {
                  name: i18n.t('assessments.textEditor.done'),
                  exact: true,
                }).click();
                await editButton.waitFor();
                await page.waitForFunction(
                  (id) => document.activeElement?.id === id,
                  `edit-text-${text.id}`,
                );
                expect(
                  await page.getByRole('article').filter({ has: editButton }).locator('p')
                    .textContent(),
                ).toStrictEqual(literal);
                expect(
                  await page.getByRole('article').filter({ has: editButton }).locator('a,script')
                    .count(),
                ).toStrictEqual(0);
                await page.reload({ waitUntil: 'networkidle' });
                await editButton.click();
                expect(await input.inputValue()).toStrictEqual(literal);
                if (locale === 'en-US' && theme === 'wireframe') {
                  // The real server commits before its acknowledgement is held. Newer input is unsaved.
                  const committed = Promise.withResolvers<void>(),
                    release = Promise.withResolvers<void>();
                  await page.route(endpoint, async (route) => {
                    const response = await route.fetch();
                    expect(response.status()).toStrictEqual(200);
                    committed.resolve();
                    await release.promise;
                    await route.fulfill({ response });
                  });
                  await input.fill('First pending save');
                  await save.click();
                  await committed.promise;
                  await input.fill('   ');
                  release.resolve();
                  await editor.getByRole('alert').filter({
                    hasText: i18n.t('assessments.textEditor.invalid'),
                  }).waitFor();
                  expect(await input.inputValue()).toStrictEqual('   ');
                  expect(await input.getAttribute('aria-invalid')).toStrictEqual('true');
                  if (!(await save.isDisabled())) {
                    expect.unreachable('Expected await save.isDisabled()');
                  }
                  await input.fill('Newer local text');
                  expect(await input.inputValue()).toStrictEqual('Newer local text');
                  expect(await currentText()).toStrictEqual('First pending save');
                  expect(await editor.getByRole('status').textContent()).toStrictEqual(
                    i18n.t('editor.unsavedChanges'),
                  );
                  await page.unroute(endpoint);
                  // Lost acknowledgement: retry exactly the committed command, retain newer input.
                  const writes: string[] = [];
                  let loseResponse = true;
                  await page.route(endpoint, async (route) => {
                    writes.push(route.request().postData() ?? '');
                    const response = await route.fetch();
                    expect(response.status()).toStrictEqual(200);
                    if (loseResponse) {
                      loseResponse = false;
                      await route.fulfill({
                        status: 503,
                        contentType: 'application/json',
                        body: '{"ok":false}',
                      });
                    } else await route.fulfill({ response });
                  });
                  await save.click();
                  await editor.getByRole('alert').filter({
                    hasText: i18n.t('assessments.textEditor.uncertain'),
                  }).waitFor();
                  expect(await currentText()).toStrictEqual('Newer local text');
                  await input.fill('Newest retained draft');
                  if (
                    !(await editor.getByRole('button', {
                      name: i18n.t('editor.cancel'),
                      exact: true,
                    })
                      .isDisabled())
                  ) {
                    expect.unreachable(
                      "Expected await editor.getByRole('button', { name: i18n.t('editor.cancel'), exact: true }) .isDisabl",
                    );
                  }
                  await question.click();
                  expect(await guard.count()).toStrictEqual(0);
                  expect(await input.inputValue()).toStrictEqual('Newest retained draft');
                  await editor.getByRole('button', {
                    name: i18n.t('assessments.textEditor.retry'),
                    exact: true,
                  }).click();
                  await page.waitForFunction(() =>
                    !document.querySelector('textarea[name=text]')?.closest('form')?.querySelector(
                      'button[type=submit]',
                    )?.hasAttribute('disabled')
                  );
                  expect(writes.length).toStrictEqual(2);
                  expect(writes[0]).toStrictEqual(writes[1]);
                  expect(await input.inputValue()).toStrictEqual('Newest retained draft');
                  expect(await currentText()).toStrictEqual('Newer local text');
                  expect(await editor.getByRole('status').textContent()).toStrictEqual(
                    i18n.t('editor.unsavedChanges'),
                  );
                  await page.unroute(endpoint);
                  // Definitive rejection does not mark the field itself invalid or discard edits.
                  await page.route(
                    endpoint,
                    (route) =>
                      route.fulfill({
                        status: 403,
                        contentType: 'application/json',
                        body: '{"ok":false}',
                      }),
                  );
                  await save.click();
                  await editor.getByRole('alert').filter({
                    hasText: i18n.t('assessments.textEditor.rejected'),
                  }).waitFor();
                  expect(await input.getAttribute('aria-invalid')).toStrictEqual(null);
                  expect(await input.inputValue()).toStrictEqual('Newest retained draft');
                  expect(await currentText()).toStrictEqual('Newer local text');
                  await page.unroute(endpoint);
                  // A real competing edit yields a conflict; guarded reload discards only explicitly.
                  const remote = await getAssessment(ctx, assessment.id);
                  if (!remote) expect.unreachable('Expected remote');
                  await saveAssessmentArrangementFixture(
                    ctx,
                    assessment.id,
                    remote.parts.map((part) => ({
                      ...part,
                      placements: part.placements.map((placement) =>
                        placement.id === text.id
                          ? {
                            ...text,
                            content: { kind: 'text' as const, text: 'Remote saved instructions' },
                          }
                          : placement
                      ),
                    })),
                  );
                  await save.click();
                  await editor.getByRole('alert').filter({
                    hasText: i18n.t('assessments.textEditor.conflict'),
                  }).waitFor();
                  expect(await input.inputValue()).toStrictEqual('Newest retained draft');
                  await editor.getByRole('button', {
                    name: i18n.t('assessments.textEditor.reload'),
                    exact: true,
                  }).click();
                  await guard.getByRole('button', {
                    name: i18n.t('assessments.builder.cancelDraftSwitch'),
                    exact: true,
                  }).click();
                  expect(await input.inputValue()).toStrictEqual('Newest retained draft');
                  await editor.getByRole('button', {
                    name: i18n.t('assessments.textEditor.reload'),
                    exact: true,
                  }).click();
                  await Promise.all([
                    page.waitForEvent('load'),
                    guard.getByRole('button', {
                      name: i18n.t('assessments.builder.discardDraft'),
                      exact: true,
                    }).click(),
                  ]);
                  await page.waitForLoadState('networkidle');
                  expect(dialogs).toStrictEqual([]);
                  await editButton.click();
                  expect(await input.inputValue()).toStrictEqual('Remote saved instructions');
                  // Save-and-continue uses the same text save and opens the real question editor.
                  await input.fill('Saved before opening the question');
                  await question.click();
                  await guard.getByRole('button', {
                    name: i18n.t('assessments.builder.saveAndContinue'),
                    exact: true,
                  }).click();
                  await input.waitFor({ state: 'detached' });
                  expect(await currentText()).toStrictEqual('Saved before opening the question');
                  const answer = page.getByRole('textbox', {
                    name: i18n.t('driver.choicePlaceholder', { id: 'A' }),
                    exact: true,
                  });
                  await answer.waitFor();
                  await answer.fill('Question draft retained');
                  await answer.press('End');
                  await page.keyboard.type('!');
                  await editButton.click();
                  await page.getByRole('dialog', {
                    name: i18n.t('assessments.builder.keepDraftTitle'),
                    exact: true,
                  }).getByRole('button', {
                    name: i18n.t('assessments.builder.cancelDraftSwitch'),
                    exact: true,
                  }).click();
                  expect(await answer.inputValue()).toStrictEqual('Question draft retained!');
                  await answer.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
                  expect(await answer.inputValue()).toStrictEqual('Question draft retained');
                  await editButton.click();
                  await page.getByRole('dialog', {
                    name: i18n.t('assessments.builder.keepDraftTitle'),
                    exact: true,
                  }).getByRole('button', {
                    name: i18n.t('assessments.builder.discardDraft'),
                    exact: true,
                  }).click();
                  expect(await input.inputValue()).toStrictEqual(
                    'Saved before opening the question',
                  );
                }
                await editor.getByRole('button', {
                  name: i18n.t('assessments.textEditor.done'),
                  exact: true,
                }).click();
                await editButton.waitFor();
                expect(await page.locator('main').last().innerText()).toContain(
                  i18n.t('assessments.builder.questionCount', { count: 2 }),
                );
                expect(errors).toStrictEqual([]);
                expect(dialogs).toStrictEqual([]);
              } catch (cause: unknown) {
                await captureBrowserFailure(page, evidence, `text-edit-${locale}-${theme}`);
                throw cause;
              } finally {
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

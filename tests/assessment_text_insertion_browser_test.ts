import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';
import { buildAssessmentPackage } from '../lib/export/assessment_package.ts';
import { strictAssessmentExportRequirements } from '../lib/export/assessment_export_requirements.ts';
import { sha256Hex } from '../lib/sha256.ts';

import axe from 'axe-core';
import { db, shutdownDb } from '../lib/db.ts';
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
import { AssessmentQuestionOrderPreviews } from '../lib/services/assessment_question_order_preview.ts';
import { assessmentArrangementVersion } from '../lib/assessment_arrangement_version.ts';

testCase(
  'persistent Add text inserts between real questions by keyboard and survives saved shared preview in all locales and themes',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Text insertion acceptance' });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          for (const title of ['First real question', 'Second real question']) {
            if (
              !((await saveAssessmentQuestion(ctx, assessment.id, {
                _tag: 'Create',
                partId: initial.parts[0].id,
                draft: {
                  type: 'single_select',
                  title,
                  itemLanguage: newAuthoringItemLanguage(),
                  bodyHtml: '<p>Choose a city.</p>',
                  choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
                  correctId: 'A',
                  maximumScore: 1,
                },
              })).ok)
            ) {
              expect.unreachable(
                "Expected (await saveAssessmentQuestion(ctx, assessment.id, { _tag: 'Create', partId: initial.parts[",
              );
            }
          }
          const original = await getAssessment(ctx, assessment.id);
          if (!original) expect.unreachable('Expected original');
          const [first, second] = assessmentQuestionPlacements(original.parts[0].placements);
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5520, lastExclusive: 5530 },
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
              await saveAssessmentArrangementFixture(ctx, assessment.id, original.parts);
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
              const errors: string[] = [];
              page.on('pageerror', (cause) => errors.push(safeErrorSummary(cause)));
              page.on('dialog', (dialog) => dialog.dismiss());
              const tool = page.getByRole('button', {
                name: i18n.t('assessments.builder.addTextBlock'),
                exact: true,
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
              try {
                await page.goto(`${app.baseUrl}/assessments/${assessment.id}`, {
                  waitUntil: 'networkidle',
                });
                await page.getByRole('button', {
                  name: i18n.t('assessments.builder.editQuestion', {
                    number: '1.1',
                    title: 'First real question',
                  }),
                  exact: true,
                }).click();
                await page.locator(`[data-authoring-card="${first.itemId}"]`).waitFor();
                await page.getByRole('button', { name: i18n.t('editor.save'), exact: true })
                  .waitFor();
                await tool.focus();
                await tool.press('Enter');
                await input.waitFor();
                await page.waitForFunction(() =>
                  document.activeElement?.getAttribute('name') === 'text'
                );
                expect(await input.inputValue()).toStrictEqual('');
                if (!(await save.isDisabled())) {
                  expect.unreachable('Expected await save.isDisabled()');
                }
                expect(
                  await editor.getByRole('button', {
                    name: i18n.t('assessments.textEditor.duplicate'),
                    exact: true,
                  }).count(),
                ).toStrictEqual(0);
                expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(
                  original.parts,
                );
                let text = `${locale}/${theme}: Read <script> literally.\nConsider α & β.`;
                await input.fill(text);
                await input.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
                await page.keyboard.type('!');
                await input.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
                expect(await input.inputValue()).toStrictEqual(text);
                await input.press('Tab');
                expect(await save.evaluate((node) => node === document.activeElement))
                  .toStrictEqual(true);
                if (locale === 'en-US' && theme === 'wireframe') {
                  // The first create reaches the server, but its response is lost while
                  // the author keeps typing. Retry must confirm the same identity and
                  // retain the newer input before its separate save.
                  const committed = Promise.withResolvers<void>();
                  const gate = Promise.withResolvers<void>();
                  const commands: string[] = [];
                  let requests = 0;
                  const endpoint = `**/api/assessments/${assessment.id}/arrange`;
                  await page.route(endpoint, async (route) => {
                    commands.push(route.request().postData() ?? '');
                    if (requests++ === 0) {
                      const response = await route.fetch();
                      expect(response.status()).toStrictEqual(200);
                      committed.resolve();
                      await gate.promise;
                      await route.abort('failed');
                    } else await route.continue();
                  });
                  await save.press('Enter');
                  await committed.promise;
                  text += '\nNewer input while saving.';
                  await input.fill(text);
                  gate.resolve();
                  await editor.getByRole('alert').filter({
                    hasText: i18n.t('assessments.textEditor.uncertain'),
                  }).waitFor();
                  await editor.getByRole('button', {
                    name: i18n.t('assessments.textEditor.retry'),
                    exact: true,
                  }).click();
                  await page.waitForFunction(
                    (expected) =>
                      document.querySelector<HTMLTextAreaElement>('textarea[name=text]')?.value ===
                        expected &&
                      document.querySelector('textarea[name=text]')?.closest('article')
                        ?.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled ===
                        false,
                    text,
                  );
                  expect(commands[0]).toStrictEqual(commands[1]);
                  expect(await input.inputValue()).toStrictEqual(text);
                  expect(await editor.count()).toStrictEqual(1);
                  await page.unroute(endpoint);
                }
                await Promise.all([
                  page.waitForResponse((response) =>
                    response.url().endsWith(`/api/assessments/${assessment.id}/arrange`) &&
                    response.request().method() === 'POST' && response.status() === 200
                  ),
                  save.press('Enter'),
                ]);
                await editor.getByRole('status').filter({
                  hasText: i18n.t('assessments.textEditor.ready'),
                }).waitFor();
                const saved = await getAssessment(ctx, assessment.id);
                if (!saved) expect.unreachable('Expected saved');
                expect(saved.targetCount).toStrictEqual(2);
                expect(assessmentQuestionPlacements(saved.parts[0].placements)).toStrictEqual([
                  first,
                  second,
                ]);
                expect(saved.parts[0].placements.length).toStrictEqual(3);
                const content = saved.parts[0].placements[1];
                if (!('content' in content)) expect.unreachable("Expected 'content' in content");
                expect(content.content).toStrictEqual({ kind: 'text', text });
                const handoffPath = process.env['QFLOW_CONTENT_TEST_PACKAGE'];
                if (handoffPath && locale === 'en-US' && theme === 'wireframe') {
                  if (!(handoffPath.startsWith('/private/tmp/'))) {
                    expect.unreachable(
                      'The handoff artifact must stay in the explicit temporary QA directory.',
                    );
                  }
                  const exported = await buildAssessmentPackage({
                    assessment: saved,
                    auth: ctx,
                    targetId: 'qti3-conformant',
                    requirements: strictAssessmentExportRequirements(),
                    readUploadBytes: () => {
                      throw new Error('This text handoff cannot require uploads.');
                    },
                  });
                  if (!(exported.ok)) expect.unreachable('Expected exported.ok');
                  await _fs.writeFile(handoffPath, exported.artifact.bytes);
                  await _fs.writeFile(
                    `${handoffPath}.json`,
                    JSON.stringify(
                      { sha256: await sha256Hex(exported.artifact.bytes), text },
                      null,
                      2,
                    ),
                    'utf8',
                  );
                }

                for (const width of [390, 1280]) {
                  await page.setViewportSize({ width, height: 844 });
                  if (
                    !(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
                  ) {
                    expect.unreachable(
                      'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
                    );
                  }
                  if (locale === 'en-US') {
                    await page.screenshot({
                      path: evidence.path(`text-insert-${theme}-${width}.png`),
                      fullPage: false,
                    });
                  }
                }
                await page.reload({ waitUntil: 'networkidle' });
                const block = page.getByRole('article').filter({ hasText: text });
                expect(await block.count()).toStrictEqual(1);
                expect(await page.locator('script').filter({ hasText: 'literally' }).count())
                  .toStrictEqual(0);
                const version = await assessmentArrangementVersion(assessment.id, saved.parts);
                const preview = await new AssessmentQuestionOrderPreviews(db).preview(
                  ctx,
                  assessment.id,
                  version,
                  { seed: 1 },
                );
                if (!(preview.ok)) expect.unreachable('Expected preview.ok');
                expect(preview.value.parts[0].questions.length).toStrictEqual(2);
                expect(preview.value.parts[0].instructions).toStrictEqual([{
                  placementId: content.id,
                  beforeQuestionNumber: 2,
                  content: { kind: 'text', text },
                }]);
                const settings = page.getByRole('button', {
                  name: new RegExp(`^${i18n.t('assessments.settings.title')}`),
                });
                await settings.click();
                const rail = page.getByRole('complementary', {
                  name: i18n.t('assessments.settings.title'),
                  exact: true,
                });
                await rail.getByRole('button').filter({
                  hasText: i18n.t('assessments.orderPreview.title'),
                }).click();
                await rail.getByRole('button', {
                  name: i18n.t('assessments.orderPreview.show'),
                  exact: true,
                }).click();
                const example = rail.getByRole('region', {
                  name: i18n.t('assessments.orderPreview.example'),
                  exact: true,
                });
                await example.waitFor();
                expect(await example.locator('li').count()).toStrictEqual(2);
                expect(await example.getByText(text, { exact: true }).count()).toStrictEqual(1);
                const flow = await example.locator('ol, article').evaluateAll((nodes) =>
                  nodes.map((node) => node.textContent)
                );
                if (!(flow[0]?.includes('First real question'))) {
                  expect.unreachable("Expected flow[0]?.includes('First real question')");
                }
                if (!(flow[1]?.includes(text))) {
                  expect.unreachable('Expected flow[1]?.includes(text)');
                }
                if (!(flow[2]?.includes('Second real question'))) {
                  expect.unreachable("Expected flow[2]?.includes('Second real question')");
                }
                await page.addScriptTag({ content: axe.source });
                const audit: unknown = await page.evaluate(
                  'globalThis.axe.run("main article, [data-authoring-tools]").then(result => result.violations.map(violation => ({id: violation.id, nodes: violation.nodes.map(node => ({html: node.html, reason: node.failureSummary}))})))',
                );
                if (Array.isArray(audit) && audit.length) {
                  await _fs.writeFile(
                    evidence.path(`text-insert-${locale}-${theme}-a11y.json`),
                    JSON.stringify(audit, null, 2),
                    'utf8',
                  );
                }
                expect(audit).toStrictEqual([]);
                expect(errors).toStrictEqual([]);
                expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(saved.parts);
              } catch (cause: unknown) {
                console.log(JSON.stringify({ browserErrors: errors }));
                await captureBrowserFailure(page, evidence, `text-insert-${locale}-${theme}`);
                throw cause;
              } finally {
                await context.close();
              }
            }
          }
        } finally {
          await deleteAssessment(ctx, assessment.id);
        }
      });
    } finally {
      await app?.close();
      await shutdownDb();
    }
  },
);

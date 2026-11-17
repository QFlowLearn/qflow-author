import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';

import { eq } from 'drizzle-orm';
import axe from 'axe-core';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions } from '../lib/db/auth_schema.ts';
import { questions } from '../lib/db/question_schema.ts';
import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';
import { parseAssessmentArrangeRequest } from '../lib/assessment_arrangement.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';

testCase(
  'text duplication and removal preserve drafts, mixed order and exact lost-response retries',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Text actions acceptance' });
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
                maximumScore: 3.125,
                choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin', fixed: true }],
                correctId: 'A',
              },
            });
            if (!(created.ok)) expect.unreachable('Expected created.ok');
          }
          const saved = await getAssessment(ctx, assessment.id);
          if (!saved) expect.unreachable('Expected saved');
          const [first, second] = assessmentQuestionPlacements(saved.parts[0].placements);
          const partId = saved.parts[0].id;
          const originalRevisions = await Promise.all([
            getQuestionRevision(ctx, first.itemId, 1),
            getQuestionRevision(ctx, second.itemId, 1),
          ]);
          const originalQuestions = await db.select({ id: questions.id }).from(questions)
            .where(eq(questions.tenantId, ctx.tenantId)).orderBy(questions.id);
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5490, lastExclusive: 5500 },
              environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
            },
            headless: true,
          });
          const completed: string[] = [];
          for (const locale of INTERFACE_LOCALES) {
            const i18n = createI18n(locale, catalogForLocale(locale));
            for (const theme of ['wireframe', 'dark'] as const) {
              const label = `${locale}-${theme}`;
              const literal =
                `  ${label}: <script>alert("unsafe")</script> & α\nhttps://example.com  `;
              const text = {
                id: crypto.randomUUID(),
                content: { kind: 'text' as const, text: literal },
                fixed: true as const,
              };
              await saveAssessmentArrangementFixture(ctx, assessment.id, [{
                ...saved.parts[0],
                options: { shuffleQuestions: false, navigationMode: 'nonlinear' },
                placements: [first, text, second],
              }]);
              const original = await getAssessment(ctx, assessment.id);
              if (!original) expect.unreachable('Expected original');
              await saveUserSettings(ctx.userId, { ...createInitialUserSettings(locale), theme });
              const context: import('playwright').BrowserContext = await app.newContext({
                authSession: await createSession(ctx),
                browser: { viewport: { width: theme === 'dark' ? 390 : 1280, height: 844 } },
              });
              await context.addInitScript(
                (selected) => localStorage.setItem('qflow-theme', selected),
                theme,
              );
              const page: import('playwright').Page = await context.newPage();
              page.setDefaultTimeout(20000);
              const errors: string[] = [], confirmations: string[] = [];
              let acceptRemoval = false;
              page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
              page.on('dialog', async (dialog) => {
                expect(dialog.type()).toStrictEqual('confirm');
                confirmations.push(dialog.message());
                if (acceptRemoval) await dialog.accept();
                else await dialog.dismiss();
              });
              const editor = page.getByRole('article').filter({
                has: page.locator('textarea[name=text]'),
              });
              const input = editor.getByRole('textbox', {
                name: i18n.t('assessments.textEditor.label'),
                exact: true,
              });
              const button = (key: 'duplicate' | 'remove' | 'retry' | 'save' | 'done' | 'reload') =>
                editor.getByRole('button', {
                  name: i18n.t(`assessments.textEditor.${key}`),
                  exact: true,
                });
              const guard = page.getByRole('dialog', {
                name: i18n.t('assessments.textEditor.keepDraftTitle'),
                exact: true,
              });
              const resolveDraft = (
                key: 'cancelDraftSwitch' | 'discardDraft' | 'saveAndContinue',
              ) =>
                guard.getByRole('button', {
                  name: i18n.t(`assessments.builder.${key}`),
                  exact: true,
                }).click();
              const endpoint = `**/api/assessments/${assessment.id}/arrange`;
              const current = async () => {
                const value = await getAssessment(ctx, assessment.id);
                if (!value) expect.unreachable('Expected value');
                expect(value.parts[0].options).toStrictEqual(original.parts[0].options);
                expect(value.targetCount).toStrictEqual(original.targetCount);
                expect(assessmentQuestionPlacements(value.parts[0].placements)).toStrictEqual([
                  first,
                  second,
                ]);
                return value.parts[0].placements;
              };
              try {
                await page.goto(`${app.baseUrl}/assessments/${assessment.id}`, {
                  waitUntil: 'networkidle',
                });
                await page.locator(`#edit-text-${text.id}`).click();
                await input.waitFor();
                await input.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
                await page.keyboard.type('!');
                await button('duplicate').click();
                await resolveDraft('cancelDraftSwitch');
                expect(await input.inputValue()).toStrictEqual(`${literal}!`);
                await input.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
                expect(await input.inputValue()).toStrictEqual(literal);
                expect(await current()).toStrictEqual([first, text, second]);
                await input.fill('Discarded draft');
                await button('duplicate').focus();
                await button('duplicate').press('Enter');
                await resolveDraft('discardDraft');
                await page.locator(`#edit-text-${text.id}`).waitFor();
                await page.waitForFunction(
                  (value) =>
                    document.querySelector<HTMLTextAreaElement>('textarea[name=text]')?.value ===
                      value,
                  literal,
                );
                let placements = await current();
                expect(placements.length).toStrictEqual(4);
                const copy = placements[2];
                if (!('content' in copy && copy.id !== text.id)) {
                  expect.unreachable("Expected 'content' in copy && copy.id !== text.id");
                }
                expect(copy.content).toStrictEqual(text.content);
                expect(copy.fixed).toStrictEqual(true);
                expect(placements).toStrictEqual([first, text, copy, second]);
                await page.waitForFunction(() =>
                  document.activeElement?.matches('textarea[name=text]') === true
                );
                expect(await input.inputValue()).toStrictEqual(literal);
                const updated = `${literal}\nSaved independent copy`;
                await input.fill(updated);
                await button('duplicate').click();
                await resolveDraft('saveAndContinue');
                await page.waitForFunction(
                  (value) =>
                    document.querySelector<HTMLTextAreaElement>('textarea[name=text]')?.value ===
                      value && document.querySelectorAll('textarea[name=text]').length === 1,
                  updated,
                );
                // Wait for selection of the new copy, rather than an earlier save acknowledgement.
                await page.locator(`#edit-text-${copy.id}`).waitFor();
                placements = await current();
                const next = placements[3];
                if (!('content' in next && next.id !== copy.id)) {
                  expect.unreachable("Expected 'content' in next && next.id !== copy.id");
                }
                const editedCopy = { ...copy, content: { kind: 'text' as const, text: updated } };
                expect(next.content).toStrictEqual(editedCopy.content);
                expect(placements).toStrictEqual([first, text, editedCopy, next, second]);
                const writes: string[] = [];
                let loseResponse = true;
                await page.route(endpoint, async (route) => {
                  writes.push(route.request().postData() ?? '');
                  const response = await route.fetch();
                  expect(response.status()).toStrictEqual(200);
                  if (loseResponse) {
                    loseResponse = false;
                    await route.abort('failed');
                  } else await route.fulfill({ response });
                });
                await button('duplicate').click();
                await editor.getByRole('alert').filter({
                  hasText: i18n.t('assessments.textEditor.uncertain'),
                }).waitFor();
                if (!(await input.isDisabled())) {
                  expect.unreachable('Expected await input.isDisabled()');
                }
                if (!(await button('duplicate').isDisabled())) {
                  expect.unreachable("Expected await button('duplicate').isDisabled()");
                }
                if (!(await button('remove').isDisabled())) {
                  expect.unreachable("Expected await button('remove').isDisabled()");
                }
                await page.locator(`#edit-text-${text.id}`).click();
                expect(await input.inputValue()).toStrictEqual(updated);
                placements = await current();
                const recovered = placements[4];
                if (!('content' in recovered && recovered.id !== next.id)) {
                  expect.unreachable("Expected 'content' in recovered && recovered.id !== next.id");
                }
                expect(placements).toStrictEqual([
                  first,
                  text,
                  editedCopy,
                  next,
                  recovered,
                  second,
                ]);
                await button('retry').click();
                await page.locator(`#edit-text-${next.id}`).waitFor();
                expect(writes.length).toStrictEqual(2);
                expect(writes[0]).toStrictEqual(writes[1]);
                const command = parseAssessmentArrangeRequest(JSON.parse(writes[0]));
                if (!(command.ok)) expect.unreachable('Expected command.ok');
                expect(command.request.parts[0].placements.map((entry) => entry.id)).toStrictEqual(
                  placements.map((entry) => entry.id),
                );
                expect(await current()).toStrictEqual(placements);
                await page.unroute(endpoint);
                await page.reload({ waitUntil: 'networkidle' });
                await page.locator(`#edit-text-${recovered.id}`).click();
                expect(await input.inputValue()).toStrictEqual(updated);
                await button('remove').click();
                expect(confirmations).toStrictEqual([
                  i18n.t('assessments.textEditor.removeConfirm'),
                ]);
                expect(await current()).toStrictEqual(placements);
                // Native confirmation precedes the structural command and leaves the editor on Cancel.
                expect(await input.inputValue()).toStrictEqual(updated);
                await input.fill(`${updated}\nDo not discard`);
                await button('remove').click();
                await resolveDraft('cancelDraftSwitch');
                expect(confirmations.length).toStrictEqual(1);
                expect(await input.inputValue()).toStrictEqual(`${updated}\nDo not discard`);
                await button('remove').click();
                acceptRemoval = true;
                const removals: string[] = [];
                let loseRemovalResponse = true;
                await page.route(endpoint, async (route) => {
                  removals.push(route.request().postData() ?? '');
                  const response = await route.fetch();
                  expect(response.status()).toStrictEqual(200);
                  if (loseRemovalResponse) {
                    loseRemovalResponse = false;
                    await route.abort('failed');
                  } else await route.fulfill({ response });
                });
                await resolveDraft('discardDraft');
                await editor.getByRole('alert').filter({
                  hasText: i18n.t('assessments.textEditor.uncertain'),
                }).waitFor();
                if (!(await input.isDisabled())) {
                  expect.unreachable('Expected await input.isDisabled()');
                }
                expect(await input.inputValue()).toStrictEqual(updated);
                expect(await current()).toStrictEqual([first, text, editedCopy, next, second]);
                await button('retry').click();
                await input.waitFor({ state: 'detached' });
                expect(removals.length).toStrictEqual(2);
                expect(removals[0]).toStrictEqual(removals[1]);
                expect(await current()).toStrictEqual([first, text, editedCopy, next, second]);
                await page.unroute(endpoint);
                await page.waitForFunction(
                  (id) => document.activeElement?.id === id,
                  `part-${partId}-heading`,
                );
                await page.reload({ waitUntil: 'networkidle' });
                expect(await page.locator(`#edit-text-${recovered.id}`).count()).toStrictEqual(0);
                const originalCard = page.getByRole('article').filter({
                  has: page.locator(`#edit-text-${text.id}`),
                });
                expect(await originalCard.locator('p').textContent()).toStrictEqual(literal);
                expect(await originalCard.locator('script,a').count()).toStrictEqual(0);
                await page.locator(`#edit-text-${text.id}`).click();
                if (locale === 'en-US' && theme === 'wireframe') {
                  // A definitive failure retains the block. A real stale base cannot overwrite a competing edit.
                  await page.route(
                    endpoint,
                    (route) =>
                      route.fulfill({
                        status: 403,
                        contentType: 'application/json',
                        body: '{"ok":false}',
                      }),
                  );
                  await button('remove').click();
                  await editor.getByRole('alert').filter({
                    hasText: i18n.t('assessments.textEditor.rejected'),
                  }).waitFor();
                  if (await input.isDisabled()) {
                    expect.unreachable('Expected !(await input.isDisabled())');
                  }
                  expect(await current()).toStrictEqual([first, text, editedCopy, next, second]);
                  await input.fill('Retained unsaved text');
                  await button('duplicate').click();
                  await resolveDraft('saveAndContinue');
                  await guard.getByRole('alert').filter({
                    hasText: i18n.t('assessments.textEditor.rejected'),
                  }).waitFor();
                  expect(await input.inputValue()).toStrictEqual('Retained unsaved text');
                  expect(await current()).toStrictEqual([first, text, editedCopy, next, second]);
                  await resolveDraft('cancelDraftSwitch');
                  await input.fill(literal);
                  await page.unroute(endpoint);
                  const remote = await getAssessment(ctx, assessment.id);
                  if (!remote) expect.unreachable('Expected remote');
                  const remoteText = {
                    ...text,
                    content: { kind: 'text' as const, text: 'Real competing text' },
                  };
                  await saveAssessmentArrangementFixture(
                    ctx,
                    assessment.id,
                    remote.parts.map((part) => ({
                      ...part,
                      placements: part.placements.map((entry) =>
                        entry.id === text.id ? remoteText : entry
                      ),
                    })),
                  );
                  await button('duplicate').click();
                  await editor.getByRole('alert').filter({
                    hasText: i18n.t('assessments.textEditor.conflict'),
                  }).waitFor();
                  expect(await current()).toStrictEqual([
                    first,
                    remoteText,
                    editedCopy,
                    next,
                    second,
                  ]);
                  expect(await input.inputValue()).toStrictEqual(literal);
                  await Promise.all([page.waitForEvent('load'), button('reload').click()]);
                  await page.waitForLoadState('networkidle');
                  await page.locator(`#edit-text-${text.id}`).click();
                  expect(await input.inputValue()).toStrictEqual('Real competing text');
                  await page.addScriptTag({ content: axe.source });
                  const audit: unknown = await page.evaluate(
                    'globalThis.axe.run("main article").then(result => result.violations.map(violation => ({id: violation.id, nodes: violation.nodes.map(node => ({html: node.html, reason: node.failureSummary}))})))',
                  );
                  await _fs.writeFile(
                    evidence.path('text-actions-a11y.json'),
                    JSON.stringify(audit, null, 2),
                    'utf8',
                  );
                  expect(audit).toStrictEqual([]);
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
                    await editor.scrollIntoViewIfNeeded();
                    await page.screenshot({
                      path: evidence.path(`text-actions-${theme}-${width}.png`),
                      fullPage: false,
                    });
                  }
                }
                expect(
                  await Promise.all([
                    getQuestionRevision(ctx, first.itemId, 1),
                    getQuestionRevision(ctx, second.itemId, 1),
                  ]),
                ).toStrictEqual(originalRevisions);
                expect(
                  await db.select({ id: questions.id }).from(questions).where(
                    eq(questions.tenantId, ctx.tenantId),
                  ).orderBy(questions.id),
                ).toStrictEqual(originalQuestions);
                expect(errors).toStrictEqual([]);
                expect(
                  confirmations.every((message) =>
                    message === i18n.t('assessments.textEditor.removeConfirm')
                  ),
                ).toStrictEqual(true);
                completed.push(label);
              } catch (cause: unknown) {
                await captureBrowserFailure(page, evidence, `text-actions-${label}`);
                throw cause;
              } finally {
                await context.close();
              }
            }
          }
          await _fs.writeFile(
            evidence.path('text-actions-cases.json'),
            JSON.stringify(completed, null, 2),
            'utf8',
          );
          expect(completed.length).toStrictEqual(10);
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

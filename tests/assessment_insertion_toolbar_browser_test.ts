import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions } from '../lib/db/schema.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { assertNativeFormAccessibility } from './helpers/browser_form_accessibility.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';

testCase(
  'real insertion toolbar stays reachable below the app header without moving or replacing drafts',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, {
          title: 'Persistent toolbar acceptance',
        });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(initial);
          for (const title of ['First toolbar question', 'Last toolbar question']) {
            const saved = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Create',
              partId: initial.parts[0].id,
              draft: {
                type: 'single_select',
                itemLanguage: newAuthoringItemLanguage(),
                title,
                bodyHtml: '<p>Choose Alpha.</p>',
                choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }],
                correctId: 'A',
              },
            });
            if (!(saved.ok)) expect.unreachable('Expected saved.ok');
          }
          let source = await getAssessment(ctx, assessment.id);
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5520, lastExclusive: 5530 },
              environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
            },
            headless: true,
          });
          for (const locale of INTERFACE_LOCALES) {
            await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
            const i18n = createI18n(locale, catalogForLocale(locale));
            for (const theme of ['wireframe', 'dark']) {
              const context: import('playwright').BrowserContext = await app.newContext({
                authSession: await createSession(ctx),
                browser: { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' },
              });
              const page: import('playwright').Page = await context.newPage();
              const errors: string[] = [];
              page.on('pageerror', (cause) => errors.push(safeErrorSummary(cause)));
              try {
                await page.goto(`${app.baseUrl}/assessments/${assessment.id}`);
                await page.getByRole('button', {
                  name: i18n.t('assessments.builder.editQuestion', {
                    number: '1.1',
                    title: 'First toolbar question',
                  }),
                  exact: true,
                }).click();
                await page.evaluate(
                  (value) => document.documentElement.setAttribute('data-theme', value),
                  theme,
                );
                const choice = page.getByPlaceholder(
                  i18n.t('driver.choicePlaceholder', { id: 'A' }),
                );
                await choice.fill('Keep this toolbar draft');
                let originalInput = await choice.elementHandle();
                if (!originalInput) expect.unreachable('Expected originalInput');
                const card = page.locator('[data-authoring-card]').filter({ has: choice });
                const tools = page.getByRole('group', {
                  name: i18n.t('assessments.builder.insertionTools'),
                  exact: true,
                });
                expect(await tools.getByRole('button').count()).toStrictEqual(6);
                for (
                  const [index, label] of [
                    i18n.t('assessments.builder.toolbarAdd'),
                    i18n.t('assessments.builder.fromLibrary'),
                    i18n.t('assessments.builder.addTextBlock'),
                    i18n.t('assessments.builder.addImageBlock'),
                    i18n.t('assessments.builder.addVideoBlock'),
                    i18n.t('assessments.builder.toolbarText'),
                  ].entries()
                ) {
                  expect(await tools.getByRole('button').nth(index).getAttribute('aria-label'))
                    .toStrictEqual(label);
                }
                const add = tools.getByRole('button', {
                  name: i18n.t('assessments.builder.toolbarAdd'),
                  exact: true,
                });
                if (locale === 'en-US' && theme === 'wireframe') {
                  await page.setViewportSize({ width: 1280, height: 844 });
                  const pickerChunk = '**/AssessmentAddDialog-*.js';
                  await page.route(pickerChunk, (route) => route.abort('failed'));
                  await add.click();
                  const loadFailure = page.locator('[data-floating-picker]').getByRole('alert');
                  await loadFailure.filter({ hasText: i18n.t('editor.controlsFailed') }).waitFor();
                  await page.unroute(pickerChunk);
                  await loadFailure.getByRole('button', {
                    name: i18n.t('assessments.builder.library.reload'),
                    exact: true,
                  }).click();
                  const guard = page.getByRole('dialog', {
                    name: i18n.t('assessments.builder.keepDraftTitle'),
                    exact: true,
                  });
                  await guard.waitFor();
                  await guard.getByRole('button', {
                    name: i18n.t('assessments.builder.cancelDraftSwitch'),
                    exact: true,
                  }).click();
                  expect(await choice.inputValue()).toStrictEqual('Keep this toolbar draft');
                  expect(await originalInput.evaluate((element) => element.isConnected))
                    .toStrictEqual(true);
                  await choice.fill('Saved toolbar recovery');
                  await loadFailure.getByRole('button', {
                    name: i18n.t('assessments.builder.library.reload'),
                    exact: true,
                  }).click();
                  await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle' }),
                    guard.getByRole('button', {
                      name: i18n.t('assessments.builder.saveAndContinue'),
                      exact: true,
                    }).click(),
                  ]);
                  await page.getByRole('button', {
                    name: i18n.t('assessments.builder.editQuestion', {
                      number: '1.1',
                      title: 'First toolbar question',
                    }),
                    exact: true,
                  }).click();
                  await choice.waitFor();
                  expect(await choice.inputValue()).toStrictEqual('Saved toolbar recovery');
                  source = await getAssessment(ctx, assessment.id);
                  originalInput = await choice.elementHandle();
                  if (!originalInput) expect.unreachable('Expected originalInput');
                  await choice.fill('Keep this toolbar draft');
                  // Subsequent toolbar checks own the reopened editor's native input.
                  await add.click();
                  const search = page.locator('[data-floating-picker] [data-focus-type-search]');
                  await search.waitFor();
                  await page.waitForFunction(() =>
                    document.activeElement?.hasAttribute('data-focus-type-search')
                  );
                  await search.press('Escape');
                  await page.locator('[data-floating-picker]').waitFor({ state: 'detached' });
                  expect(await choice.inputValue()).toStrictEqual('Keep this toolbar draft');
                }
                for (
                  const [width, height] of [[320, 844], [390, 844], [1024, 844], [1280, 844], [
                    1280,
                    320,
                  ]]
                ) {
                  await page.setViewportSize({ width, height });
                  await page.evaluate(() => scrollTo(0, 450));
                  await page.waitForFunction(() => scrollY > 100);
                  const header = await page.locator('body > header').boundingBox();
                  const bounds = await tools.boundingBox();
                  if (!(header && bounds)) expect.unreachable('Expected header && bounds');
                  if (!(bounds.y >= header.y + header.height)) {
                    expect.unreachable(
                      `${locale}/${theme}/${width}x${height}: sticky toolbar is covered by the application header`,
                    );
                  }
                  for (const button of await tools.getByRole('button').all()) {
                    expect(
                      await button.evaluate((element) => {
                        const rect = element.getBoundingClientRect();
                        const hit = document.elementFromPoint(
                          rect.x + rect.width / 2,
                          rect.y + rect.height / 2,
                        );
                        return element.contains(hit) ? 'reachable' : JSON.stringify({
                          label: element.getAttribute('aria-label'),
                          rect: rect.toJSON(),
                          hit: hit?.outerHTML.slice(0, 160),
                          height: getComputedStyle(element).height,
                          minimum: getComputedStyle(element).minHeight,
                        });
                      }),
                      `${locale}/${theme}/${width}x${height}: every insertion button must receive the pointer`,
                    ).toStrictEqual('reachable');
                  }
                  const beforeCard = await card.boundingBox();
                  const beforeScroll = await page.evaluate(() => scrollY);
                  const button = await add.boundingBox();
                  if (!button) expect.unreachable('Expected button');
                  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
                  const picker = page.getByRole('region', {
                    name: i18n.t('assessments.builder.insertQuestion'),
                    exact: true,
                  });
                  await picker.waitFor();
                  await picker.locator('[data-focus-type-search]').waitFor();
                  expect(await card.boundingBox()).toStrictEqual(beforeCard);
                  expect(await page.evaluate(() => scrollY)).toStrictEqual(beforeScroll);
                  expect(await choice.inputValue()).toStrictEqual('Keep this toolbar draft');
                  expect(await originalInput.evaluate((element) => element.isConnected))
                    .toStrictEqual(true);
                  const pickerBounds = await picker.boundingBox();
                  if (!(pickerBounds && pickerBounds.y >= header.y + header.height)) {
                    expect.unreachable(
                      'Expected pickerBounds && pickerBounds.y >= header.y + header.height',
                    );
                  }
                  for (const tool of await tools.getByRole('button').all()) {
                    expect(
                      await tool.evaluate((element) => {
                        const rect = element.getBoundingClientRect();
                        return element.contains(document.elementFromPoint(
                          rect.x + rect.width / 2,
                          rect.y + rect.height / 2,
                        ));
                      }),
                      'The open chooser must leave the persistent tools reachable',
                    ).toStrictEqual(true);
                  }
                  if (locale === 'en-US') {
                    await assertNativeFormAccessibility(page, tools);
                    await assertNativeFormAccessibility(page, picker);
                  }
                  await page.screenshot({
                    path: evidence.path(`toolbar-${locale}-${theme}-${width}x${height}.png`),
                  });
                  if (locale === 'en-US') {
                    const library = tools.getByRole('button', {
                      name: i18n.t('assessments.builder.fromLibrary'),
                      exact: true,
                    });
                    await library.click();
                    await picker.getByRole('textbox', {
                      name: i18n.t('assessments.builder.library.search'),
                      exact: true,
                    }).waitFor();
                    await picker.press('Escape');
                    await picker.waitFor({ state: 'detached' });
                    expect(
                      await library.evaluate((element) => element === document.activeElement),
                      'Switching insertion tools must retain the new opening trigger',
                    ).toStrictEqual(true);
                    await add.click();
                    await picker.locator('[data-focus-type-search]').waitFor();
                  }
                  await picker.press('Escape');
                  await picker.waitFor({ state: 'detached' });
                  expect(await add.evaluate((element) => element === document.activeElement))
                    .toStrictEqual(true);
                  expect(await choice.inputValue()).toStrictEqual('Keep this toolbar draft');
                }
                expect(errors).toStrictEqual([]);
                expect(await getAssessment(ctx, assessment.id)).toStrictEqual(source);
              } catch (cause: unknown) {
                await captureBrowserFailure(page, evidence, `toolbar-${locale}-${theme}`);
                throw cause;
              } finally {
                await context.close();
              }
            }
          }
        } finally {
          await app?.close();
          app = undefined;
          await db.delete(authSessions).where(eq(authSessions.tenantId, ctx.tenantId));
          await deleteAssessment(ctx, assessment.id);
        }
      });
    } finally {
      await app?.close();
      await shutdownDb();
    }
  },
);

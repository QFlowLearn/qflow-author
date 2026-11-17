import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';
import type { BrowserContext, Page } from 'playwright';

import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions } from '../lib/db/schema.ts';
import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { questionPointsInputText } from '../lib/question_points.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';

testCase(
  'real option Undo survives saved revisions and reopening in both editors, types, themes and five locales',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        app = await openLocalAppBrowser({
          endpoint: {
            _tag: 'ManagedLocalApp',
            portRange: { first: 5470, lastExclusive: 5480 },
            environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
          },
          headless: true,
        });
        const baseUrl = app.baseUrl;
        const completedCases: string[] = [];
        try {
          for (const locale of INTERFACE_LOCALES) {
            const i18n = createI18n(locale, catalogForLocale(locale));
            for (const theme of ['wireframe', 'dark'] as const) {
              for (const type of ['single_select', 'multi_select'] as const) {
                for (const rich of [false, true]) {
                  const label = `${locale}-${theme}-${type}-${rich ? 'rich' : 'plain'}`;
                  await saveUserSettings(ctx.userId, {
                    ...createInitialUserSettings(locale),
                    theme,
                    choiceRichText: rich,
                  });
                  const assessment = await createAssessmentDraft(ctx, { title: label });
                  let context: BrowserContext | undefined;
                  let page: Page | undefined;
                  try {
                    context = await app.newContext({
                      authSession: await createSession(ctx),
                      browser: { viewport: { width: rich ? 390 : 1280, height: 900 } },
                    });
                    await context.addInitScript(
                      (selected) => localStorage.setItem('qflow-theme', selected),
                      theme,
                    );
                    const casePage: import('playwright').Page = await context.newPage();
                    page = casePage;
                    casePage.setDefaultTimeout(20_000);
                    const errors: string[] = [];
                    casePage.on('pageerror', (cause) => errors.push(safeErrorSummary(cause)));
                    const initial = await getAssessment(ctx, assessment.id);
                    if (!initial) expect.unreachable('Expected initial');
                    const created = await saveAssessmentQuestion(ctx, assessment.id, {
                      _tag: 'Create',
                      partId: initial.parts[0].id,
                      draft: {
                        type,
                        title: 'Recover the answers',
                        itemLanguage: newAuthoringItemLanguage(),
                        bodyHtml: '<p>Choose the intended cities.</p>',
                        maximumScore: 2.5,
                        choices: [
                          { id: 'A', ...(rich ? { html: '<p>Paris</p>' } : { text: 'Paris' }) },
                          {
                            id: 'B',
                            ...(rich
                              ? { html: '<p><strong>Berlin</strong></p>' }
                              : { text: 'Berlin' }),
                            label: 'City',
                            fixed: true,
                          },
                          { id: 'C', ...(rich ? { html: '<p>Lima</p>' } : { text: 'Lima' }) },
                        ],
                        ...(type === 'single_select'
                          ? { correctId: 'B' }
                          : { correctIds: ['A', 'B'], responseMode: 'partial' }),
                      },
                    });
                    if (!(created.ok)) expect.unreachable('Expected created.ok');
                    const originalRevision = await getQuestionRevision(
                      ctx,
                      created.value.itemId,
                      1,
                    );
                    if (!originalRevision) expect.unreachable('Expected originalRevision');
                    const original = parsePersistedDraft(originalRevision.body, type);
                    const url = `${baseUrl}/assessments/${assessment.id}`;
                    const open = async () => {
                      await casePage.goto(url);
                      await casePage.getByRole('button', {
                        name: i18n.t('assessments.builder.editQuestion', {
                          number: '1.1',
                          title: original.title,
                        }),
                        exact: true,
                      }).click();
                      await casePage.locator('[data-choice-id="B"]').waitFor();
                    };
                    await open();
                    const remove = (label: string) =>
                      casePage.getByRole('button', {
                        name: i18n.t('driver.removeChoiceLabel', { label }),
                        exact: true,
                      });
                    const undo = casePage.getByRole('button', {
                      name: i18n.t('driver.undoChoiceRemoval'),
                      exact: true,
                    });
                    const rows = casePage.locator('[data-choice-id]');
                    const expectCount = async (count: number) => {
                      await casePage.waitForFunction(
                        (count) => document.querySelectorAll('[data-choice-id]').length === count,
                        count,
                      );
                    };
                    await remove('City').click();
                    await expectCount(2);
                    const controls = casePage.locator(
                      type === 'single_select'
                        ? '[data-choice-id] input[type=radio]'
                        : '[data-choice-id] input[type=checkbox]',
                    );
                    expect(
                      await controls.evaluateAll((inputs) =>
                        inputs.filter((input) => input instanceof HTMLInputElement && input.checked)
                          .length
                      ),
                    ).toStrictEqual(type === 'single_select' ? 0 : 1);
                    await casePage.keyboard.press(`${modifier}+z`);
                    await expectCount(3);
                    expect(await casePage.locator('[data-choice-id="B"] input').first().isChecked())
                      .toStrictEqual(true);
                    await casePage.keyboard.press(`${modifier}+Shift+z`);
                    await expectCount(2);
                    await undo.click();
                    await expectCount(3);
                    await remove('City').click();
                    await remove('C').click();
                    await expectCount(1);
                    await undo.click();
                    await expectCount(2);
                    await undo.click();
                    await expectCount(3);
                    expect(
                      await rows.evaluateAll((elements) =>
                        elements.map((element) => element.getAttribute('data-choice-id'))
                      ),
                    ).toStrictEqual(['A', 'B', 'C']);
                    const points = casePage.locator('[data-editor-field="maximumScore"] input');
                    await points.fill(questionPointsInputText(3.125, locale));
                    await points.press('Tab');
                    await casePage.getByRole('button', {
                      name: i18n.t('assessments.builder.questionSettings'),
                      exact: true,
                    }).click();
                    const [response] = await Promise.all([
                      casePage.waitForResponse((response) =>
                        response.url() ===
                          `${baseUrl}/api/assessments/${assessment.id}/questions` &&
                        response.request().method() === 'POST'
                      ),
                      casePage.getByRole('button', {
                        name: i18n.t('assessments.builder.saveQuestion'),
                        exact: true,
                      }).click(),
                    ]);
                    expect(response.status()).toStrictEqual(201);
                    await casePage.getByText(i18n.t('editor.itemSaved'), { exact: true }).waitFor();
                    const saved = await getAssessment(ctx, assessment.id);
                    if (!saved) expect.unreachable('Expected saved');
                    const [placement] = assessmentQuestionPlacements(saved.parts[0].placements);
                    expect(saved.targetCount).toStrictEqual(1);
                    expect(placement.id).toStrictEqual(created.value.placementId);
                    expect(placement.itemId).toStrictEqual(created.value.itemId);
                    expect(placement.snapshotRev).toStrictEqual(2);
                    const revision = await getQuestionRevision(ctx, placement.itemId, 2);
                    if (!revision) expect.unreachable('Expected revision');
                    const restored = parsePersistedDraft(revision.body, type);
                    expect(restored.choices).toStrictEqual(original.choices);
                    expect(restored.correctId).toStrictEqual(original.correctId);
                    expect(restored.correctIds).toStrictEqual(original.correctIds);
                    expect(restored.maximumScore).toStrictEqual(3.125);
                    const responseCases: readonly (readonly [string | string[], number])[] =
                      type === 'single_select'
                        ? [['B', 3.125], ['C', 0]]
                        : [[['A', 'B'], 3.125], [['A'], 1.5625], [['C'], 0]];
                    for (const [response, expected] of responseCases) {
                      const scored = scoreQtiItemServerSide({
                        itemXml: revision.qtiXml,
                        trustedResponses: { RESPONSE: response },
                      });
                      if (!(scored.ok)) expect.unreachable('Expected scored.ok');
                      expect(scored.score).toStrictEqual(expected);
                    }
                    const roundtrip = parseItemXml(revision.qtiXml).draft;
                    expect(roundtrip.correctId).toStrictEqual(restored.correctId);
                    expect(roundtrip.correctIds).toStrictEqual(restored.correctIds);
                    expect(roundtrip.maximumScore).toStrictEqual(restored.maximumScore);
                    expect(roundtrip.choices?.map((choice) => choice.id)).toStrictEqual([
                      'A',
                      'B',
                      'C',
                    ]);
                    expect(roundtrip.choices?.find((choice) => choice.id === 'B')?.fixed)
                      .toStrictEqual(true);
                    await open();
                    await expectCount(3);
                    expect(await casePage.locator('[data-choice-id="B"] input').first().isChecked())
                      .toStrictEqual(true);
                    expect(await undo.count()).toStrictEqual(0);
                    if (
                      !(await casePage.evaluate(() =>
                        document.documentElement.scrollWidth <= innerWidth
                      ))
                    ) {
                      expect.unreachable(
                        'Expected await casePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth )',
                      );
                    }
                    if (locale === 'en-US' && type === 'multi_select') {
                      await casePage.screenshot({
                        path: evidence.path(`${label}.png`),
                        fullPage: true,
                      });
                    }
                    expect(errors).toStrictEqual([]);
                    completedCases.push(label);
                  } catch (cause: unknown) {
                    if (page) await captureBrowserFailure(page, evidence, label);
                    throw cause;
                  } finally {
                    try {
                      await context?.close();
                    } finally {
                      await deleteAssessment(ctx, assessment.id);
                    }
                  }
                }
              }
            }
          }
          expect(completedCases.length).toStrictEqual(40);
          await _fs.writeFile(
            evidence.path('undo-persistence-receipt.json'),
            JSON.stringify(
              { cases: completedCases, maximum: 3.125, restoredChoiceIds: ['A', 'B', 'C'] },
              null,
              2,
            ),
            'utf8',
          );
        } finally {
          await app.close();
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

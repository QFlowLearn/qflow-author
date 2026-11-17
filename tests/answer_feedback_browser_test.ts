import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';

import { Buffer } from 'node:buffer';
import axe from 'axe-core';
import { shutdownDb } from '../lib/db.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { buildAssessmentPackage } from '../lib/export/assessment_package.ts';
import { strictAssessmentExportRequirements } from '../lib/export/assessment_export_requirements.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { sha256Hex } from '../lib/sha256.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { bindContentUploadStorage } from './helpers/content_upload_browser_runtime.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';

testCase(
  'answer feedback authors, saves, reopens and previews safe links/media in five locales and both themes',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const evidence = await createBrowserEvidenceDirectory(), storage = createMemoryObjectStorage();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, {
          title: 'Answer feedback acceptance',
        });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          const created = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId: initial.parts[0].id,
            draft: {
              type: 'single_select',
              title: 'Feedback question',
              itemLanguage: newAuthoringItemLanguage(),
              bodyHtml: '<p>Choose Alpha.</p>',
              promptHtml: '',
              choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }],
              correctId: 'A',
              maximumScore: 0,
            },
          });
          if (!(created.ok)) expect.unreachable('Expected created.ok');
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5600, lastExclusive: 5610 },
              environment: {
                ...builtWorkerBrowserEnvironment,
                DATABASE_URL: requireQaDatabaseUrl(process.env['DATABASE_URL']),
                QFLOW_DELIVERY_PUBLISH_URL: '',
                QFLOW_DELIVERY_SIGNING_SECRET: '',
                QFLOW_DELIVERY_CAPABILITY_URL: '',
                QFLOW_DELIVERY_STATE_URL: '',
              },
            },
            headless: true,
          });
          for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
            for (const theme of ['wireframe', 'dark'] as const) {
              const i18n = createI18n(locale, catalogForLocale(locale));
              await saveUserSettings(ctx.userId, { ...createInitialUserSettings(locale), theme });
              const context: import('playwright').BrowserContext = await app.newContext({
                authSession: await createSession(ctx),
                browser: { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' },
              });
              await context.addInitScript(
                (selected) => localStorage.setItem('qflow-theme', selected),
                theme,
              );
              await bindContentUploadStorage(context, ctx, storage);
              const page: import('playwright').Page = await context.newPage();
              page.setDefaultTimeout(20000);
              const errors: string[] = [];
              page.on('pageerror', (cause) => errors.push(safeErrorSummary(cause)));
              try {
                await page.goto(`${app.baseUrl}/assessments/${assessment.id}`, {
                  waitUntil: 'networkidle',
                });
                await page.getByRole('button', {
                  name: new RegExp(`^${i18n.t('assessments.settings.title')}`),
                }).click();
                const rail = page.getByRole('complementary', {
                  name: i18n.t('assessments.settings.title'),
                  exact: true,
                });
                await rail.getByRole('button').filter({
                  hasText: i18n.t('assessments.settings.part', {
                    number: 1,
                    title: initial.parts[0].title,
                  }),
                }).click();
                const release = rail.getByRole('combobox', {
                  name: i18n.t('assessments.partSettings.answerFeedbackRelease'),
                  exact: true,
                });
                for (const value of ['never', 'after-submit']) {
                  await release.selectOption(value);
                  await Promise.all([
                    page.waitForResponse((response) =>
                      response.url().endsWith('/arrange') &&
                      response.request().method() === 'POST' && response.status() === 200
                    ),
                    rail.getByRole('button', {
                      name: i18n.t('assessments.settings.save'),
                      exact: true,
                    }).click(),
                  ]);
                }
                await rail.getByRole('button', {
                  name: i18n.t('assessments.settings.close'),
                  exact: true,
                }).click();
                await page.getByRole('button', {
                  name: i18n.t('assessments.builder.editQuestion', {
                    number: '1.1',
                    title: 'Feedback question',
                  }),
                  exact: true,
                }).click();
                const panel = page.locator('[data-answer-feedback]');
                await panel.locator('summary').focus();
                await panel.locator('summary').press('Enter');
                for (const key of ['correct', 'incorrect'] as const) {
                  const group = panel.getByRole('group', {
                    name: i18n.t(`editor.answerFeedback.${key}`),
                    exact: true,
                  });
                  await group.waitFor();
                  const add = group.getByRole('button', {
                    name: i18n.t('editor.answerFeedback.add'),
                    exact: true,
                  });
                  if (await add.count()) await add.click();
                  await group.getByRole('textbox', {
                    name: i18n.t('editor.answerFeedback.text'),
                    exact: true,
                  }).fill(
                    key === 'correct'
                      ? 'Correct explanation <literal>.'
                      : 'Incorrect explanation: review the lesson.',
                  );
                  if (key === 'correct') {
                    const addLink = group.getByRole('button', {
                      name: i18n.t('editor.answerFeedback.addLink'),
                      exact: true,
                    });
                    if (await addLink.count()) await addLink.click();
                    await group.getByRole('textbox', {
                      name: i18n.t('editor.answerFeedback.url'),
                      exact: true,
                    }).fill('https://example.org/lesson?a=1&b=2');
                    await group.getByRole('textbox', {
                      name: i18n.t('editor.answerFeedback.label'),
                      exact: true,
                    }).fill('Read the lesson');
                    await group.getByRole('combobox', {
                      name: i18n.t('editor.answerFeedback.media'),
                      exact: true,
                    }).selectOption('image');
                    await group.locator('input[type=file]').setInputFiles({
                      name: 'explanation.svg',
                      mimeType: 'image/svg+xml',
                      buffer: Buffer.from(
                        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="36"><rect width="64" height="36" fill="blue"/></svg>',
                      ),
                    });
                    await group.getByRole('textbox', {
                      name: i18n.t('assessments.contentEditor.alt'),
                      exact: true,
                    }).fill('A blue answer diagram');
                    await group.getByRole('textbox', {
                      name: i18n.t('assessments.contentEditor.longDescription'),
                      exact: true,
                    }).fill('Accessible answer description.');
                  } else if (locale === 'en-US' && theme === 'wireframe') {
                    await group.getByRole('combobox', {
                      name: i18n.t('editor.answerFeedback.media'),
                      exact: true,
                    }).selectOption('video');
                    const videoBytes = await page.evaluate(async () => {
                      const canvas = document.createElement('canvas');
                      canvas.width = 64;
                      canvas.height = 36;
                      const drawing = canvas.getContext('2d');
                      if (!drawing) throw new Error('Canvas unavailable');
                      drawing.fillStyle = 'blue';
                      drawing.fillRect(0, 0, 64, 36);
                      const stream = canvas.captureStream(8), chunks: Blob[] = [];
                      const recorder = new MediaRecorder(stream, {
                        mimeType: 'video/webm;codecs=vp8',
                      });
                      recorder.ondataavailable = (event) => chunks.push(event.data);
                      await new Promise<void>((resolve) => {
                        recorder.onstop = () => resolve();
                        recorder.start();
                        setTimeout(() => recorder.stop(), 400);
                      });
                      stream.getTracks().forEach((track) => track.stop());
                      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
                    });
                    await group.getByRole('textbox', {
                      name: i18n.t('assessments.contentEditor.title'),
                      exact: true,
                    }).fill('Video explanation');
                    await group.locator('input[type=file]').nth(0).setInputFiles({
                      name: 'explanation.webm',
                      mimeType: 'video/webm',
                      buffer: Buffer.from(videoBytes),
                    });
                    await group.locator('input[type=file]').nth(1).setInputFiles({
                      name: 'explanation.vtt',
                      mimeType: 'text/vtt',
                      buffer: Buffer.from(
                        'WEBVTT\n\n00:00.000 --> 00:00.400\nReview the lesson.\n',
                      ),
                    });
                    await group.getByRole('textbox', {
                      name: i18n.t('assessments.contentEditor.transcript'),
                      exact: true,
                    }).fill('Accessible video transcript.');
                  } else {
                    await group.getByRole('combobox', {
                      name: i18n.t('editor.answerFeedback.media'),
                      exact: true,
                    }).selectOption('video-link');
                    await group.getByRole('textbox', {
                      name: i18n.t('assessments.contentEditor.title'),
                      exact: true,
                    }).fill('Video explanation');
                    await group.getByRole('textbox', {
                      name: i18n.t('assessments.contentEditor.url'),
                      exact: true,
                    }).fill('https://youtu.be/example');
                    await group.getByRole('textbox', {
                      name: i18n.t('assessments.contentEditor.transcript'),
                      exact: true,
                    }).fill('Accessible video transcript.');
                  }
                }
                const save = page.getByRole('button', { name: i18n.t('editor.save'), exact: true });
                let saveFailures = 0;
                await context.route(
                  `**/api/assessments/${assessment.id}/questions`,
                  async (route) => {
                    if (saveFailures++ === 0) {
                      await route.fulfill({
                        status: 503,
                        contentType: 'application/json',
                        body: JSON.stringify({
                          error: 'save_failed',
                          message: 'Save failed',
                          issues: [],
                        }),
                      });
                    } else if (saveFailures === 2) {
                      await route.fulfill({
                        status: 409,
                        contentType: 'application/json',
                        body: JSON.stringify({
                          error: 'stale_parent_revision',
                          message: 'This item changed while you were editing it.',
                          issues: [],
                        }),
                      });
                    } else await route.continue();
                  },
                );
                await Promise.all([
                  page.waitForResponse((response) =>
                    response.url().endsWith(`/api/assessments/${assessment.id}/questions`) &&
                    response.status() === 503
                  ),
                  save.click(),
                ]);
                await page.getByRole('alert').filter({ hasText: i18n.t('editor.saveFailed') })
                  .waitFor();
                expect(
                  await panel.getByRole('textbox', {
                    name: i18n.t('editor.answerFeedback.text'),
                    exact: true,
                  }).first().inputValue(),
                ).toStrictEqual('Correct explanation <literal>.');
                await Promise.all([
                  page.waitForResponse((response) =>
                    response.url().endsWith(`/api/assessments/${assessment.id}/questions`) &&
                    response.status() === 409
                  ),
                  save.click(),
                ]);
                await page.getByRole('alert').filter({ hasText: i18n.t('editor.staleRevision') })
                  .waitFor();
                expect(
                  await panel.getByRole('textbox', {
                    name: i18n.t('editor.answerFeedback.text'),
                    exact: true,
                  }).first().inputValue(),
                ).toStrictEqual('Correct explanation <literal>.');
                await Promise.all([
                  page.waitForResponse((response) =>
                    response.url().endsWith(`/api/assessments/${assessment.id}/questions`) &&
                    response.status() === 201
                  ),
                  save.click(),
                ]);
                await page.reload({ waitUntil: 'networkidle' });
                await page.getByRole('button', {
                  name: i18n.t('assessments.builder.editQuestion', {
                    number: '1.1',
                    title: 'Feedback question',
                  }),
                  exact: true,
                }).click();
                await panel.locator('summary').click();
                expect(
                  await panel.getByRole('textbox', {
                    name: i18n.t('editor.answerFeedback.text'),
                    exact: true,
                  }).first().inputValue(),
                ).toStrictEqual('Correct explanation <literal>.');
                await page.addScriptTag({ content: axe.source });
                for (const width of [320, 390, 1280]) {
                  await page.setViewportSize({ width, height: 844 });
                  expect(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                  ).toStrictEqual(true);
                  const violations = await page.evaluate(async () =>
                    (await globalThis.axe.run({ include: [['[data-answer-feedback]']] }, {
                      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
                    })).violations.map((entry) => entry.id)
                  );
                  expect(violations).toStrictEqual([]);
                }
                await page.screenshot({
                  path: evidence.path(`${locale}-${theme}-feedback-editor.png`),
                  fullPage: true,
                });
                await page.getByRole('tab', { name: i18n.t('editor.preview'), exact: true })
                  .click();
                const preview = page.locator('[data-qti-preview-host="true"]');
                await preview.getByText(i18n.t('preview.ready'), { exact: true }).waitFor();
                expect(
                  await preview.getByText('Correct explanation <literal>.', { exact: true })
                    .count(),
                ).toStrictEqual(0);
                for (
                  const [answer, text, other] of [[
                    'Beta',
                    'Incorrect explanation: review the lesson.',
                    'Correct explanation <literal>.',
                  ], [
                    'Alpha',
                    'Correct explanation <literal>.',
                    'Incorrect explanation: review the lesson.',
                  ]] as const
                ) {
                  await preview.getByRole('radio', { name: new RegExp(answer) }).click();
                  await preview.getByRole('button', { name: i18n.t('preview.check'), exact: true })
                    .click();
                  await preview.getByText(text, { exact: true }).waitFor();
                  expect(await preview.getByText(other, { exact: true }).count()).toStrictEqual(0);
                }
                const current = await getAssessment(ctx, assessment.id);
                if (!current) expect.unreachable('Expected current');
                const partPlacement = current.parts[0].placements[0];
                if ('content' in partPlacement) {
                  expect.unreachable("Expected !('content' in partPlacement)");
                }
                const revision = await getQuestionRevision(
                  ctx,
                  partPlacement.itemId,
                  partPlacement.snapshotRev!,
                );
                if (!revision) expect.unreachable('Expected revision');
                if (!(revision.body.answerFeedback)) {
                  expect.unreachable('Expected revision.body.answerFeedback');
                }
                const packaged = await buildAssessmentPackage({
                  assessment: current,
                  auth: ctx,
                  targetId: 'qti3-conformant',
                  requirements: strictAssessmentExportRequirements(),
                  readUploadBytes: (upload) => storage.readObject(upload.path),
                });
                if (!(packaged.ok)) expect.unreachable(packaged.ok ? '' : packaged.body.message);
                const imported = await parseQtiPackage(packaged.artifact.bytes);
                expect(imported.items.length).toStrictEqual(1);
                expect(imported.assets.length).toStrictEqual(
                  locale === 'en-US' && theme === 'wireframe' ? 3 : 1,
                );
                if (!(imported.items[0].draft.answerFeedback)) {
                  expect.unreachable('Expected imported.items[0].draft.answerFeedback');
                }
                expect(imported.parts[0].options?.answerFeedbackRelease).toStrictEqual(
                  'after-submit',
                );
                const handoff = process.env['QFLOW_FEEDBACK_TEST_PACKAGE'];
                if (handoff && locale === 'en-US' && theme === 'wireframe') {
                  await _fs.writeFile(handoff, packaged.artifact.bytes);
                  await _fs.writeFile(
                    `${handoff}.json`,
                    JSON.stringify({
                      sha256: await sha256Hex(packaged.artifact.bytes),
                      questionCount: 1,
                      maximumScore: 0,
                    }),
                    'utf8',
                  );
                }
                await page.screenshot({
                  path: evidence.path(`${locale}-${theme}-feedback.png`),
                  fullPage: true,
                });
                expect(errors).toStrictEqual([]);
              } catch (cause: unknown) {
                await captureBrowserFailure(page, evidence, `${locale}-${theme}`);
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

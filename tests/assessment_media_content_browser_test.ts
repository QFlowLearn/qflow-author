import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';

import { Buffer } from 'node:buffer';
import { eq } from 'drizzle-orm';
import axe from 'axe-core';
import { db, shutdownDb } from '../lib/db.ts';
import { uploadsTable } from '../lib/db/schema.ts';
import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';
import { buildAssessmentPackage } from '../lib/export/assessment_package.ts';
import { strictAssessmentExportRequirements } from '../lib/export/assessment_export_requirements.ts';
import { sha256Hex } from '../lib/sha256.ts';
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
import { createMemoryObjectStorage } from './memory_object_storage.ts';
import { bindContentUploadStorage } from './helpers/content_upload_browser_runtime.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';

testCase(
  'image, captioned video and online video authoring preserve unscored order, files, retries and keyboard access in every locale and theme',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory(), storage = createMemoryObjectStorage();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Media content acceptance' });
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
              portRange: { first: 5580, lastExclusive: 5590 },
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
            for (const theme of ['wireframe', 'dark'] as const) {
              const i18n = createI18n(locale, catalogForLocale(locale));
              await saveAssessmentArrangementFixture(ctx, assessment.id, original.parts);
              await saveUserSettings(ctx.userId, { ...createInitialUserSettings(locale), theme });
              const context: import('playwright').BrowserContext = await app.newContext({
                authSession: await createSession(ctx),
                browser: { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' },
              });
              await context.addInitScript(
                (selected) => localStorage.setItem('qflow-theme', selected),
                theme,
              );
              const uploads = await bindContentUploadStorage(context, ctx, storage);
              const page: import('playwright').Page = await context.newPage();
              page.setDefaultTimeout(20000);
              const errors: string[] = [];
              page.on('pageerror', (cause) => errors.push(safeErrorSummary(cause)));
              try {
                await page.goto(`${app.baseUrl}/assessments/${assessment.id}`, {
                  waitUntil: 'networkidle',
                });
                const videoBytes = await page.evaluate(async () => {
                  const canvas = document.createElement('canvas');
                  canvas.width = 64;
                  canvas.height = 36;
                  const drawing = canvas.getContext('2d');
                  if (!drawing) {
                    throw new Error('Canvas unavailable.');
                  }
                  drawing.fillStyle = 'blue';
                  drawing.fillRect(0, 0, 64, 36);
                  const stream = canvas.captureStream(8), chunks: Blob[] = [];
                  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
                  recorder.ondataavailable = (event) => chunks.push(event.data);
                  await new Promise<void>((resolve) => {
                    recorder.onstop = () => resolve();
                    recorder.start();
                    setTimeout(() => recorder.stop(), 400);
                  });
                  stream.getTracks().forEach((track) => track.stop());
                  return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
                });
                const button = (key: string) =>
                  page.getByRole('button', { name: i18n.t(key), exact: true });
                const form = () =>
                  page.getByRole('article').filter({
                    has: page.getByRole('button', {
                      name: i18n.t('assessments.contentEditor.save'),
                      exact: true,
                    }),
                  });
                const save = async () => {
                  await Promise.all([
                    page.waitForResponse((response) =>
                      response.url().endsWith(`/api/assessments/${assessment.id}/arrange`) &&
                      response.request().method() === 'POST' && response.status() === 200
                    ),
                    form().getByRole('button', {
                      name: i18n.t('assessments.contentEditor.save'),
                      exact: true,
                    }).click(),
                  ]);
                };
                await page.getByRole('button', {
                  name: i18n.t('assessments.builder.editQuestion', {
                    number: '1.1',
                    title: 'First real question',
                  }),
                  exact: true,
                }).click();
                await page.locator(`[data-authoring-card="${first.itemId}"]`).waitFor();
                await button('editor.save').waitFor();
                await button('assessments.builder.addImageBlock').focus();
                await button('assessments.builder.addImageBlock').press('Enter');
                await form().locator('input[type=file]').setInputFiles({
                  name: 'rectangle.svg',
                  mimeType: 'image/svg+xml',
                  buffer: Buffer.from(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="36"><rect width="64" height="36" fill="blue"/></svg>',
                  ),
                });
                await form().getByRole('textbox', {
                  name: i18n.t('assessments.contentEditor.alt'),
                  exact: true,
                }).fill('A blue rectangle');
                await form().getByRole('textbox', {
                  name: i18n.t('assessments.contentEditor.longDescription'),
                  exact: true,
                }).fill('Literal <script> description.\nRead the diagram before answering.');
                await save();
                await Promise.all([
                  page.waitForResponse((response) =>
                    response.url().endsWith('/arrange') && response.status() === 200
                  ),
                  form().getByRole('button', {
                    name: i18n.t('assessments.contentEditor.duplicate'),
                    exact: true,
                  }).click(),
                ]);
                const copied = await getAssessment(ctx, assessment.id);
                if (!copied) expect.unreachable('Expected copied');
                expect(copied.parts[0].placements.length).toStrictEqual(4);
                page.once('dialog', (dialog) => dialog.accept());
                await Promise.all([
                  page.waitForResponse((response) =>
                    response.url().endsWith('/arrange') && response.status() === 200
                  ),
                  form().getByRole('button', {
                    name: i18n.t('assessments.contentEditor.remove'),
                    exact: true,
                  }).click(),
                ]);
                const imageSaved = await getAssessment(ctx, assessment.id);
                if (!imageSaved) expect.unreachable('Expected imageSaved');
                expect(imageSaved.parts[0].placements.length).toStrictEqual(3);
                await page.locator(`#edit-text-${imageSaved.parts[0].placements[1].id}`).click();
                await button('assessments.builder.addVideoBlock').focus();
                await button('assessments.builder.addVideoBlock').press('Enter');
                await page.getByRole('region', {
                  name: i18n.t('assessments.builder.addVideoBlock'),
                  exact: true,
                }).getByRole('button', {
                  name: i18n.t('assessments.contentEditor.uploadVideo'),
                  exact: true,
                }).click();
                await form().getByRole('textbox', {
                  name: i18n.t('assessments.contentEditor.title'),
                  exact: true,
                }).fill('A moving blue rectangle');
                await form().getByRole('textbox', {
                  name: i18n.t('assessments.contentEditor.captionLanguage'),
                  exact: true,
                }).fill('en-US');
                await form().locator('input[type=file]').nth(0).setInputFiles({
                  name: 'rectangle.webm',
                  mimeType: 'video/webm',
                  buffer: Buffer.from(videoBytes),
                });
                await form().locator('input[type=file]').nth(1).setInputFiles({
                  name: 'rectangle.vtt',
                  mimeType: 'text/vtt',
                  buffer: Buffer.from(
                    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA blue rectangle.\n',
                  ),
                });
                await form().getByRole('textbox', {
                  name: i18n.t('assessments.contentEditor.transcript'),
                  exact: true,
                }).fill('A blue rectangle.\nThe transcript remains readable without playback.');
                if (locale === 'en-US' && theme === 'wireframe') {
                  const pattern = `**/api/assessments/${assessment.id}/arrange`;
                  await page.route(pattern, async (route) => {
                    const response = await route.fetch();
                    expect(response.status()).toStrictEqual(200);
                    await route.abort('failed');
                    await page.unroute(pattern);
                  });
                  await form().getByRole('button', {
                    name: i18n.t('assessments.contentEditor.save'),
                    exact: true,
                  }).click();
                  await page.getByText(i18n.t('assessments.contentEditor.uncertain'), {
                    exact: true,
                  }).waitFor();
                  await form().getByRole('textbox', {
                    name: i18n.t('assessments.contentEditor.transcript'),
                    exact: true,
                  }).fill(
                    'A blue rectangle.\nThe transcript remains readable without playback.\nA newer edit.',
                  );
                  await button('assessments.contentEditor.retry').click();
                  await page.getByText(i18n.t('editor.unsavedChanges'), { exact: true }).waitFor();
                }
                await save();
                await button('assessments.builder.addVideoBlock').click();
                await page.getByRole('region', {
                  name: i18n.t('assessments.builder.addVideoBlock'),
                  exact: true,
                }).getByRole('button', {
                  name: i18n.t('assessments.contentEditor.addOnlineVideo'),
                  exact: true,
                }).click();
                await form().getByRole('textbox', {
                  name: i18n.t('assessments.contentEditor.title'),
                  exact: true,
                }).fill('Online rectangle demonstration');
                await form().getByRole('textbox', {
                  name: i18n.t('assessments.contentEditor.url'),
                  exact: true,
                }).fill('https://youtu.be/example');
                await form().getByRole('textbox', {
                  name: i18n.t('assessments.contentEditor.transcript'),
                  exact: true,
                }).fill('Equivalent instructions: consider the blue rectangle.');
                await save();
                await button('assessments.contentEditor.done').click();
                const saved = await getAssessment(ctx, assessment.id);
                if (!saved) expect.unreachable('Expected saved');
                expect(saved.targetCount).toStrictEqual(2);
                expect(
                  saved.parts[0].placements.map((placement) =>
                    'content' in placement ? placement.content.kind : placement.id
                  ),
                ).toStrictEqual([first.id, 'image', 'video', 'video-link', second.id]);
                expect(assessmentQuestionPlacements(saved.parts[0].placements)).toStrictEqual([
                  first,
                  second,
                ]);
                expect(
                  saved.parts[0].placements.filter((placement) => 'content' in placement).map((
                    placement,
                  ) => placement.content.kind),
                ).toStrictEqual(['image', 'video', 'video-link']);
                expect(uploads.uploadedCount()).toStrictEqual(3);
                await page.reload({ waitUntil: 'networkidle' });
                if (
                  !(await page.getByRole('img', { name: 'A blue rectangle', exact: true }).evaluate(
                    (
                      image,
                    ) =>
                      image instanceof HTMLImageElement && image.complete &&
                      image.naturalWidth === 64,
                  ))
                ) {
                  expect.unreachable(
                    "Expected await page.getByRole('img', { name: 'A blue rectangle', exact: true }).evaluate(( image, )",
                  );
                }
                const video = page.locator('video[aria-label="A moving blue rectangle"]');
                await video.evaluate((element) => {
                  if (!(element instanceof HTMLVideoElement)) throw new Error('Video missing.');
                  element.load();
                });
                await page.waitForFunction(() =>
                  document.querySelector<HTMLVideoElement>(
                    'video[aria-label="A moving blue rectangle"]',
                  )?.readyState === 4
                );
                expect(
                  await video.evaluate((element) =>
                    element instanceof HTMLVideoElement
                      ? [element.autoplay, element.controls, element.textTracks.length]
                      : []
                  ),
                ).toStrictEqual([false, true, 1]);
                await page.getByRole('link', {
                  name: 'Online rectangle demonstration',
                  exact: true,
                }).waitFor();
                await page.getByText(i18n.t('assessments.contentEditor.networkNotice'), {
                  exact: true,
                }).waitFor();
                await page.addScriptTag({ content: axe.source });
                for (const width of [320, 390, 1280]) {
                  await page.setViewportSize({ width, height: 844 });
                  expect(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                  ).toStrictEqual(true);
                  const violations = await page.evaluate(async () =>
                    await globalThis.axe.run({
                      include: [
                        ['article:has(img[alt="A blue rectangle"])'],
                        ['article:has(video)'],
                        ['article:has(a[href="https://youtu.be/example"])'],
                      ],
                    })
                  );
                  expect(violations.violations.map((violation) => violation.id)).toStrictEqual([]);
                  await page.screenshot({
                    path: evidence.path(`${locale}-${theme}-${width}.png`),
                    fullPage: true,
                  });
                }
                expect(errors).toStrictEqual([]);
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
                await Promise.all([
                  page.waitForResponse((response) =>
                    response.url().includes('/question-order-preview?') && response.status() === 200
                  ),
                  rail.getByRole('button', {
                    name: i18n.t('assessments.orderPreview.show'),
                    exact: true,
                  }).click(),
                ]);
                const example = rail.getByRole('region', {
                  name: i18n.t('assessments.orderPreview.example'),
                  exact: true,
                });
                await example.getByRole('img', { name: 'A blue rectangle', exact: true }).waitFor();
                expect(await example.locator('li').count()).toStrictEqual(2);
                expect(await example.locator('video').count()).toStrictEqual(1);
                await example.getByRole('link', {
                  name: 'Online rectangle demonstration',
                  exact: true,
                }).waitFor();
                await rail.getByRole('button', {
                  name: i18n.t('assessments.settings.close'),
                  exact: true,
                }).click();
                const packaged = await buildAssessmentPackage({
                  assessment: saved,
                  auth: ctx,
                  targetId: 'qti3-conformant',
                  requirements: strictAssessmentExportRequirements(),
                  readUploadBytes: (upload) => storage.readObject(upload.path),
                });
                if (!(packaged.ok)) expect.unreachable(packaged.ok ? '' : packaged.body.message);
                const imported = await parseQtiPackage(packaged.artifact.bytes);
                expect(imported.items.length).toStrictEqual(2);
                expect(imported.assets.length).toStrictEqual(3);
                const handoff = process.env['QFLOW_MEDIA_TEST_PACKAGE'];
                if (handoff && locale === 'en-US' && theme === 'wireframe') {
                  if (!(handoff.startsWith('/private/tmp/'))) {
                    expect.unreachable("Expected handoff.startsWith('/private/tmp/')");
                  }
                  await _fs.writeFile(handoff, packaged.artifact.bytes);
                  await _fs.writeFile(
                    `${handoff}.json`,
                    JSON.stringify(
                      {
                        sha256: await sha256Hex(packaged.artifact.bytes),
                        contents: saved.parts[0].placements.filter((placement) =>
                          'content' in placement
                        ).map((placement) => placement.content),
                        questionCount: 2,
                        maximumScore: 2,
                      },
                      null,
                      2,
                    ),
                    'utf8',
                  );
                }
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
          await db.delete(uploadsTable).where(eq(uploadsTable.tenantId, ctx.tenantId));
        }
      });
    } finally {
      await app?.close();
      await shutdownDb();
    }
  },
);

import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import { extractText, getDocumentProxy } from 'unpdf';
import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { assessmentPrintPacks, assessments, authSessions } from '../lib/db/schema.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { setPublicationGrant } from '../lib/services/publication_grants.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';

test(
  'paper builder renders actual PDF pages, finalizes reviewed bytes and keeps separate downloads',
  { skip: process.env.QFLOW_BROWSER_TESTS !== '1' },
  async () => {
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Print browser proof' });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable();
          const saved = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId: initial.parts[0].id,
            draft: {
              type: 'single_select',
              title: 'STAFF_TITLE_SENTINEL',
              itemLanguage: newAuthoringItemLanguage(),
              bodyHtml: '<p>Visible candidate prompt. Read carefully and compare the evidence.</p>'
                .repeat(22),
              maximumScore: 2,
              choices: [{ id: 'A', text: 'First' }, { id: 'B', text: 'Second' }],
              correctId: 'B',
            },
          });
          if (!saved.ok) expect.unreachable();
          const written = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId: initial.parts[0].id,
            draft: {
              type: 'extended_text',
              title: 'STAFF_WRITTEN_TITLE',
              itemLanguage: newAuthoringItemLanguage(),
              bodyHtml: '<p>Explain your reasoning.</p>',
              promptHtml: '<p>Write your answer.</p>',
              rubricHtml: '<p>STAFF_RUBRIC_SENTINEL: Award credit for a justified conclusion.</p>',
            },
          });
          if (!written.ok) expect.unreachable();
          expect((await setPublicationGrant(ctx, ctx.userId, 'grant')).ok).toBe(true);
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              isolation: 'fixture',
              portRange: { first: 5500, lastExclusive: 5510 },
              environment: {
                ...builtWorkerBrowserEnvironment,
                DATABASE_URL: requireQaDatabaseUrl(process.env.DATABASE_URL),
              },
            },
            headless: true,
          });
          const appBase = app.baseUrl;
          for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
            await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
            const i18n = createI18n(locale, catalogForLocale(locale));
            const context = await app.newContext({ authSession: await createSession(ctx) });
            const page = await context.newPage(), errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.name));
            page.setDefaultTimeout(30000);
            try {
              await page.goto(
                `${appBase}/assessments/${assessment.id}?tool=assessment-export`,
                { waitUntil: 'networkidle' },
              );
              await page.getByText(i18n.t('publication.download'), { exact: true }).click();
              await page.locator('#assessment-export-target').selectOption('printable-pack');
              await page.getByLabel(i18n.t('print.title'), { exact: true }).fill(`Paper ${locale}`);
              await page.getByLabel(i18n.t('print.approvePresentation'), { exact: true }).check();
              if (locale === 'en-US') {
                await page.getByRole('button', { name: i18n.t('print.check'), exact: true })
                  .click();
                const override = page.locator(`#paper-lines-${written.value.placementId}`);
                await override.fill('9');
                await override.fill('12');
                expect(await override.inputValue()).toBe('12');
              }
              await page.getByRole('button', { name: i18n.t('print.createPreview'), exact: true })
                .click();
              await page.getByText(i18n.t('print.draftPreview'), { exact: true }).waitFor();
              const reviewPages = async () => {
                const next = page.getByRole('button', { name: i18n.t('print.next'), exact: true });
                for (let index = 0; index < 100; index++) {
                  await expect.poll(async () =>
                    await page.locator('canvas[aria-label]').getAttribute('width')
                  ).not.toBeNull();
                  await page.waitForFunction(() =>
                    document.querySelector('[aria-busy="false"] > div > canvas[aria-label]') !==
                      null
                  );
                  if (!await next.isEnabled()) break;
                  const text = await page.getByRole('status').filter({ hasText: /[0-9]/ }).last()
                    .innerText();
                  await next.click();
                  await expect.poll(() =>
                    page.getByRole('status').filter({ hasText: /[0-9]/ }).last().innerText()
                  ).not.toBe(text);
                }
              };
              await reviewPages();
              await page.getByRole('button', { name: i18n.t('print.marking'), exact: true })
                .click();
              await reviewPages();
              const review = page.getByLabel(i18n.t('print.confirmReview'), { exact: true });
              await expect.poll(() => review.isEnabled()).toBe(true);
              await review.check();
              if (locale === 'en-US') {
                await db.update(assessments).set({ title: 'Changed while previewing' }).where(
                  eq(assessments.id, assessment.id),
                );
                await page.getByRole('button', { name: i18n.t('print.finalize'), exact: true })
                  .click();
                await page.getByText(i18n.t('print.stale'), { exact: true }).waitFor();
                await db.update(assessments).set({ title: 'Print browser proof' }).where(
                  eq(assessments.id, assessment.id),
                );
              }
              await page.getByRole('button', { name: i18n.t('print.finalize'), exact: true })
                .click();
              const student = page.getByRole('link', {
                name: i18n.t('print.download.student'),
                exact: true,
              });
              await student.waitFor();
              for (const kind of ['student', 'marking', 'manifest'] as const) {
                const href = await page.getByRole('link', {
                  name: i18n.t(`print.download.${kind}`),
                  exact: true,
                }).getAttribute('href');
                if (!href) expect.unreachable();
                const response = await context.request.get(new URL(href, app.baseUrl).toString());
                expect(response.status()).toBe(200);
                expect(response.headers()['cache-control']).toBe('private, no-store');
                const bytes = new Uint8Array(await response.body());
                expect(bytes.length).toBeGreaterThan(100);
                if (kind !== 'manifest' && locale === 'en-US') {
                  const pdf = await getDocumentProxy(bytes),
                    content = (await extractText(pdf, { mergePages: true })).text;
                  expect(content).toContain('Visible candidate prompt');
                  expect(content.includes('STAFF_RUBRIC_SENTINEL')).toBe(kind === 'marking');
                  if (kind === 'student') {
                    expect(content).not.toContain('STAFF_');
                    expect(content).not.toContain('Award 2 points');
                  }
                  const metadata = await pdf.getMetadata();
                  expect(JSON.stringify(metadata.info)).not.toContain('STAFF_');
                  expect(await pdf.getAttachments()).toBeNull();
                  expect(await pdf.getJSActions()).toBeNull();
                  await pdf.loadingTask.destroy();
                }
              }
              if (locale === 'en-US') {
                const href = await student.getAttribute('href');
                if (!href) expect.unreachable();
                expect(
                  (await context.request.get(
                    new URL(href + '?kind=marking', app.baseUrl).toString(),
                  )).status(),
                ).toBe(400);
                const packUrl = new URL(href, app.baseUrl).toString().replace(/\/student$/, '');
                expect(
                  (await context.request.post(packUrl + '/confirm', {
                    data: 'null',
                    headers: { origin: app.baseUrl, 'content-type': 'application/json' },
                  })).status(),
                ).toBe(400);
                const otherAssessment = crypto.randomUUID();
                expect(
                  (await context.request.get(
                    new URL(href.replace(assessment.id, otherAssessment), app.baseUrl).toString(),
                  )).status(),
                ).toBe(404);
              }
              expect(errors).toEqual([]);
              await page.screenshot({ path: evidence.path(`print-${locale}.png`), fullPage: true });
            } catch (cause: unknown) {
              await captureBrowserFailure(page, evidence, `print-${locale}`);
              throw cause;
            } finally {
              await context.close();
            }
          }
          // Exercise the real in-place repair action and failed-build/new-form recovery in English.
          await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
          const i18n = createI18n('en-US', catalogForLocale('en-US'));
          const sectionSource = await getAssessment(ctx, assessment.id);
          if (!sectionSource) expect.unreachable();
          await saveAssessmentArrangementFixture(
            ctx,
            assessment.id,
            sectionSource.parts.map((part) => ({
              ...part,
              options: { ...part.options, timeLimits: { maxTime: 60 } },
            })),
          );
          const missing = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId: initial.parts[0].id,
            draft: {
              type: 'extended_text',
              title: 'Missing rubric fixture',
              itemLanguage: newAuthoringItemLanguage(),
              bodyHtml: '<p>Repair this written question.</p>',
              promptHtml: '<p>Write here.</p>',
            },
          });
          if (!missing.ok) expect.unreachable();
          const context = await app.newContext({ authSession: await createSession(ctx) }),
            page = await context.newPage();
          page.setDefaultTimeout(30000);
          const openPaper = async (title: string) => {
            await page.goto(`${appBase}/assessments/${assessment.id}?tool=assessment-export`, {
              waitUntil: 'networkidle',
            });
            await page.getByText(i18n.t('publication.download'), { exact: true }).click();
            await page.locator('#assessment-export-target').selectOption('printable-pack');
            await page.getByLabel(i18n.t('print.title'), { exact: true }).fill(title);
            await page.getByLabel(i18n.t('print.approvePresentation'), { exact: true }).check();
          };
          try {
            await openPaper('Repair settings retained');
            await page.getByRole('radio', { name: 'Letter', exact: true }).check();
            const settings = page.getByRole('complementary', {
              name: i18n.t('assessments.settings.title'),
              exact: true,
            });
            expect(await settings.count()).toBe(0);
            await page.getByRole('button', { name: i18n.t('print.check'), exact: true }).click();
            const sectionFinding = page.getByRole('region', {
              name: i18n.t('print.destination'),
              exact: true,
            }).getByRole('listitem').filter({
              hasText: sectionSource.parts[0].title,
            }).first();
            await sectionFinding.getByRole('button', { name: i18n.t('print.repair'), exact: true })
              .click();
            await settings.waitFor();
            expect(await page.getByLabel(i18n.t('print.title'), { exact: true }).inputValue()).toBe(
              'Repair settings retained',
            );
            expect(await page.getByRole('radio', { name: 'Letter', exact: true }).isChecked()).toBe(
              true,
            );
            await settings.getByRole('button', {
              name: i18n.t('assessments.settings.close'),
              exact: true,
            }).click();
            const currentSection = await getAssessment(ctx, assessment.id);
            if (!currentSection) expect.unreachable();
            await saveAssessmentArrangementFixture(
              ctx,
              assessment.id,
              currentSection.parts.map((part) => ({
                ...part,
                options: { ...part.options, timeLimits: undefined },
              })),
            );
            await page.getByRole('button', { name: i18n.t('print.check'), exact: true }).click();
            await page.getByText(i18n.t('print.issue.manualGuidance'), { exact: true }).waitFor();
            const finding = page.getByRole('listitem').filter({ hasText: 'Missing rubric fixture' })
              .first();
            await Promise.all([
              page.waitForResponse((response) =>
                response.url().includes(`/api/items/${missing.value.itemId}/revisions/`) &&
                response.status() === 200
              ),
              finding.getByRole('button', { name: i18n.t('print.repair'), exact: true }).click(),
            ]);
            await page.locator('[data-editor-field="body"]').waitFor();
            expect(await page.getByLabel(i18n.t('print.title'), { exact: true }).inputValue()).toBe(
              'Repair settings retained',
            );
            const broken = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Revise',
              itemId: missing.value.itemId,
              placementId: missing.value.placementId,
              expectedParentRevision: 1,
              draft: {
                type: 'extended_text',
                title: 'Unsupported glyph fixture',
                itemLanguage: newAuthoringItemLanguage(),
                bodyHtml: '<p>Unsupported glyph: 🦄</p>',
                promptHtml: '<p>Write here.</p>',
                rubricHtml: '<p>STAFF_RUBRIC: Explain the reasoning.</p>',
              },
            });
            if (!broken.ok) expect.unreachable();
            await openPaper('Retry settings retained');
            await page.getByRole('button', { name: i18n.t('print.createPreview'), exact: true })
              .click();
            await page.getByText(i18n.t('print.fontUnsupported'), { exact: true }).waitFor();
            const repaired = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Revise',
              itemId: missing.value.itemId,
              placementId: missing.value.placementId,
              expectedParentRevision: 2,
              draft: {
                type: 'extended_text',
                title: 'Repaired written question',
                itemLanguage: newAuthoringItemLanguage(),
                bodyHtml: '<p>Supported text.</p>',
                promptHtml: '<p>Write here.</p>',
                rubricHtml: '<p>STAFF_RUBRIC: Explain the reasoning.</p>',
              },
            });
            if (!repaired.ok) expect.unreachable();
            await page.getByRole('button', { name: i18n.t('print.newForm'), exact: true }).click();
            expect(await page.getByLabel(i18n.t('print.title'), { exact: true }).inputValue()).toBe(
              'Retry settings retained',
            );
            await page.getByRole('button', { name: i18n.t('print.createPreview'), exact: true })
              .click();
            await page.getByText(i18n.t('print.draftPreview'), { exact: true }).waitFor();
          } catch (cause: unknown) {
            await captureBrowserFailure(page, evidence, 'print-recovery');
            throw cause;
          } finally {
            await context.close();
          }
        } finally {
          await db.delete(assessmentPrintPacks).where(
            eq(assessmentPrintPacks.assessmentId, assessment.id),
          );
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

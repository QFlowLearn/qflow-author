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
  'saved text remains literal, ordered and unscored in the real canvas and Arrange across locales and themes',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Mixed content regression' });
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
            content: {
              kind: 'text' as const,
              text: '  Read <script>alert("unsafe")</script> literally.\nConsider α & β.  ',
            },
            fixed: true as const,
          };
          await saveAssessmentArrangementFixture(ctx, assessment.id, [{
            ...saved.parts[0],
            placements: [first, text, second],
          }]);
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
            await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
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
              try {
                await page.goto(`${app.baseUrl}/assessments/${assessment.id}`, {
                  waitUntil: 'networkidle',
                });
                expect(await page.locator('html').getAttribute('data-theme')).toStrictEqual(theme);
                const canvas = page.locator('main').filter({
                  has: page.getByRole('heading', {
                    name: i18n.t('assessments.builder.assessmentFlow'),
                    exact: true,
                  }),
                }).last();
                const textBlock = canvas.getByRole('article').filter({
                  has: page.getByRole('heading', {
                    name: i18n.t('assessments.builder.textBlock'),
                    exact: true,
                  }),
                });
                await textBlock.waitFor();
                expect(await textBlock.locator('p').textContent()).toStrictEqual(text.content.text);
                expect(await textBlock.locator('script,a,input,textarea').count()).toStrictEqual(0);
                expect(await canvas.locator('article').count()).toStrictEqual(3);
                const contents = await canvas.locator('article').allTextContents();
                expect(contents[0]).toContain('First real question');
                expect(contents[1]).toContain(text.content.text);
                expect(contents[2]).toContain('Second real question');
                await canvas.getByRole('button', {
                  name: i18n.t('assessments.builder.editQuestion', {
                    number: '1.1',
                    title: 'First real question',
                  }),
                  exact: true,
                }).waitFor();
                await canvas.getByRole('button', {
                  name: i18n.t('assessments.builder.editQuestion', {
                    number: '1.2',
                    title: 'Second real question',
                  }),
                  exact: true,
                }).waitFor();
                expect(await canvas.innerText()).toContain(
                  i18n.t('assessments.builder.questionCount', { count: 2 }),
                );
                for (const width of [390, 1280]) {
                  await page.setViewportSize({ width, height: 844 });
                  const bounds = await textBlock.boundingBox();
                  if (
                    !(bounds && bounds.width > 0 && bounds.x >= 0 &&
                      bounds.x + bounds.width <= width)
                  ) {
                    expect.unreachable(
                      'Expected bounds && bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width',
                    );
                  }
                  if (locale === 'en-US' && theme === 'wireframe') {
                    await page.screenshot({
                      path: evidence.path(`text-canvas-${width}.png`),
                      fullPage: true,
                    });
                  }
                }
                await page.addScriptTag({ content: axe.source });
                const audit: unknown = await page.evaluate(
                  'globalThis.axe.run("main article").then(result => result.violations.map(violation => ({id: violation.id, nodes: violation.nodes.map(node => ({html: node.html, reason: node.failureSummary}))})))',
                );
                if (!(Array.isArray(audit))) expect.unreachable('Expected Array.isArray(audit)');
                if (audit.length) {
                  await _fs.writeFile(
                    evidence.path(`text-${locale}-${theme}-a11y.json`),
                    JSON.stringify(audit, null, 2),
                    'utf8',
                  );
                }
                expect(audit).toStrictEqual([]);
                await page.goto(`${app.baseUrl}/assessments/${assessment.id}/arrange`, {
                  waitUntil: 'networkidle',
                });
                await page.getByText(text.content.text, { exact: true }).waitFor();
                await page.getByRole('button', {
                  name: i18n.t('assessments.arrange.partSettings'),
                  exact: true,
                }).click();
                const modal = page.getByRole('dialog', {
                  name: i18n.t('assessments.arrange.modal.title', { part: 1 }),
                  exact: true,
                });
                await modal.locator('summary').filter({
                  hasText: i18n.t('assessments.partSettings.fixedQuestions'),
                }).click();
                await modal.getByRole('checkbox', { name: /First real question$/ }).waitFor();
                expect(await modal.getByRole('checkbox').count()).toStrictEqual(3);
                expect(await modal.getByRole('checkbox', { name: /real question$/ }).count())
                  .toStrictEqual(2);
                expect(errors).toStrictEqual([]);
                expect(dialogs).toStrictEqual([]);
              } catch (cause: unknown) {
                await captureBrowserFailure(page, evidence, `text-${locale}-${theme}`);
                throw cause;
              } finally {
                await context.close();
              }
            }
          }
          expect((await getAssessment(ctx, assessment.id))?.parts[0].placements).toStrictEqual([
            first,
            text,
            second,
          ]);
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

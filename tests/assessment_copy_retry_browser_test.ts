import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';
import type { BrowserContext, Page } from 'playwright';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions } from '../lib/db/auth_schema.ts';
import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';
import { parseAssessmentQuestionCommand } from '../lib/assessment_question_command.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import {
  saveAssessmentQuestion,
  type SaveAssessmentQuestionCommand,
} from '../lib/services/assessment_question_authoring.ts';
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
  'a lost real copy response replays once across selection changes, with independent copies after reload',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    let app: LocalAppBrowser | undefined;
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        app = await openLocalAppBrowser({
          endpoint: {
            _tag: 'ManagedLocalApp',
            portRange: { first: 5480, lastExclusive: 5490 },
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
              const label = `${locale}-${theme}`;
              await saveUserSettings(ctx.userId, { ...createInitialUserSettings(locale), theme });
              const assessment = await createAssessmentDraft(ctx, { title: label });
              let context: BrowserContext | undefined;
              let page: Page | undefined;
              try {
                const initial = await getAssessment(ctx, assessment.id);
                if (!initial) expect.unreachable('Expected initial');
                const partId = initial.parts[0].id;
                const draft = {
                  type: 'single_select' as const,
                  title: 'Source with a reference',
                  itemLanguage: newAuthoringItemLanguage(),
                  bodyHtml:
                    '<p>Choose a city. <a href="https://example.com/cities">Reference</a></p>',
                  maximumScore: 3.125,
                  choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin', fixed: true }],
                  correctId: 'A',
                };
                const source = await saveAssessmentQuestion(ctx, assessment.id, {
                  _tag: 'Create',
                  partId,
                  draft,
                });
                const tail = await saveAssessmentQuestion(ctx, assessment.id, {
                  _tag: 'Create',
                  partId,
                  draft: { ...draft, title: 'Trailing question' },
                });
                if (!(source.ok && tail.ok)) expect.unreachable('Expected source.ok && tail.ok');
                const original = await getQuestionRevision(ctx, source.value.itemId, 1);
                if (!original) expect.unreachable('Expected original');
                context = await app.newContext({
                  authSession: await createSession(ctx),
                  browser: { viewport: { width: theme === 'dark' ? 390 : 1280, height: 900 } },
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
                const url = `${baseUrl}/assessments/${assessment.id}`;
                await casePage.goto(url);
                const editSource = () =>
                  casePage.getByRole('button', {
                    name: i18n.t('assessments.builder.editQuestion', {
                      number: '1.1',
                      title: draft.title,
                    }),
                    exact: true,
                  }).click();
                await editSource();
                await casePage.locator('[data-choice-id="A"]').waitFor();
                const endpoint = `${baseUrl}/api/assessments/${assessment.id}/questions`;
                const commands: Extract<SaveAssessmentQuestionCommand, { _tag: 'Variant' }>[] = [];
                const responses: unknown[] = [];
                await casePage.route(endpoint, async (route) => {
                  const raw: unknown = route.request().postDataJSON();
                  const parsed = parseAssessmentQuestionCommand(raw);
                  if (!(parsed.ok && parsed.command._tag === 'Variant')) {
                    expect.unreachable("Expected parsed.ok && parsed.command._tag === 'Variant'");
                  }
                  commands.push(parsed.command);
                  // Commit through the real application and database before losing only its reply.
                  const response = await route.fetch();
                  expect(response.status()).toStrictEqual(201);
                  responses.push(await response.json());
                  if (commands.length === 1) await route.abort('failed');
                  else await route.fulfill({ response });
                });
                const duplicate = casePage.getByRole('button', {
                  name: i18n.t('assessments.builder.duplicateQuestion'),
                  exact: true,
                });
                const warning = casePage.waitForEvent('dialog').then(async (dialog) => {
                  const message = dialog.message();
                  await dialog.accept();
                  return message;
                });
                const [, message] = await Promise.all([duplicate.click(), warning]);
                expect(message).toStrictEqual(i18n.t('assessments.builder.variantFailed'));
                const committed = await getAssessment(ctx, assessment.id);
                if (!committed) expect.unreachable('Expected committed');
                const committedPlacements = assessmentQuestionPlacements(
                  committed.parts[0].placements,
                );
                expect(committedPlacements.length).toStrictEqual(3);
                const savedCopy = committedPlacements[1];
                expect(await casePage.locator('article[id^="assessment-question-"]').count())
                  .toStrictEqual(2);
                // Another successful copy must not forget the first request whose reply was lost.
                await casePage.getByRole('button', {
                  name: i18n.t('assessments.builder.editQuestion', {
                    number: '1.2',
                    title: 'Trailing question',
                  }),
                  exact: true,
                }).click();
                await casePage.locator(
                  `#assessment-question-${tail.value.placementId} [data-choice-id="A"]`,
                ).waitFor();
                await duplicate.click();
                await casePage.waitForFunction(() =>
                  document.querySelectorAll('article[id^="assessment-question-"]').length === 3
                );
                const afterTailCopy = await getAssessment(ctx, assessment.id);
                if (!afterTailCopy) expect.unreachable('Expected afterTailCopy');
                const afterTailPlacements = assessmentQuestionPlacements(
                  afterTailCopy.parts[0].placements,
                );
                expect(afterTailPlacements.length).toStrictEqual(4);
                const tailCopy = afterTailPlacements[3];
                await casePage.locator(
                  `#assessment-question-${tailCopy.id}[data-authoring-card] [data-choice-id="A"]`,
                ).waitFor();
                await editSource();
                await casePage.locator(
                  `#assessment-question-${source.value.placementId} [data-choice-id="A"]`,
                ).waitFor();
                const activeCopy = casePage.locator(
                  `#assessment-question-${savedCopy.id}[data-authoring-card]`,
                );
                await duplicate.click();
                await activeCopy.waitFor();
                await activeCopy.locator('[data-choice-id="A"]').waitFor();
                expect(commands.length).toStrictEqual(3);
                expect(commands[2]).toStrictEqual(commands[0]);
                expect(responses[2]).toStrictEqual(responses[0]);
                expect(await getAssessment(ctx, assessment.id)).toStrictEqual(afterTailCopy);
                // Return to the same unchanged source and explicitly request a second independent copy.
                await editSource();
                await casePage.locator(
                  `#assessment-question-${source.value.placementId} [data-choice-id="A"]`,
                ).waitFor();
                await duplicate.click();
                await casePage.waitForFunction(() =>
                  document.querySelectorAll('article[id^="assessment-question-"]').length === 5
                );
                expect(commands.length).toStrictEqual(4);
                if (!(commands[3].requestId !== commands[0].requestId)) {
                  expect.unreachable('Expected commands[3].requestId !== commands[0].requestId');
                }
                const saved = await getAssessment(ctx, assessment.id);
                if (!saved) expect.unreachable('Expected saved');
                const placements = assessmentQuestionPlacements(saved.parts[0].placements);
                const independent = placements[1];
                if (!(independent.itemId !== savedCopy.itemId)) {
                  expect.unreachable('Expected independent.itemId !== savedCopy.itemId');
                }
                expect(placements.map((row) => row.id)).toStrictEqual([
                  source.value.placementId,
                  independent.id,
                  savedCopy.id,
                  tail.value.placementId,
                  tailCopy.id,
                ]);
                for (const placement of [savedCopy, independent]) {
                  const revision = await getQuestionRevision(ctx, placement.itemId, 1);
                  if (!revision) expect.unreachable('Expected revision');
                  expect(revision.body).toStrictEqual({
                    ...original.body,
                    preserveSourceXml: false,
                  });
                }
                expect(await getQuestionRevision(ctx, source.value.itemId, 1)).toStrictEqual(
                  original,
                );
                await casePage.reload();
                await casePage.getByRole('button', {
                  name: i18n.t('assessments.builder.editQuestion', {
                    number: '1.2',
                    title: draft.title,
                  }),
                  exact: true,
                }).click();
                await casePage.locator(
                  `#assessment-question-${independent.id}[data-authoring-card] [data-choice-id="A"]`,
                ).waitFor();
                expect(
                  await casePage.locator('article[id^="assessment-question-"]').evaluateAll(
                    (elements) => elements.map((element) => element.id),
                  ),
                ).toStrictEqual(placements.map((row) => `assessment-question-${row.id}`));
                if (
                  !(await casePage.evaluate(() =>
                    document.documentElement.scrollWidth <= innerWidth
                  ))
                ) {
                  expect.unreachable(
                    'Expected await casePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
                  );
                }
                expect(errors).toStrictEqual([]);
                if (locale === 'en-US') {
                  await casePage.screenshot({
                    path: evidence.path(`${label}.png`),
                    fullPage: true,
                  });
                }
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
          expect(completedCases.length).toStrictEqual(10);
          await _fs.writeFile(
            evidence.path('copy-retry-receipt.json'),
            JSON.stringify(
              {
                cases: completedCases,
                lostResponse: 'committed then aborted',
                requestsPerCase: 4,
                independentCopiesPerCase: 3,
              },
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

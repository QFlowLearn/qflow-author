import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import axe from 'axe-core';
import { sql } from 'drizzle-orm';
import { type Page } from 'playwright';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';
import {
  type BrowserLoadingEvidence,
  captureBrowserLoading,
  observeBrowserLoading,
} from './helpers/browser_loading.ts';

import { db, shutdownDb } from '../lib/db.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { assignOverviewFixture } from './helpers/enrichment_overview_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { assertNativeFormAccessibility } from './helpers/browser_form_accessibility.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { parseAdaptivePlanCommand } from '../lib/assessment_adaptive_plan.ts';
import { parseAdaptiveCoverage } from '../lib/assessment_adaptive_response.ts';

testCase('author builds, previews and reloads a frozen 100-answer adaptive assessment', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!(databaseUrl && /test/.test(new URL(databaseUrl).pathname))) {
    expect.unreachable('Expected databaseUrl && /test/.test(new URL(databaseUrl).pathname)');
  }
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      const assessment = await createAssessmentDraft(ctx, {
        title: 'Adaptive browser assessment',
      });
      let app: LocalAppBrowser | undefined;
      let failurePage: Page | undefined;
      let loading: BrowserLoadingEvidence | undefined;
      const evidence = await createBrowserEvidenceDirectory();
      try {
        const created = await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, {
          id: crypto.randomUUID(),
          schemeId: crypto.randomUUID(),
          expectedVersion: 0,
          definition: enrichmentDefinitionFixture(),
        });
        if (!(created.ok)) expect.unreachable('Expected created.ok');
        const ids = await addEnrichmentQuestions(ctx, 285);
        for (
          const [level, start, end] of [
            ['easy', 0, 100],
            ['moderate', 100, 195],
            ['hard', 195, 285],
          ] as const
        ) {
          await assignOverviewFixture(
            ctx,
            created.value.schemeId,
            created.value.id,
            ids.slice(start, end),
            { difficulty: { state: 'assigned', valueIds: [level] } },
          );
        }
        // Refresh planner statistics after bulk fixture insertion and predecessor cleanup.
        await db.execute(sql`ANALYZE questions, question_revisions,
            bank_enrichment_assignments, bank_enrichment_changes, question_review_requests`);
        await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
        const origin = process.env['QFLOW_ADAPTIVE_TEST_ORIGIN'];
        app = await openLocalAppBrowser({
          endpoint: origin ? { _tag: 'ExistingApp', baseUrl: origin } : {
            _tag: 'ManagedLocalApp',
            portRange: { first: 5281, lastExclusive: 5291 },
            environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
          },
          headless: true,
        });
        const browser: import('playwright').BrowserContext = await app.newContext({
          authSession: await createSession({ tenantId: ctx.tenantId, userId: ctx.userId }),
          browser: { viewport: { width: 1280, height: 900 } },
        });
        const page: import('playwright').Page = await browser.newPage();
        failurePage = page;
        loading = observeBrowserLoading(page, app.baseUrl, () => 'adaptive-builder');
        page.on('request', (request) => {
          if (new URL(request.url()).pathname.endsWith('/adaptive-plan')) {
            console.log(JSON.stringify({ event: 'adaptive_request', method: request.method() }));
          }
        });
        page.on('response', (response) => {
          if (new URL(response.url()).pathname.endsWith('/adaptive-plan')) {
            console.log(
              JSON.stringify({
                event: 'adaptive_response',
                method: response.request().method(),
                status: response.status(),
              }),
            );
          }
        });
        page.setDefaultTimeout(20000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
        await page.goto(`${app.baseUrl}/assessments/${assessment.id}?tool=assessment-plan`);
        await page.getByRole('heading', { name: 'Assessment plan', exact: true }).waitFor();
        await page.goto(`${app.baseUrl}/assessments/${assessment.id}`);
        await page.getByRole('button', { name: 'Adaptive assessment', exact: true }).click();
        await page.locator('select[name="scheme"]').selectOption(created.value.schemeId);
        await page.getByLabel('Category version', { exact: true }).selectOption(created.value.id);
        await page.getByLabel('Easiest', { exact: true }).selectOption('easy');
        await page.getByLabel('Middle', { exact: true }).selectOption('moderate');
        await page.getByLabel('Hardest', { exact: true }).selectOption('hard');
        await auditAdaptive(page, '[aria-labelledby=adaptive-setup-heading]');
        await page.getByRole('button', { name: 'Check coverage', exact: true }).click({
          trial: true,
        });
        const [coverageResponse] = await Promise.all([
          page.waitForResponse((response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === `/api/assessments/${assessment.id}/adaptive-plan`
          ),
          page.getByRole('button', { name: 'Check coverage', exact: true }).click(),
        ]);
        const rawCommand: unknown = coverageResponse.request().postDataJSON();
        const command = parseAdaptivePlanCommand(rawCommand);
        if (!(command?.kind === 'inspect')) {
          expect.unreachable("Expected command?.kind === 'inspect'");
        }
        expect(command.settings.questionCount).toStrictEqual(100);
        expect(command.settings.levelIds).toStrictEqual(['easy', 'moderate', 'hard']);
        expect(command.settings.versionId).toStrictEqual(created.value.id);
        expect(command.settings.query.enrichment?.schemeId).toStrictEqual(created.value.schemeId);
        expect(coverageResponse.status()).toStrictEqual(200);
        const rawCoverage: unknown = await coverageResponse.json();
        if (
          !(rawCoverage && typeof rawCoverage === 'object' && 'kind' in rawCoverage &&
            rawCoverage.kind === 'coverage' && 'coverage' in rawCoverage)
        ) {
          expect.unreachable(
            "Expected rawCoverage && typeof rawCoverage === 'object' && 'kind' in rawCoverage && rawCoverage.kin",
          );
        }
        const coverage = parseAdaptiveCoverage(rawCoverage.coverage);
        if (!coverage) expect.unreachable('Expected coverage');
        expect(coverage.levels.map(({ id, required, available }) => ({ id, required, available })))
          .toStrictEqual([
            { id: 'easy', required: 100, available: 100 },
            { id: 'moderate', required: 95, available: 95 },
            { id: 'hard', required: 90, available: 90 },
          ]);
        await page.getByRole('cell', { name: '100', exact: true }).first().waitFor();
        await page.getByRole('button', { name: 'Build assessment', exact: true }).click();
        await page.getByText('100 questions per learner · 285 questions available', {
          exact: true,
        }).waitFor();
        expect(await page.getByRole('button', { name: '+ Add question', exact: true }).count())
          .toStrictEqual(0);
        const frozen = (await getAssessment(ctx, assessment.id))?.adaptivePlan;
        if (!frozen) expect.unreachable('Expected frozen');
        await page.locator('#assessment-preview > summary').click();
        await page.getByText('Check difficulty changes', { exact: true }).click();
        await page.getByRole('button', { name: 'All correct', exact: true }).click();
        await page.getByText(
          '100 simulated answers. Consecutive blocks at the same difficulty are grouped.',
          { exact: true },
        ).waitFor();
        await page.locator('[aria-labelledby=adaptive-simulation-result-heading] > ol')
          .getByText('Questions 1–5: Easy', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Answer the draft', exact: true }).click();
        await page.getByText('Question 1 of 100', { exact: true }).waitFor();
        for (let index = 0; index < 6; index++) {
          await page.getByText(`Question ${index + 1} of 100`, { exact: true }).waitFor();
          await page.getByRole('radio', { name: /Nucleus/ }).check();
          await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
        }
        await page.getByText('Question 7 of 100', { exact: true }).waitFor();
        await page.getByRole('radio', { name: /Nucleus/ }).waitFor();
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: '/tmp/qflow-adaptive-answer-a11y.png', fullPage: true });
        await auditAdaptive(page, '[aria-labelledby=adaptive-answer-heading]');
        await page.getByRole('button', { name: 'Close preview', exact: true }).click();
        await page.reload();
        await page.getByText('100 questions per learner · 285 questions available', {
          exact: true,
        }).waitFor();
        expect((await getAssessment(ctx, assessment.id))?.adaptivePlan).toStrictEqual(frozen);
        const hardBlock = frozen.blocks.find((block) => block.level === 2);
        if (!hardBlock) expect.unreachable('Expected hardBlock');
        const target = `assessment-question-${hardBlock.placementIds[0]}`;
        await page.goto(`${app.baseUrl}/assessments/${assessment.id}#${target}`);
        await page.locator(`[id="${target}"]`).waitFor({ state: 'visible' });
        if (
          !(await page.locator(`[id="${target}"]`).evaluate((el) => el.closest('details')?.open))
        ) {
          expect.unreachable(
            'Expected await page.locator(`[id="${target}"]`).evaluate((el) => el.closest(\'details\')?.open)',
          );
        }
        await page.setViewportSize({ width: 390, height: 844 });
        if (
          !(await page.evaluate(() =>
            document.documentElement.scrollWidth <= globalThis.innerWidth
          ))
        ) {
          expect.unreachable(
            'Expected await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth)',
          );
        }
        await page.keyboard.press('Tab');
        if (!(await page.evaluate(() => document.activeElement !== document.body))) {
          expect.unreachable(
            'Expected await page.evaluate(() => document.activeElement !== document.body)',
          );
        }
        await page.screenshot({ path: '/tmp/qflow-adaptive-builder.png', fullPage: true });
        await page.goto(`${app.baseUrl}/assessments/${assessment.id}/arrange`, {
          waitUntil: 'networkidle',
        });
        await page.getByText(
          'This assessment uses an adaptive plan. Manage its selection and sequence on the assessment canvas.',
          { exact: true },
        ).waitFor();
        expect(await page.getByRole('button', { name: 'Part settings', exact: true }).count())
          .toStrictEqual(0);
        expect(await page.getByRole('checkbox').count()).toStrictEqual(0);
        const openCanvas = page.getByRole('link', { name: 'Open assessment', exact: true });
        expect(await openCanvas.getAttribute('href')).toStrictEqual(
          `/assessments/${assessment.id}`,
        );
        await assertNativeFormAccessibility(
          page,
          page.locator('#assessment-arrangement-managed'),
        );
        for (const width of [390, 1280]) {
          await page.setViewportSize({ width, height: 844 });
          if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
            expect.unreachable(
              'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
            );
          }
          await page.screenshot({ path: `/tmp/qflow-adaptive-arrange-managed-${width}.png` });
        }
        expect((await getAssessment(ctx, assessment.id))?.adaptivePlan).toStrictEqual(frozen);
        await openCanvas.click();
        await page.getByText('100 questions per learner · 285 questions available', {
          exact: true,
        }).waitFor();
        expect(errors).toStrictEqual([]);
        await browser.close();
      } catch (cause: unknown) {
        if (failurePage) {
          await captureBrowserFailure(failurePage, evidence, 'qflow-adaptive-builder');
        }
        if (loading) await captureBrowserLoading(loading, evidence, 'qflow-adaptive-builder');
        throw cause;
      } finally {
        loading?.stop();
        await app?.close();
        await deleteAssessment(ctx, assessment.id);
      }
    });
  } finally {
    await shutdownDb();
  }
});

async function auditAdaptive(page: import('playwright').Page, selector: string) {
  await page.locator(selector).evaluate(async (root) => {
    await Promise.all(
      root.getAnimations({ subtree: true }).filter((animation) =>
        animation.effect?.getComputedTiming().iterations !== Infinity
      ).map((animation) => animation.finished),
    );
  });
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async (selector) => {
    // The isolated test page has just loaded axe.source.
    const runner = (globalThis as unknown as { axe: typeof axe }).axe;
    const result = await runner.run(document.querySelector(selector)!, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    });
    return result.violations.filter((entry) =>
      entry.impact === 'serious' || entry.impact === 'critical'
    ).map((entry) => ({
      id: entry.id,
      nodes: entry.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })),
    }));
  }, selector);
  expect(violations).toStrictEqual([]);
}

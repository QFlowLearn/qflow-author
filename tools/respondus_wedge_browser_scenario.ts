import * as _fs from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';

import {
  parseAssessmentExportReceiptEvidence,
  verifyAssessmentExportReceiptArtifact,
} from '../lib/export/assessment_export_receipt_evidence.ts';
import {
  resolveAssessmentExportTarget,
  type SelectableAssessmentExportTarget,
} from '../lib/export/assessment_export_targets.ts';
import { getMigrationRun } from '../lib/import/migration_run_queries.ts';
import type { RequestContext } from '../lib/tenants.ts';
import type { LocalAppBrowser, LocalAppBrowserAuthSession } from './local_app_browser.ts';
import type {
  RespondusEvidenceTimings,
  RespondusExportEvidence,
} from './respondus_wedge_report.ts';
import { ASSESSMENT_TOOL_IDS, assessmentToolHref } from '../lib/assessment_authoring_tool.ts';

type EvidenceExportScenario = {
  readonly target: 'canvas-classic' | 'moodle';
  readonly screenshot: string;
  readonly artifact: string;
  readonly receipt: string;
};

type EvidenceExportTarget = Extract<
  SelectableAssessmentExportTarget,
  { readonly id: EvidenceExportScenario['target'] }
>;

/** Inputs required to exercise the complete Respondus browser workflow. */
export type RunRespondusWedgeBrowserScenarioInput = {
  readonly appBrowser: LocalAppBrowser;
  readonly outputDir: string;
  readonly fixturePath: string;
  readonly auth: RequestContext;
  readonly authSession: LocalAppBrowserAuthSession;
};

/** Source, workflow, export, and timing evidence captured by the browser workflow. */
export type RespondusWedgeBrowserScenarioResult = {
  readonly source: {
    readonly filename: string;
    readonly container: 'docx';
    readonly bytes: number;
    readonly adapter: string;
  };
  readonly workflow: {
    readonly recoveredItems: number;
    readonly acceptedItems: number;
    readonly blockedItems: number;
    readonly committedItems: number;
    readonly assessmentId: string;
  };
  readonly exports: readonly [RespondusExportEvidence, RespondusExportEvidence];
  readonly timings: Pick<
    RespondusEvidenceTimings,
    | 'browserIntakeMs'
    | 'browserReviewMs'
    | 'browserCommitMs'
    | 'canvasExportMs'
    | 'moodleExportMs'
  >;
};

const exportScenarios = [
  {
    target: 'canvas-classic',
    screenshot: '05-canvas-classic-preflight.png',
    artifact: 'word-visible-numbering-canvas-classic.zip',
    receipt: 'canvas-classic-receipt.json',
  },
  {
    target: 'moodle',
    screenshot: '06-moodle-preflight.png',
    artifact: 'word-visible-numbering-moodle.xml',
    receipt: 'moodle-receipt.json',
  },
] as const satisfies readonly EvidenceExportScenario[];

/** Exercises intake, review, commit, and both destination exports in one browser session. */
export async function runRespondusWedgeBrowserScenario(
  input: RunRespondusWedgeBrowserScenarioInput,
): Promise<RespondusWedgeBrowserScenarioResult> {
  const context = await input.appBrowser.newContext({
    browser: {
      acceptDownloads: true,
      viewport: { width: 1500, height: 1050 },
    },
    authSession: input.authSession,
  });
  const page = await context.newPage();
  try {
    const intakeStarted = performance.now();
    const runId = await captureDetectedWord(page, input);
    await waitForProcessedRun(input.auth, runId);
    const browserIntakeMs = roundedElapsed(intakeStarted);

    await capturePendingReview(page, input.appBrowser.baseUrl, input.outputDir, runId);
    const reviewStarted = performance.now();
    await acceptRecoveredItems(page);
    const browserReviewMs = roundedElapsed(reviewStarted);
    await page.screenshot({
      path: join(input.outputDir, '03-word-review-accepted.png'),
      fullPage: true,
    });

    const commitStarted = performance.now();
    const assessmentId = await commitAcceptedItems(page, runId);
    const browserCommitMs = roundedElapsed(commitStarted);
    await page.screenshot({
      path: join(input.outputDir, '04-committed-assessment.png'),
      fullPage: true,
    });

    await captureQaReport(context, input.appBrowser.baseUrl, input.outputDir, runId);

    const canvasStarted = performance.now();
    const canvas = await captureExport(
      page,
      context,
      input.appBrowser.baseUrl,
      input.outputDir,
      assessmentId,
      exportScenarios[0],
    );
    const canvasExportMs = roundedElapsed(canvasStarted);

    const moodleStarted = performance.now();
    const moodle = await captureExport(
      page,
      context,
      input.appBrowser.baseUrl,
      input.outputDir,
      assessmentId,
      exportScenarios[1],
    );
    const moodleExportMs = roundedElapsed(moodleStarted);

    const committed = await getMigrationRun(input.auth, runId);
    requireValue(committed, 'Committed migration run was not found.');
    return {
      source: {
        filename: committed.sourceFilename,
        container: 'docx',
        bytes: committed.sourceSize,
        adapter: `${committed.adapter.id}@${committed.adapter.version}`,
      },
      workflow: {
        recoveredItems: committed.items.length,
        acceptedItems: committed.reviewProgress.accepted,
        blockedItems: committed.summary.counts.blocked,
        committedItems: committed.items.filter((item) => item.createdQuestionId).length,
        assessmentId,
      },
      exports: [canvas, moodle],
      timings: {
        browserIntakeMs,
        browserReviewMs,
        browserCommitMs,
        canvasExportMs,
        moodleExportMs,
      },
    };
  } finally {
    await context.close();
  }
}

async function captureDetectedWord(
  page: Page,
  input: RunRespondusWedgeBrowserScenarioInput,
): Promise<string> {
  await page.goto(
    `${input.appBrowser.baseUrl}/assessments/new?intent=recover&source=respondus`,
    {
      waitUntil: 'domcontentloaded',
    },
  );
  const fileInput = page.locator('#bring-source-files');
  const accept = await fileInput.getAttribute('accept');
  requireValue(accept, 'Recovery file input did not expose an accept contract.');
  if (!accept.split(',').includes('.docx') || !accept.split(',').includes('.respondus')) {
    throw new Error(`Recovery file input does not accept Respondus Word sources: ${accept}`);
  }
  await fileInput.setInputFiles(input.fixturePath);
  const checkButton = page.getByRole('button', { name: 'Check source' });
  await page.waitForFunction(
    () => {
      const button = [...document.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.trim() === 'Check source'
      );
      return button instanceof HTMLButtonElement && !button.disabled;
    },
  );
  const inspectionResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/source-intake/inspect')
  );
  await checkButton.click();
  const inspectionResponse = await inspectionResponsePromise;
  if (!inspectionResponse.ok()) {
    throw new Error(
      `Source inspection returned HTTP ${inspectionResponse.status()}: ${await inspectionResponse
        .text()}`,
    );
  }
  await page.getByText('Respondus Standard Format', { exact: false }).waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  await page.screenshot({
    path: join(input.outputDir, '01-word-detected.png'),
    fullPage: true,
  });
  const executeResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/source-intake/execute')
  );
  await page.getByRole('button', { name: 'Continue to review' }).click();
  const executeResponse = await executeResponsePromise;
  if (executeResponse.status() !== 202) {
    throw new Error(
      `Source execution returned HTTP ${executeResponse.status()}: ${await executeResponse.text()}`,
    );
  }
  await page.waitForURL((url) => /^\/imports\/[^/]+$/.test(url.pathname), {
    waitUntil: 'domcontentloaded',
  });
  const runId = new URL(page.url()).pathname.split('/').at(-1);
  requireValue(runId, 'Browser intake did not open a Respondus migration run.');
  return runId;
}

async function waitForProcessedRun(auth: RequestContext, runId: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const run = await getMigrationRun(auth, runId);
    if (run?.execution._tag === 'Analyzed') return;
    if (run?.execution._tag === 'Failed') {
      throw new Error(`Respondus run ${runId} failed during browser intake.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Respondus run ${runId}.`);
}

async function capturePendingReview(
  page: Page,
  baseUrl: string,
  outputDir: string,
  runId: string,
): Promise<void> {
  await page.goto(`${baseUrl}/imports/${runId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Conversion review' }).waitFor();
  await page.screenshot({
    path: join(outputDir, '02-word-review-pending.png'),
    fullPage: true,
  });
}

async function acceptRecoveredItems(page: Page): Promise<void> {
  const itemCheckboxes = page.locator('input[type="checkbox"][name="itemId"]');
  const count = await itemCheckboxes.count();
  if (count !== 2) throw new Error(`Expected two recovered item checkboxes, received ${count}.`);
  for (let index = 0; index < count; index++) await itemCheckboxes.nth(index).check();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.getByRole('button', { name: 'Accept selected' }).click(),
  ]);
  const acceptedBadges = page.getByText('accepted', { exact: true });
  if (await acceptedBadges.count() !== 2) {
    throw new Error('Recovered questions were not both accepted.');
  }
}

async function commitAcceptedItems(page: Page, runId: string): Promise<string> {
  await page.getByLabel(
    'I reviewed the selected questions against their source evidence.',
  ).check();
  await Promise.all([
    page.waitForURL((url) => /^\/assessments\/[^/]+$/.test(url.pathname), {
      waitUntil: 'domcontentloaded',
    }),
    page.getByRole('button', { name: 'Commit selected questions' }).click(),
  ]);
  const assessmentId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  requireValue(assessmentId, `Commit from ${runId} did not return an assessment ID.`);
  return assessmentId;
}

async function captureQaReport(
  context: BrowserContext,
  baseUrl: string,
  outputDir: string,
  runId: string,
): Promise<void> {
  const response = await context.request.get(`${baseUrl}/imports/${runId}?download=qa-report`);
  requireStatus(response.status(), 200, 'migration QA report');
  await _fs.writeFile(
    join(outputDir, 'respondus-word-qa-report.md'),
    await response.text(),
    'utf8',
  );
}

async function captureExport(
  page: Page,
  context: BrowserContext,
  baseUrl: string,
  outputDir: string,
  assessmentId: string,
  scenario: EvidenceExportScenario,
): Promise<RespondusExportEvidence> {
  const target = resolveEvidenceExportTarget(scenario.target);
  const exportUrl = new URL(
    assessmentToolHref(assessmentId, ASSESSMENT_TOOL_IDS.export),
    baseUrl,
  );
  await page.goto(exportUrl.toString(), {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForLoadState('networkidle');
  await page.locator('#assessment-export-target').selectOption(target.id);
  await page.getByText(target.targetContractId, { exact: false }).waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  const exportSection = page.locator('#assessment-export');
  await exportSection.screenshot({ path: join(outputDir, scenario.screenshot) });
  await page.getByLabel('I reviewed the current export warnings').check();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download / }).click();
  const download = await downloadPromise;
  const artifactPath = join(outputDir, scenario.artifact);
  await download.saveAs(artifactPath);
  const artifactBytes = await _fs.readFile(artifactPath);

  const receiptLink = page.getByRole('link', { name: 'Download export receipt' });
  await receiptLink.waitFor({ state: 'visible' });
  const receiptHref = await receiptLink.getAttribute('href');
  requireValue(receiptHref, `${target.id} receipt link is missing its URL.`);
  const receiptResponse = await context.request.get(new URL(receiptHref, baseUrl).toString());
  requireStatus(receiptResponse.status(), 200, `${target.id} receipt`);
  const receiptText = await receiptResponse.text();
  const receiptJson = parseJson(receiptText, `${target.id} receipt`);
  const parsedReceipt = parseAssessmentExportReceiptEvidence(receiptJson);
  if (!parsedReceipt.ok) {
    throw new Error(
      `${target.id} receipt is invalid at ${parsedReceipt.error.path}: ${parsedReceipt.error.message}`,
    );
  }
  if (parsedReceipt.value.target.id !== target.id) {
    throw new Error(
      `${target.id} export returned a receipt for ${parsedReceipt.value.target.id}.`,
    );
  }
  if (download.suggestedFilename() !== parsedReceipt.value.package.filename) {
    throw new Error(`${target.id} download filename does not match its receipt.`);
  }
  const verifiedArtifact = await verifyAssessmentExportReceiptArtifact(
    parsedReceipt.value,
    artifactBytes,
  );
  if (!verifiedArtifact.ok) throw new Error(verifiedArtifact.error.message);
  await _fs.writeFile(join(outputDir, scenario.receipt), receiptText, 'utf8');

  const productImportEvidence = parsedReceipt.value.evidence.productImportEvidence._tag;
  if (
    productImportEvidence !== 'NotRecorded' ||
    parsedReceipt.value.evidence.profileReleaseEvidence !== 'NotRecorded'
  ) {
    throw new Error(`${target.id} evidence run expected unrecorded external product evidence.`);
  }

  return {
    target: target.id,
    targetContractId: target.targetContractId,
    artifact: scenario.artifact,
    artifactBytes: verifiedArtifact.value.byteLength,
    artifactSha256: verifiedArtifact.value.sha256,
    packageFilename: parsedReceipt.value.package.filename,
    receipt: scenario.receipt,
    receiptId: parsedReceipt.value.receiptId,
    screenshot: scenario.screenshot,
    warningCodes: parsedReceipt.value.packageDiagnosticCodes,
    profileReleaseEvidence: parsedReceipt.value.evidence.profileReleaseEvidence,
    productImportEvidence,
  };
}

function resolveEvidenceExportTarget(
  targetId: EvidenceExportScenario['target'],
): EvidenceExportTarget {
  const resolution = resolveAssessmentExportTarget(targetId);
  if (!resolution.ok) throw new Error(`Evidence target ${targetId} is not selectable.`);
  switch (resolution.target.id) {
    case 'canvas-classic':
    case 'moodle':
      return resolution.target;
    default:
      throw new Error(`Evidence target ${targetId} resolved to ${resolution.target.id}.`);
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause: unknown) {
    throw new Error(`${label} is not valid JSON.`, { cause });
  }
}

function requireStatus(actual: number, expected: number, label: string): void {
  if (actual !== expected) throw new Error(`${label} returned HTTP ${actual}.`);
}

function requireValue<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) throw new Error(message);
}

function roundedElapsed(started: number): number {
  return Math.round((performance.now() - started) * 10) / 10;
}

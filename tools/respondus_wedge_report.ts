import * as _fs from 'node:fs/promises';
import { join } from 'node:path';

/** Receipt-derived evidence for one destination artifact captured by the Respondus wedge. */
export type RespondusExportEvidence = {
  readonly target: 'canvas-classic' | 'moodle';
  readonly targetContractId: 'canvas-classic-quizzes@1' | 'moodle-xml@1';
  readonly artifact: string;
  readonly artifactBytes: number;
  readonly artifactSha256: string;
  readonly packageFilename: string;
  readonly receipt: string;
  readonly receiptId: string;
  readonly screenshot: string;
  readonly warningCodes: readonly string[];
  readonly profileReleaseEvidence: 'NotRecorded';
  readonly productImportEvidence: 'NotRecorded';
};

/** Timings recorded across setup, browser interaction, exports, and report generation. */
export type RespondusEvidenceTimings = {
  fixtureSetupMs: number;
  clientBuildMs: number;
  browserIntakeMs: number;
  browserReviewMs: number;
  browserCommitMs: number;
  canvasExportMs: number;
  moodleExportMs: number;
  totalMs: number;
};

/** Machine-readable evidence contract emitted by one complete Respondus wedge run. */
export type RespondusEvidenceMetrics = {
  readonly schema: 'qflow.respondus-wedge-evidence.v1';
  readonly capturedAt: string;
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
  readonly externalEvidence: {
    readonly microsoftWordOpen: 'NotRecorded';
    readonly canvasProductImport: 'NotRecorded';
    readonly moodleProductImport: 'NotRecorded';
  };
  readonly timings: Readonly<RespondusEvidenceTimings>;
};

/** Writes the machine-readable evidence record and its human-readable index. */
export async function writeRespondusWedgeReport(
  outputDir: string,
  metrics: RespondusEvidenceMetrics,
): Promise<void> {
  await Promise.all([
    _fs.writeFile(
      join(outputDir, 'evidence.json'),
      `${JSON.stringify(metrics, null, 2)}\n`,
      'utf8',
    ),
    _fs.writeFile(join(outputDir, 'README.md'), renderEvidenceIndex(metrics), 'utf8'),
  ]);
}

function renderEvidenceIndex(metrics: RespondusEvidenceMetrics): string {
  const [canvas, moodle] = metrics.exports;
  return [
    '# Respondus wedge evidence',
    '',
    'This run proves one QFlow session from Respondus-shaped Word detection through review,',
    'acceptance, commit, destination preflight, package download, and durable export receipt.',
    '',
    '## Evidence',
    '',
    '- `01-word-detected.png`: DOCX accepted by the recovery picker and identified as Respondus.',
    '- `02-word-review-pending.png`: source evidence beside two pending QTI 3.0 drafts.',
    '- `03-word-review-accepted.png`: explicit review decisions recorded.',
    '- `04-committed-assessment.png`: committed assessment created from accepted questions.',
    `- \`${canvas.screenshot}\`: Canvas Classic destination preflight.`,
    `- \`${moodle.screenshot}\`: Moodle destination preflight.`,
    `- \`${canvas.artifact}\` and \`${moodle.artifact}\`: verified destination artifacts.`,
    `- \`${canvas.receipt}\` and \`${moodle.receipt}\`: immutable export receipts.`,
    '- `respondus-word-qa-report.md`: recovery diagnostics and source evidence report.',
    '- `evidence.json`: receipt-derived hashes, diagnostics, counts, timings, and evidence status.',
    '',
    '## External product evidence',
    '',
    '- Microsoft Word open/import: `NotRecorded`.',
    '- Canvas product import: `NotRecorded`.',
    '- Moodle product import: `NotRecorded`.',
    '',
    'The receipts prove the local packages. They do not prove that Canvas or Moodle imported them.',
    'The receipt warnings preserve that distinction.',
    '',
    '## Metrics snapshot',
    '',
    '```json',
    JSON.stringify(metrics, null, 2),
    '```',
    '',
  ].join('\n');
}

import type { MigrationImportChecks } from './migration_import_checks.ts';
import { buildFidelitySummary } from './migration_analysis.ts';
import type { MigrationExactRepeats } from './migration_exact_repeats.ts';
import type {
  MigrationItemDecision,
  MigrationItemReadiness,
  MigrationRunRecord,
} from './migration_types.ts';
import type { MigrationExecutionState } from './migration_state.ts';
import type { ImportWarning } from './types.ts';
import {
  explainMigrationWarning,
  labelWarningSeverity,
  parseMigrationWarningCode,
} from './migration_warning_catalog.ts';

export function buildMigrationQaReport(
  run: MigrationRunRecord,
  generatedAt: Date = new Date(),
  exactRepeats?: MigrationExactRepeats,
  importChecks?: MigrationImportChecks,
): string {
  const fidelity = buildFidelitySummary(run.items);
  const lines: string[] = [];
  lines.push('# QFlowLearn Migration QA Report');
  lines.push('');
  lines.push(`Generated: ${generatedAt.toISOString()}`);
  lines.push('');
  lines.push('## Package');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(reportRow('Run ID', run.id));
  lines.push(reportRow('Source package', run.sourceFilename));
  lines.push(reportRow('Source size', `${run.sourceSize} bytes`));
  lines.push(reportRow('Detected format', run.adapter.label));
  lines.push(reportRow('Adapter ID', run.adapter.id));
  lines.push(reportRow('Status', labelRunStatus(run.execution)));
  lines.push(reportRow('Readiness', labelReadiness(run)));
  lines.push(reportRow('Created by', displayReportUser(run.creatorName, run.creatorEmail)));
  lines.push(reportRow('Created at', run.createdAt));
  if (run.execution._tag === 'Committed') {
    lines.push(reportRow('Committed at', run.execution.committedAt));
    lines.push(reportRow('Destination', run.execution.destination._tag));
    if (run.execution.destination._tag === 'Assessment') {
      lines.push(reportRow('Assessment ID', run.execution.destination.assessmentId));
    }
  }
  lines.push('');

  lines.push('## Fidelity & Compatibility Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('| --- | ---: |');
  lines.push(reportRow('Parts', run.summary.counts.parts));
  lines.push(reportRow('Items', run.summary.counts.items));
  lines.push(reportRow('Assets', run.summary.counts.assets));
  lines.push(reportRow('Ready items', run.summary.counts.ready));
  lines.push(reportRow('Items needing review', run.summary.counts.reviewNeeded));
  lines.push(reportRow('Blocked items', run.summary.counts.blocked));
  lines.push(reportRow('Semantic fidelity preserved', fidelity.semantic));
  lines.push(reportRow('Review required', fidelity.reviewRequired));
  lines.push(reportRow('Source XML preserved as stub', fidelity.sourcePreserved));
  lines.push(reportRow('Warnings', run.summary.counts.warnings));
  lines.push('');
  lines.push(`Fidelity stance: ${fidelityStance(run)}`);
  lines.push('');
  if (run.summary.sniff) {
    lines.push(
      `Detection confidence: ${Math.round(run.summary.sniff.confidence * 100)}%${
        run.summary.sniff.reason ? ` (${run.summary.sniff.reason})` : ''
      }`,
    );
    lines.push('');
  }

  if (importChecks) {
    lines.push('## Answer and media checks', '');
    lines.push(`Questions with recorded findings: ${importChecks.affected}.`, '');
    lines.push(
      'These are findings recorded during import, not a new validation of edits. Rejected questions are excluded. Package findings are separate from question counts.',
      '',
    );
    const labels = {
      answers: 'Missing answers or answer order',
      references: 'Answers referencing absent choices',
      media: 'Missing files or media needing attachment',
    };
    for (const group of importChecks.groups) {
      lines.push(
        `- ${labels[group.kind]}: ${group.count} ${
          group.count === 1 ? 'question' : 'questions'
        }; ${group.packageFindings} ${
          group.packageFindings === 1 ? 'package finding' : 'package findings'
        }.`,
      );
      if (group.members.length > 0) {
        lines.push(`  Questions: ${group.members.map((member) => member.position).join(', ')}.`);
      }
    }
    lines.push('');
  }
  if (exactRepeats) {
    lines.push('## Exact repeated content', '');
    lines.push(
      `Compared ${exactRepeats.compared} of ${exactRepeats.total} non-rejected questions. Additional copies: ${exactRepeats.repeats}.`,
      '',
    );
    lines.push(
      'Titles and source identities may differ. Content and scoring must match exactly. Edited or uncertain questions are not compared; questions are never merged or removed by this check.',
      '',
    );
    for (const group of exactRepeats.groups) {
      lines.push(
        `- ${group.count} copies: questions ${
          group.members.map((member) => member.position).join(', ')
        }.`,
      );
    }
    lines.push('');
  }
  lines.push('## QTI Fidelity Matrix');
  lines.push('');
  lines.push('| Standard | Import support | Fidelity posture | Package result |');
  lines.push('| --- | --- | --- | --- |');
  for (const row of qtiCompatibilityRows(run)) {
    lines.push(
      `| ${md(row.standard)} | ${md(row.support)} | ${md(row.fidelity)} | ${md(row.result)} |`,
    );
  }
  lines.push('');

  lines.push('## Review Progress');
  lines.push('');
  lines.push('| State | Count |');
  lines.push('| --- | ---: |');
  lines.push(reportRow('Accepted', run.reviewProgress.accepted));
  lines.push(reportRow('Pending', run.reviewProgress.pending));
  lines.push(reportRow('Rejected', run.reviewProgress.rejected));
  lines.push(reportRow('Total reviewed items', run.reviewProgress.total));
  lines.push('');
  lines.push(
    `Acceptance status: ${
      run.reviewProgress.total > 0 &&
        run.reviewProgress.pending === 0
        ? 'Complete'
        : 'Open'
    }`,
  );
  lines.push('');

  lines.push('## Warning Counts');
  lines.push('');
  const warningEntries = Object.entries(run.summary.warningCounts).map(
    ([code, count]) => [parseMigrationWarningCode(code), count] as const,
  );
  if (!warningEntries.length) {
    lines.push('No import warnings were recorded.');
  } else {
    lines.push('| Code | Count |');
    lines.push('| --- | ---: |');
    for (const [code, count] of warningEntries) lines.push(reportRow(code, count));
  }
  lines.push('');

  if (warningEntries.length) {
    lines.push('## Warning Guidance');
    lines.push('');
    lines.push('| Code | Count | Title | Severity | What this means | Suggested reviewer action |');
    lines.push('| --- | ---: | --- | --- | --- | --- |');
    for (const [code, count] of warningEntries) {
      const explanation = explainMigrationWarning(code);
      lines.push(
        [
          md(explanation.code),
          String(count),
          md(explanation.title),
          md(labelWarningSeverity(explanation.severity)),
          md(explanation.meaning),
          md(explanation.reviewAction),
        ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'),
      );
    }
    lines.push('');
  }

  lines.push('## Item Review Detail');
  lines.push('');
  if (!run.items.length) {
    lines.push('No items were recorded for this run.');
  } else {
    lines.push(
      '| # | Item | Source | Type | Import status | Fidelity | Review | Warnings | Suggested action | Reviewer note |',
    );
    lines.push('| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const item of run.items) {
      lines.push(
        [
          String(item.position),
          md(item.title),
          md(item.sourceHref || item.sourceIdentifier),
          md(item.itemTypeLabel),
          md(labelItemStatus(item.readiness)),
          md(labelFidelity(item.readiness)),
          md(labelReviewState(item.decision)),
          md(item.warnings.map((warning) => warning.code).join(', ') || 'None'),
          md(warningActionSummary(item.warnings)),
          md(item.reviewNote || ''),
        ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'),
      );
    }
  }
  lines.push('');

  const globalWarnings = run.summary.globalWarnings ?? [];
  if (globalWarnings.length) {
    lines.push('## Global Warnings');
    lines.push('');
    for (const warning of globalWarnings) {
      lines.push(`- ${md(warning.code)}: ${md(warning.message)}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
function qtiCompatibilityRows(run: MigrationRunRecord): Array<{
  standard: string;
  support: string;
  fidelity: string;
  result: string;
}> {
  return [
    {
      standard: 'QTI 1.2 / 1.2.1',
      support: 'Supported import to QFlowLearn/QTI 3.0',
      fidelity:
        'Semantic fidelity for supported item types; proprietary response processing may require review',
      result: run.adapter.id === 'qti12' ? 'Detected for this package' : 'Available',
    },
    {
      standard: 'QTI 2.0 / 2.1 / 2.2',
      support: 'Supported import to QFlowLearn/QTI 3.0',
      fidelity:
        'Semantic fidelity for supported item types; unsupported constructs are flagged before commit',
      result: run.adapter.id === 'qti21' ? 'Detected for this package' : 'Available',
    },
    {
      standard: 'QTI 3.0',
      support: 'Supported import and export target',
      fidelity:
        'QTI 3 package semantics preserved where item interactions map to QFlowLearn drivers',
      result: run.adapter.id === 'qti3' ? 'Detected for this package' : 'Available',
    },
  ];
}

function reportRow(label: string, value: string | number): string {
  return `| ${md(label)} | ${md(String(value))} |`;
}

function md(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function displayReportUser(name?: string | null, email?: string | null): string {
  if (name && email) return `${name} (${email})`;
  return name || email || 'Unknown';
}

function labelRunStatus(state: MigrationExecutionState): string {
  if (state._tag === 'Committed') return 'Committed';
  if (state._tag === 'Failed') return 'Failed';
  if (state._tag === 'Queued') return 'Queued';
  if (state._tag === 'Analyzing') return 'Analyzing';
  return 'Analyzed';
}

function labelReadiness(run: MigrationRunRecord): string {
  if (run.execution._tag === 'Failed') return 'Failed';
  if (run.execution._tag === 'Committed') return 'Committed';
  if (run.execution._tag === 'Queued' || run.execution._tag === 'Analyzing') {
    return 'Pending analysis';
  }
  return run.summary.counts.blocked > 0 ||
      run.summary.counts.reviewNeeded > 0 ||
      Boolean(run.summary.globalWarnings?.length)
    ? 'Needs review'
    : 'Ready';
}

function labelItemStatus(status: MigrationItemReadiness): string {
  if (status === 'ready') return 'Ready';
  if (status === 'minor_review') return 'Minor review';
  if (status === 'major_review') return 'Major review';
  return 'Blocked';
}

function labelFidelity(status: MigrationItemReadiness): string {
  if (status === 'ready') return 'Semantic fidelity preserved';
  if (status === 'blocked') return 'Blocked from commit';
  return 'Review required';
}

function warningActionSummary(warnings: ImportWarning[]): string {
  if (!warnings.length) return 'No warning-specific action needed.';
  const actions = [
    ...new Set(warnings.map((warning) => explainMigrationWarning(warning.code).reviewAction)),
  ];
  return actions.join(' ');
}

function fidelityStance(run: MigrationRunRecord): string {
  const summary = buildFidelitySummary(run.items);
  if (!summary.total) return 'No item-level fidelity result was recorded.';
  if (summary.sourcePreserved > 0) {
    return 'Some unsupported constructs were preserved as source XML with editable placeholders.';
  }
  if (summary.reviewRequired > 0) {
    return 'Supported content was imported, but one or more items require human verification.';
  }
  if (run.adapter.id === 'qti12' || run.adapter.id === 'qti21') {
    return 'Supported items were semantically preserved while being normalized to QFlowLearn/QTI 3.0.';
  }
  return 'Supported items were semantically preserved.';
}

function labelReviewState(state: MigrationItemDecision): string {
  if (state === 'accepted') return 'Accepted';
  if (state === 'rejected') return 'Rejected';
  return 'Pending';
}

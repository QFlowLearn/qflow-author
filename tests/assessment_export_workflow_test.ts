import { expect, test as testCase } from 'vitest';

import {
  createAssessmentExportWorkflow,
  reduceAssessmentExportWorkflow,
} from '../lib/client/assessment_export_workflow.ts';
import {
  parseAssessmentExportAcknowledgementToken,
  parseAssessmentExportPreflightId,
} from '../lib/export/assessment_export_http.ts';
import type { AssessmentExportPreflightView } from '../lib/export/assessment_export_preflight_client.ts';

const parsedPreflightId = parseAssessmentExportPreflightId('a'.repeat(64));
const parsedAcknowledgement = parseAssessmentExportAcknowledgementToken('b'.repeat(64));
if (!parsedPreflightId.ok || !parsedAcknowledgement.ok) {
  throw new Error('Static workflow fixture identities must be valid.');
}
const PREFLIGHT = {
  _tag: 'Evaluated',
  preflightId: parsedPreflightId.preflightId,
  destinationId: 'moodle',
  targetContractId: 'moodle-xml@1',
  overallOutcome: 'warning',
  items: [],
  packageDiagnosticCodes: ['product_import_evidence.not_recorded'],
  warningCodes: ['product_import_evidence.not_recorded'],
  acknowledgementToken: parsedAcknowledgement.acknowledgementToken,
  repairs: [],
  artifact: {
    filename: 'assessment.xml',
    mediaType: 'application/xml',
    byteLength: 42,
  },
} satisfies AssessmentExportPreflightView;

testCase('export workflow invalidates acknowledgement and download when selection changes', () => {
  const idle = createAssessmentExportWorkflow('revision-1');
  const loading = reduceAssessmentExportWorkflow(idle, {
    _tag: 'TargetSelected',
    targetId: 'moodle',
  });
  expect(loading._tag).toStrictEqual('Loading');
  if (loading._tag !== 'Loading') return;
  expect(loading.selection.requirements).toStrictEqual({
    scoring: 'manual-accepted',
    interaction: 'fallback-accepted',
  });
  const ready = reduceAssessmentExportWorkflow(loading, {
    _tag: 'PreflightLoaded',
    selection: loading.selection,
    preflight: PREFLIGHT,
  });
  const acknowledged = reduceAssessmentExportWorkflow(ready, {
    _tag: 'WarningsAcknowledged',
    accepted: true,
  });
  const repaired = reduceAssessmentExportWorkflow(acknowledged, {
    _tag: 'RepairAccepted',
    repair: {
      _tag: 'AcceptManualScoring',
      id: 'accept-manual-scoring',
      affectedItemIds: ['item-1'],
    },
  });

  expect(repaired).toStrictEqual({
    _tag: 'Loading',
    selection: {
      revisionFingerprint: 'revision-1',
      targetId: 'moodle',
      requirements: {
        scoring: 'manual-accepted',
        interaction: 'fallback-accepted',
      },
    },
  });
});

testCase('export workflow retains typed preflight and package failures without prose', () => {
  const loading = reduceAssessmentExportWorkflow(
    createAssessmentExportWorkflow('revision-1'),
    { _tag: 'TargetSelected', targetId: 'moodle' },
  );
  if (loading._tag !== 'Loading') throw new Error('Expected loading workflow.');
  const failed = reduceAssessmentExportWorkflow(loading, {
    _tag: 'PreflightFailed',
    selection: loading.selection,
    error: { code: 'PreflightFailed', diagnosticCode: 'PreflightStale' },
  });
  expect(failed._tag).toStrictEqual('Failed');
  if (failed._tag !== 'Failed') return;
  expect(failed.error).toStrictEqual({ code: 'PreflightFailed', diagnosticCode: 'PreflightStale' });

  const ready = reduceAssessmentExportWorkflow(loading, {
    _tag: 'PreflightLoaded',
    selection: loading.selection,
    preflight: PREFLIGHT,
  });
  const downloading = reduceAssessmentExportWorkflow(ready, { _tag: 'DownloadStarted' });
  const packageFailed = reduceAssessmentExportWorkflow(downloading, {
    _tag: 'DownloadFailed',
    failure: { code: 'PackageRejected', diagnosticCode: 'PreflightBlocked' },
  });
  expect(packageFailed._tag).toStrictEqual('Ready');
  if (packageFailed._tag === 'Ready') {
    expect(packageFailed.download).toStrictEqual({
      _tag: 'Failed',
      failure: { code: 'PackageRejected', diagnosticCode: 'PreflightBlocked' },
    });
  }
});

testCase('export workflow ignores typed stale preflight failure', () => {
  const first = reduceAssessmentExportWorkflow(
    createAssessmentExportWorkflow('revision-1'),
    { _tag: 'TargetSelected', targetId: 'moodle' },
  );
  if (first._tag !== 'Loading') throw new Error('Expected loading workflow.');
  const changed = reduceAssessmentExportWorkflow(first, {
    _tag: 'RevisionChanged',
    revisionFingerprint: 'revision-2',
  });
  expect(reduceAssessmentExportWorkflow(changed, {
    _tag: 'PreflightFailed',
    selection: first.selection,
    error: { code: 'InvalidPreflightResponse' },
  })).toStrictEqual(changed);
});

testCase('export workflow retains package request failures without prose', () => {
  const loading = reduceAssessmentExportWorkflow(
    createAssessmentExportWorkflow('revision-1'),
    { _tag: 'TargetSelected', targetId: 'moodle' },
  );
  if (loading._tag !== 'Loading') throw new Error('Expected loading workflow.');
  const ready = reduceAssessmentExportWorkflow(loading, {
    _tag: 'PreflightLoaded',
    selection: loading.selection,
    preflight: PREFLIGHT,
  });
  const failed = reduceAssessmentExportWorkflow(
    reduceAssessmentExportWorkflow(ready, { _tag: 'DownloadStarted' }),
    { _tag: 'DownloadFailed', failure: { code: 'PackageRequestFailed' } },
  );
  if (failed._tag !== 'Ready') throw new Error('Expected ready workflow.');
  expect(failed.download).toStrictEqual({
    _tag: 'Failed',
    failure: { code: 'PackageRequestFailed' },
  });
});

testCase('export workflow ignores stale preflight completion after a revision change', () => {
  const initial = reduceAssessmentExportWorkflow(
    createAssessmentExportWorkflow('revision-1'),
    { _tag: 'TargetSelected', targetId: 'moodle' },
  );
  if (initial._tag !== 'Loading') throw new Error('Expected loading workflow.');
  const changed = reduceAssessmentExportWorkflow(initial, {
    _tag: 'RevisionChanged',
    revisionFingerprint: 'revision-2',
  });
  const stale = reduceAssessmentExportWorkflow(changed, {
    _tag: 'PreflightLoaded',
    selection: initial.selection,
    preflight: PREFLIGHT,
  });

  expect(stale).toStrictEqual(changed);
});

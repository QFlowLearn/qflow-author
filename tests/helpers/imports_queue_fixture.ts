import type { MigrationRunListItem } from '../../lib/import/migration_types.ts';
import type { MigrationExecutionState } from '../../lib/import/migration_state.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../../lib/assessment_blueprint.ts';
export function run(
  input: {
    id: string;
    filename: string;
    status: 'queued' | 'analyzing' | 'analyzed' | 'failed' | 'committed' | 'needs_review';
  },
): MigrationRunListItem {
  return {
    id: input.id,
    batchId: `batch-${input.id}`,
    batchPosition: 1,
    purpose: 'recover_existing',
    createdBy: 'user-1',
    creatorEmail: 'author@example.test',
    creatorName: 'Author',
    sourceFilename: input.filename,
    sourceMime: 'application/zip',
    sourceSize: 1024,
    adapter: { id: 'qti21', label: 'QTI 2.1', version: '1' },
    destination: { _tag: 'Assessment', blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT },
    execution: execution(input.status),
    approval: { _tag: 'Draft' },
    summary: {
      counts: {
        parts: 0,
        items: input.status === 'analyzed' ? 3 : 0,
        assets: 0,
        warnings: input.status === 'failed' ? 1 : 0,
        ready: input.status === 'analyzed' ? 3 : 0,
        reviewNeeded: input.status === 'needs_review' ? 1 : 0,
        blocked: 0,
      },
      warningCounts: input.status === 'failed' ? { IMPORT_FAILED: 1 } : {},
      itemTypeCounts: {},
    },
    createdAt: '2026-04-26T20:00:00.000Z',
    updatedAt: '2026-04-26T20:00:00.000Z',
    reviewProgress: {
      total: 0,
      accepted: 0,
      pending: 0,
      rejected: 0,
    },
  };
}

function execution(
  status: 'queued' | 'analyzing' | 'analyzed' | 'failed' | 'committed' | 'needs_review',
): MigrationExecutionState {
  if (status === 'queued') {
    return { _tag: 'Queued', attempts: 0, maxAttempts: 3, lastFailure: null };
  }
  if (status === 'analyzing') {
    return {
      _tag: 'Analyzing',
      attempts: 1,
      maxAttempts: 3,
      startedAt: '2026-04-26T20:00:00.000Z',
    };
  }
  if (status === 'committed') {
    return {
      _tag: 'Committed',
      attempts: 1,
      maxAttempts: 3,
      completedAt: '2026-04-26T20:00:00.000Z',
      destination: { _tag: 'Assessment', assessmentId: 'assessment-sentinel' },
      committedAt: '2026-04-26T20:00:00.000Z',
    };
  }
  if (status === 'failed') {
    return {
      _tag: 'Failed',
      attempts: 1,
      maxAttempts: 3,
      failure: 'Package could not be analyzed.',
      completedAt: '2026-04-26T20:00:00.000Z',
    };
  }
  return {
    _tag: 'Analyzed',
    attempts: 1,
    maxAttempts: 3,
    completedAt: '2026-04-26T20:00:00.000Z',
  };
}

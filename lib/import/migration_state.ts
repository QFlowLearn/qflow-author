import type { MigrationCommittedDestination } from './migration_destination.ts';
import {
  parseNonEmptyString,
  parseNonNegativeInteger,
  parseOptionalNonEmptyString,
  parsePositiveInteger,
  parseTimestamp,
  parseUuid,
} from '../persistence_parse.ts';

/** Worker-owned execution states for one migration run. */
export type MigrationExecutionState =
  | {
    readonly _tag: 'Queued';
    readonly attempts: number;
    readonly maxAttempts: number;
    readonly lastFailure: string | null;
  }
  | {
    readonly _tag: 'Analyzing';
    readonly attempts: number;
    readonly maxAttempts: number;
    readonly startedAt: string;
  }
  | {
    readonly _tag: 'Analyzed';
    readonly attempts: number;
    readonly maxAttempts: number;
    readonly completedAt: string;
  }
  | {
    readonly _tag: 'Failed';
    readonly attempts: number;
    readonly maxAttempts: number;
    readonly failure: string;
    readonly completedAt: string;
  }
  | {
    readonly _tag: 'Committed';
    readonly attempts: number;
    readonly maxAttempts: number;
    readonly completedAt: string;
    readonly destination: MigrationCommittedDestination;
    readonly committedAt: string;
  };

/** Human approval states for one migration run. */
export type MigrationApprovalState =
  | { readonly _tag: 'Draft' }
  | {
    readonly _tag: 'Submitted';
    readonly submittedBy: string;
    readonly submittedAt: string;
  }
  | {
    readonly _tag: 'Approved';
    readonly submittedBy: string;
    readonly submittedAt: string;
    readonly decidedBy: string;
    readonly decidedAt: string;
    readonly note: string | null;
  }
  | {
    readonly _tag: 'ChangesRequested';
    readonly submittedBy: string;
    readonly submittedAt: string;
    readonly decidedBy: string;
    readonly decidedAt: string;
    readonly note: string;
  };

type DraftApproval = Extract<MigrationApprovalState, { readonly _tag: 'Draft' }>;
type ApprovedApproval = Extract<MigrationApprovalState, { readonly _tag: 'Approved' }>;
type PreReviewExecution = Extract<
  MigrationExecutionState,
  { readonly _tag: 'Queued' | 'Analyzing' | 'Failed' }
>;
type AnalyzedExecution = Extract<MigrationExecutionState, { readonly _tag: 'Analyzed' }>;
type CommittedExecution = Extract<MigrationExecutionState, { readonly _tag: 'Committed' }>;

/** Valid combined execution, approval, and purpose states for one migration run. */
export type MigrationWorkflowState =
  | {
    readonly purpose: 'generate_new';
    readonly execution: MigrationExecutionState;
    readonly approval: DraftApproval;
  }
  | {
    readonly purpose: 'recover_existing';
    readonly execution: PreReviewExecution;
    readonly approval: DraftApproval;
  }
  | {
    readonly purpose: 'recover_existing';
    readonly execution: AnalyzedExecution;
    readonly approval: MigrationApprovalState;
  }
  | {
    readonly purpose: 'recover_existing';
    readonly execution: CommittedExecution;
    readonly approval: ApprovedApproval;
  };

/** Flat persistence fields required to reconstruct an execution state. */
export type MigrationExecutionRow = {
  readonly status: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly leaseToken: string | null;
  readonly lastError: string | null;
  readonly startedAt: Date | string | null;
  readonly completedAt: Date | string | null;
  readonly destination: string;
  readonly collectionId: string | null;
  readonly assessmentId: string | null;
  readonly committedAt: Date | string | null;
};

/** Flat persistence fields required to reconstruct an approval state. */
export type MigrationApprovalRow = {
  readonly approvalStatus: string;
  readonly submittedBy: string | null;
  readonly submittedAt: Date | string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | string | null;
  readonly approvalNote: string | null;
};

/** Parse one persisted execution row and reject contradictory state. */
export function parseMigrationExecutionState(
  row: MigrationExecutionRow,
): MigrationExecutionState {
  const attempts = parseNonNegativeInteger(row.attempts, 'Migration attempts are invalid.');
  const maxAttempts = parsePositiveInteger(
    row.maxAttempts,
    'Migration maximum attempts are invalid.',
  );
  if (attempts > maxAttempts) {
    throw new Error('Migration attempts exceed the configured maximum.');
  }

  switch (row.status) {
    case 'queued':
      assertAbsent(row.leaseToken, 'Queued migration cannot retain a lease.');
      assertAbsent(row.startedAt, 'Queued migration cannot retain a start time.');
      assertAbsent(row.completedAt, 'Queued migration cannot retain a completion time.');
      assertUncommitted(row);
      return {
        _tag: 'Queued',
        attempts,
        maxAttempts,
        lastFailure: parseOptionalNonEmptyString(
          row.lastError,
          'Queued migration failure summary cannot be empty.',
        ),
      };
    case 'analyzing':
      assertAbsent(row.lastError, 'Active migration cannot retain a failure summary.');
      assertAbsent(row.completedAt, 'Active migration cannot retain a completion time.');
      assertUncommitted(row);
      return {
        _tag: 'Analyzing',
        attempts,
        maxAttempts,
        startedAt: parseActiveState(row).startedAt,
      };
    case 'analyzed':
      assertInactive(row);
      assertUncommitted(row);
      return {
        _tag: 'Analyzed',
        attempts,
        maxAttempts,
        completedAt: parseTimestamp(
          row.completedAt,
          'Analyzed migration completion time is invalid.',
        ),
      };
    case 'failed':
      assertAbsent(row.leaseToken, 'Failed migration cannot retain a lease.');
      assertAbsent(row.startedAt, 'Failed migration cannot retain a start time.');
      assertAbsent(row.assessmentId, 'Failed migration cannot reference an assessment.');
      assertAbsent(row.committedAt, 'Failed migration cannot retain a commit time.');
      return {
        _tag: 'Failed',
        attempts,
        maxAttempts,
        failure: parseNonEmptyString(
          row.lastError,
          'Failed migration is missing its safe failure summary.',
        ),
        completedAt: parseTimestamp(
          row.completedAt,
          'Failed migration completion time is invalid.',
        ),
      };
    case 'committed':
      assertInactive(row);
      return {
        _tag: 'Committed',
        attempts,
        maxAttempts,
        completedAt: parseTimestamp(
          row.completedAt,
          'Committed migration completion time is invalid.',
        ),
        destination: parseCommittedDestination(row),
        committedAt: parseTimestamp(
          row.committedAt,
          'Committed migration commit time is invalid.',
        ),
      };
    default:
      throw new Error(`Invalid migration execution status: ${row.status}`);
  }
}

/** Parse one persisted approval row and reject contradictory state. */
export function parseMigrationApprovalState(
  row: MigrationApprovalRow,
): MigrationApprovalState {
  switch (row.approvalStatus) {
    case 'draft':
      assertApprovalDecisionAbsent(row);
      assertAbsent(row.submittedBy, 'Draft migration cannot retain a submitter.');
      assertAbsent(row.submittedAt, 'Draft migration cannot retain a submission time.');
      return { _tag: 'Draft' };
    case 'submitted':
      assertDecisionAbsent(row);
      return {
        _tag: 'Submitted',
        submittedBy: parseUuid(row.submittedBy, 'Migration submitter is invalid.'),
        submittedAt: parseTimestamp(
          row.submittedAt,
          'Migration submission time is invalid.',
        ),
      };
    case 'approved':
      return {
        _tag: 'Approved',
        ...parseDecisionMetadata(row),
        note: parseOptionalNonEmptyString(
          row.approvalNote,
          'Migration approval note cannot be empty.',
        ),
      };
    case 'changes_requested':
      return {
        _tag: 'ChangesRequested',
        ...parseDecisionMetadata(row),
        note: parseNonEmptyString(
          row.approvalNote,
          'A requested change must explain what needs attention.',
        ),
      };
    default:
      throw new Error(`Invalid migration approval status: ${row.approvalStatus}`);
  }
}

/** Parse one persisted run and reject invalid combinations across its workflow fields. */
export function parseMigrationWorkflowState(
  row: MigrationExecutionRow & MigrationApprovalRow,
  purpose: unknown,
): MigrationWorkflowState {
  const execution = parseMigrationExecutionState(row);
  const approval = parseMigrationApprovalState(row);
  if (purpose === 'generate_new') {
    if (approval._tag !== 'Draft') {
      throw new Error('Generate-from-source runs cannot enter migration approval.');
    }
    return { purpose, execution, approval };
  }
  if (purpose !== 'recover_existing') {
    throw new Error('Migration run purpose is invalid.');
  }

  switch (execution._tag) {
    case 'Queued':
    case 'Analyzing':
    case 'Failed':
      if (approval._tag !== 'Draft') {
        throw new Error('Queued, active, and failed migration runs must keep draft approval.');
      }
      return { purpose, execution, approval };
    case 'Analyzed':
      return { purpose, execution, approval };
    case 'Committed':
      if (approval._tag !== 'Approved') {
        throw new Error('A committed recovery run must retain its approval.');
      }
      return { purpose, execution, approval };
  }
}

/** Return the persisted status represented by an execution state. */
export function migrationExecutionStatus(
  state: MigrationExecutionState,
): 'queued' | 'analyzing' | 'analyzed' | 'failed' | 'committed' {
  switch (state._tag) {
    case 'Queued':
      return 'queued';
    case 'Analyzing':
      return 'analyzing';
    case 'Analyzed':
      return 'analyzed';
    case 'Failed':
      return 'failed';
    case 'Committed':
      return 'committed';
  }
}

/** Return the persisted status represented by an approval state. */
export function migrationApprovalStatus(
  state: MigrationApprovalState,
): 'draft' | 'submitted' | 'approved' | 'changes_requested' {
  switch (state._tag) {
    case 'Draft':
      return 'draft';
    case 'Submitted':
      return 'submitted';
    case 'Approved':
      return 'approved';
    case 'ChangesRequested':
      return 'changes_requested';
  }
}

/** Return the exact persistence projection for a draft approval state. */
export function draftApprovalColumns(): {
  readonly approvalStatus: 'draft';
  readonly submittedBy: null;
  readonly submittedAt: null;
  readonly decidedBy: null;
  readonly decidedAt: null;
  readonly approvalNote: null;
} {
  return {
    approvalStatus: 'draft',
    submittedBy: null,
    submittedAt: null,
    decidedBy: null,
    decidedAt: null,
    approvalNote: null,
  };
}

function parseDecisionMetadata(row: MigrationApprovalRow): {
  readonly submittedBy: string;
  readonly submittedAt: string;
  readonly decidedBy: string;
  readonly decidedAt: string;
} {
  return {
    submittedBy: parseUuid(row.submittedBy, 'Migration submitter is invalid.'),
    submittedAt: parseTimestamp(row.submittedAt, 'Migration submission time is invalid.'),
    decidedBy: parseUuid(row.decidedBy, 'Migration reviewer is invalid.'),
    decidedAt: parseTimestamp(row.decidedAt, 'Migration decision time is invalid.'),
  };
}

function parseActiveState(row: MigrationExecutionRow): { readonly startedAt: string } {
  parseUuid(row.leaseToken, 'Active migration lease is invalid.');
  return {
    startedAt: parseTimestamp(row.startedAt, 'Active migration start time is invalid.'),
  };
}

function assertInactive(row: MigrationExecutionRow): void {
  assertAbsent(row.leaseToken, 'Terminal migration cannot retain a lease.');
  assertAbsent(row.lastError, 'Successful migration cannot retain a failure summary.');
  parseTimestamp(row.completedAt, 'Migration completion time is invalid.');
}

function assertUncommitted(row: MigrationExecutionRow): void {
  assertAbsent(row.assessmentId, 'Uncommitted migration cannot reference an assessment.');
  assertAbsent(row.committedAt, 'Uncommitted migration cannot retain a commit time.');
}

function assertApprovalDecisionAbsent(row: MigrationApprovalRow): void {
  assertDecisionAbsent(row);
  assertAbsent(row.approvalNote, 'Draft migration cannot retain an approval note.');
}

function assertDecisionAbsent(row: MigrationApprovalRow): void {
  assertAbsent(row.decidedBy, 'Undecided migration cannot retain a reviewer.');
  assertAbsent(row.decidedAt, 'Undecided migration cannot retain a decision time.');
  assertAbsent(row.approvalNote, 'Undecided migration cannot retain an approval note.');
}

function assertAbsent(value: unknown, message: string): void {
  if (value !== null && value !== undefined) throw new Error(message);
}

function parseCommittedDestination(row: MigrationExecutionRow): MigrationCommittedDestination {
  if (row.destination === 'WorkspaceBank' && row.assessmentId === null) {
    return {
      _tag: 'WorkspaceBank',
      collectionId: row.collectionId === null
        ? null
        : parseUuid(row.collectionId, 'Invalid committed collection ID.'),
    };
  }
  if (row.destination === 'Assessment' && row.collectionId === null) {
    return {
      _tag: 'Assessment',
      assessmentId: parseUuid(row.assessmentId, 'Committed migration assessment ID is invalid.'),
    };
  }
  throw new Error('Invalid committed conversion destination.');
}

import { canonicalJsonStringify } from '../canonical_json.ts';
import type { MaterializedAssessmentExportArtifact } from '../export/assessment_export_artifact.ts';
import type { AssessmentExportFinalReceiptId } from '../export/assessment_export_final_receipt.ts';
import {
  type AssessmentExportRequirementSelection,
  parseAssessmentExportFinalReceiptId,
} from '../export/assessment_export_http.ts';
import type {
  AssessmentExportAcknowledgementToken,
  AssessmentExportPreflightId,
} from '../export/assessment_export_preflight.ts';
import { parseHttpsOrigin } from '../http_url.ts';
import { sha256Hex } from '../sha256.ts';
import { parseCanonicalUuid } from '../uuid.ts';
import {
  type CanvasConnectionId,
  type CanvasPublishTargetId,
  parseCanvasConnectionId,
} from './canvas_connection_types.ts';

declare const canvasPublishIdBrand: unique symbol;
declare const canvasCourseIdBrand: unique symbol;
declare const canvasQuestionBankIdBrand: unique symbol;
declare const canvasQuestionBankNameBrand: unique symbol;
declare const canvasPublishTerminalCursorTokenBrand: unique symbol;

/** Client-issued UUID that is also the durable idempotency identity of one Canvas publish. */
export type CanvasPublishId = string & {
  readonly [canvasPublishIdBrand]: 'CanvasPublishId';
};

/** Parsed opaque Canvas course or SIS course identifier. */
export type CanvasCourseId = string & {
  readonly [canvasCourseIdBrand]: 'CanvasCourseId';
};

/** Parsed numeric Canvas question-bank identifier. */
export type CanvasQuestionBankId = string & {
  readonly [canvasQuestionBankIdBrand]: 'CanvasQuestionBankId';
};

/** Parsed author-visible Canvas question-bank name. */
export type CanvasQuestionBankName = string & {
  readonly [canvasQuestionBankNameBrand]: 'CanvasQuestionBankName';
};

/** Canonical opaque token for terminal Canvas publish pagination. */
export type CanvasPublishTerminalCursorToken = string & {
  readonly [canvasPublishTerminalCursorTokenBrand]: 'CanvasPublishTerminalCursorToken';
};

/** Stable terminal-history position ordered by creation time and publish identity. */
export type CanvasPublishTerminalCursor = {
  readonly createdAt: Date;
  readonly publishId: CanvasPublishId;
};

/** Canvas destination selected explicitly by the author. */
export type CanvasPublishDestination =
  | {
    readonly _tag: 'Course';
    readonly courseId: CanvasCourseId;
  }
  | {
    readonly _tag: 'QuestionBank';
    readonly courseId: CanvasCourseId;
    readonly bank:
      | { readonly _tag: 'Existing'; readonly questionBankId: CanvasQuestionBankId }
      | { readonly _tag: 'New'; readonly questionBankName: CanvasQuestionBankName };
  };

/** Validated author request for one exact Canvas artifact and destination. */
export type CanvasPublishRequest = {
  readonly connectionId: CanvasConnectionId;
  readonly targetId: CanvasPublishTargetId;
  readonly destination: CanvasPublishDestination;
  readonly preflightId: AssessmentExportPreflightId;
  readonly acknowledgementToken: AssessmentExportAcknowledgementToken | null;
  readonly selection: AssessmentExportRequirementSelection;
};

/** Immutable configured connection facts bound to one Canvas publish. */
export type CanvasConnectionSnapshot = {
  readonly id: CanvasConnectionId;
  readonly name: string;
  readonly baseUrl: string;
};

/** Recorded Canvas migration identity used for upload and progress recovery. */
export type CanvasPublishRemote = {
  readonly contentMigrationId: string;
  readonly progressUrl: string;
  readonly workflowState: string | null;
};

/** Bounded ownership of one active Canvas transition. */
export type CanvasPublishLease = {
  readonly token: string;
  readonly expiresAt: Date;
};

/** Safe classified failure retained as publish evidence. */
export type CanvasPublishFailure = {
  readonly code: string;
  readonly message: string;
};

/** Author-recorded outcome after checking Canvas for an uncertain migration create. */
export type CanvasRemoteIdentityResolution = {
  readonly outcome: 'import-found' | 'import-not-found';
  readonly resolvedBy: string;
  readonly resolvedAt: Date;
};

/** Persistence phases used by the Canvas publish state machine. */
export type CanvasPublishPhase =
  | 'prepared'
  | 'claiming-create'
  | 'creating'
  | 'uploading'
  | 'observing'
  | 'processing'
  | 'retry-create'
  | 'retry-upload'
  | 'retry-observe'
  | 'remote-identity-unknown'
  | 'remote-identity-resolved'
  | 'failed'
  | 'published';

/** Lease-owned phases in which one worker may contact Canvas. */
export type ActiveCanvasPublishPhase =
  | 'claiming-create'
  | 'creating'
  | 'uploading'
  | 'observing';

/** Canonical claim, ownership, and retry policy for one Canvas operation. */
export type CanvasPublishOperationPolicy = {
  readonly operation: string;
  readonly sourcePhases: readonly CanvasPublishPhase[];
  readonly activePhase: ActiveCanvasPublishPhase;
  readonly ownedPhases: readonly ActiveCanvasPublishPhase[];
  readonly retryPhase: CanvasPublishPhase;
};

/** Ordered operations and their canonical claim, ownership, and retry transitions. */
export const CANVAS_PUBLISH_OPERATION_POLICIES = [
  {
    operation: 'Create',
    sourcePhases: ['prepared', 'retry-create', 'claiming-create'],
    activePhase: 'claiming-create',
    ownedPhases: ['claiming-create', 'creating'],
    retryPhase: 'retry-create',
  },
  {
    operation: 'Upload',
    sourcePhases: ['retry-upload', 'uploading'],
    activePhase: 'uploading',
    ownedPhases: ['uploading'],
    retryPhase: 'retry-upload',
  },
  {
    operation: 'Observe',
    sourcePhases: ['processing', 'retry-observe', 'observing'],
    activePhase: 'observing',
    ownedPhases: ['observing'],
    retryPhase: 'retry-observe',
  },
] as const satisfies readonly CanvasPublishOperationPolicy[];

/** Explicit resumable Canvas operation derived from the ordered policy source. */
export type CanvasPublishOperation = typeof CANVAS_PUBLISH_OPERATION_POLICIES[number]['operation'];

/** Phases that must remain discoverable regardless of terminal-history pagination. */
export const CANVAS_PUBLISH_ACTION_REQUIRED_PHASES = [
  'prepared',
  'claiming-create',
  'creating',
  'uploading',
  'observing',
  'processing',
  'retry-create',
  'retry-upload',
  'retry-observe',
  'remote-identity-unknown',
] as const satisfies readonly CanvasPublishPhase[];

/** Terminal phases shown through bounded, cursor-paginated history. */
export const CANVAS_PUBLISH_TERMINAL_PHASES = [
  'remote-identity-resolved',
  'failed',
  'published',
] as const satisfies readonly CanvasPublishPhase[];

/** Returns the canonical transition policy for one derived Canvas operation. */
export function canvasPublishOperationPolicy(
  operation: CanvasPublishOperation,
): CanvasPublishOperationPolicy {
  const policy = CANVAS_PUBLISH_OPERATION_POLICIES.find((candidate) =>
    candidate.operation === operation
  );
  if (!policy) throw new Error('Canvas publish operation policy is missing.');
  return policy;
}

/** Legal durable phases of one Canvas publish operation. */
export type CanvasPublishState =
  | { readonly _tag: 'Prepared' }
  | { readonly _tag: 'ClaimingCreate'; readonly lease: CanvasPublishLease }
  | {
    readonly _tag: 'Creating';
    readonly lease: CanvasPublishLease;
    readonly startedAt: Date;
  }
  | {
    readonly _tag: 'Uploading';
    readonly lease: CanvasPublishLease;
    readonly remote: CanvasPublishRemote;
  }
  | {
    readonly _tag: 'Observing';
    readonly lease: CanvasPublishLease;
    readonly remote: CanvasPublishRemote;
  }
  | { readonly _tag: 'Processing'; readonly remote: CanvasPublishRemote }
  | { readonly _tag: 'RetryCreate'; readonly failure: CanvasPublishFailure }
  | {
    readonly _tag: 'RetryUpload';
    readonly failure: CanvasPublishFailure;
    readonly remote: CanvasPublishRemote;
  }
  | {
    readonly _tag: 'RetryObserve';
    readonly failure: CanvasPublishFailure;
    readonly remote: CanvasPublishRemote;
  }
  | {
    readonly _tag: 'RemoteIdentityUnknown';
    readonly failure: CanvasPublishFailure;
    readonly startedAt: Date;
  }
  | {
    readonly _tag: 'RemoteIdentityResolved';
    readonly failure: CanvasPublishFailure;
    readonly startedAt: Date;
    readonly resolution: CanvasRemoteIdentityResolution;
  }
  | {
    readonly _tag: 'Failed';
    readonly failure: CanvasPublishFailure;
    readonly remote: CanvasPublishRemote | null;
    readonly remoteCreationStartedAt: Date | null;
  }
  | {
    readonly _tag: 'Published';
    readonly remote: CanvasPublishRemote;
    readonly receipt: CanvasPublishReceipt;
    readonly publishedAt: Date;
  };

/** Durable Canvas-specific aggregate reconstructed at the persistence boundary. */
export type CanvasPublishAttempt = {
  readonly id: CanvasPublishId;
  readonly tenantId: string;
  readonly assessmentId: string;
  readonly createdBy: string;
  readonly connection: CanvasConnectionSnapshot;
  readonly targetId: CanvasPublishTargetId;
  readonly destination: CanvasPublishDestination;
  readonly requestFingerprint: string;
  readonly exportReceiptId: AssessmentExportFinalReceiptId;
  readonly artifact: MaterializedAssessmentExportArtifact;
  readonly attemptCount: number;
  readonly state: CanvasPublishState;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** Immutable receipt created only after Canvas reports the import completed. */
export type CanvasPublishReceipt = {
  readonly schema: 'qflow.canvas-publish-receipt.v1';
  readonly publishId: CanvasPublishId;
  readonly exportReceiptId: AssessmentExportFinalReceiptId;
  readonly assessmentId: string;
  readonly publishedBy: string;
  readonly connection: CanvasConnectionSnapshot & { readonly provider: 'canvas' };
  readonly targetId: CanvasPublishTargetId;
  readonly destination: CanvasPublishDestination;
  readonly artifact: Omit<MaterializedAssessmentExportArtifact, 'storageKey'>;
  readonly remote: {
    readonly contentMigrationId: string;
    readonly workflowState: 'completed';
  };
  readonly attemptCount: number;
  readonly publishedAt: string;
};

/** Parses the required Idempotency-Key header as the Canvas publish identity. */
export function parseCanvasPublishId(input: unknown): CanvasPublishId | null {
  const parsed = parseCanonicalUuid(input);
  if (!parsed) return null;
  // SAFETY: parseCanonicalUuid established the Canvas publish identity invariant.
  return parsed as CanvasPublishId;
}

/** Parses one bounded opaque Canvas course or SIS course identifier. */
function parseCanvasCourseId(input: unknown): CanvasCourseId | null {
  if (typeof input !== 'string') return null;
  const courseId = input.trim();
  if (courseId.length === 0 || courseId.length > 255) return null;
  if (hasControlCharacter(courseId)) return null;
  // SAFETY: Length, surrounding whitespace, and control-character invariants are established above.
  return courseId as CanvasCourseId;
}

/** Parses one numeric Canvas question-bank identifier. */
function parseCanvasQuestionBankId(input: unknown): CanvasQuestionBankId | null {
  if (typeof input !== 'string' || !/^[0-9]{1,30}$/.test(input)) return null;
  // SAFETY: The numeric Canvas question-bank identity invariant is established above.
  return input as CanvasQuestionBankId;
}

/** Parses one bounded author-visible Canvas question-bank name. */
function parseCanvasQuestionBankName(input: unknown): CanvasQuestionBankName | null {
  if (typeof input !== 'string') return null;
  const name = input.trim();
  if (name.length === 0 || name.length > 255 || hasControlCharacter(name)) return null;
  // SAFETY: Length, surrounding whitespace, and control-character invariants are established above.
  return name as CanvasQuestionBankName;
}

/** Parses the canonical Canvas destination representation used by domain and storage values. */
export function parseCanvasPublishDestination(input: unknown): CanvasPublishDestination | null {
  const record = asRecord(input);
  const courseId = parseCanvasCourseId(record?.courseId);
  if (!record || courseId === null) return null;
  if (record._tag === 'Course' && hasOnlyKeys(record, ['_tag', 'courseId'])) {
    return { _tag: 'Course', courseId };
  }
  if (
    record._tag !== 'QuestionBank' || !hasOnlyKeys(record, ['_tag', 'courseId', 'bank'])
  ) return null;
  const bank = asRecord(record.bank);
  if (!bank) return null;
  const questionBankId = parseCanvasQuestionBankId(bank.questionBankId);
  if (bank._tag === 'Existing' && hasOnlyKeys(bank, ['_tag', 'questionBankId'])) {
    return questionBankId === null
      ? null
      : { _tag: 'QuestionBank', courseId, bank: { _tag: 'Existing', questionBankId } };
  }
  const questionBankName = parseCanvasQuestionBankName(bank.questionBankName);
  if (bank._tag === 'New' && hasOnlyKeys(bank, ['_tag', 'questionBankName'])) {
    return questionBankName === null
      ? null
      : { _tag: 'QuestionBank', courseId, bank: { _tag: 'New', questionBankName } };
  }
  return null;
}

/** Formats one terminal-history cursor as a canonical opaque token. */
export function formatCanvasPublishTerminalCursor(
  cursor: CanvasPublishTerminalCursor,
): CanvasPublishTerminalCursorToken {
  const token = `${cursor.createdAt.toISOString()}|${cursor.publishId}`;
  // SAFETY: The token is composed only from a canonical timestamp and parsed publish identity.
  return token as CanvasPublishTerminalCursorToken;
}

/** Parses one terminal-history cursor without accepting aliases or malformed timestamps. */
export function parseCanvasPublishTerminalCursor(
  input: unknown,
): CanvasPublishTerminalCursor | null {
  if (typeof input !== 'string') return null;
  const separator = input.indexOf('|');
  if (separator <= 0 || separator !== input.lastIndexOf('|')) return null;
  const timestamp = input.slice(0, separator);
  const publishId = parseCanvasPublishId(input.slice(separator + 1));
  if (!publishId || !isIsoTimestamp(timestamp)) return null;
  return { createdAt: new Date(timestamp), publishId };
}

/** Creates the tenant- and actor-bound fingerprint used to reject key reuse. */
export async function createCanvasPublishRequestFingerprint(input: {
  readonly tenantId: string;
  readonly assessmentId: string;
  readonly actorId: string;
  readonly request: CanvasPublishRequest;
}): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(canonicalJsonStringify(input)));
}

/** Creates the immutable receipt from a completed Canvas observation. */
export function createCanvasPublishReceipt(input: {
  readonly attempt: CanvasPublishAttempt;
  readonly publishedAt: Date;
}): CanvasPublishReceipt {
  if (input.attempt.state._tag !== 'Observing') {
    throw new Error('Only an observed Canvas publish can be completed.');
  }
  const remote = input.attempt.state.remote;
  return {
    schema: 'qflow.canvas-publish-receipt.v1',
    publishId: input.attempt.id,
    exportReceiptId: input.attempt.exportReceiptId,
    assessmentId: input.attempt.assessmentId,
    publishedBy: input.attempt.createdBy,
    connection: { ...input.attempt.connection, provider: 'canvas' },
    targetId: input.attempt.targetId,
    destination: input.attempt.destination,
    artifact: {
      filename: input.attempt.artifact.filename,
      mediaType: input.attempt.artifact.mediaType,
      sha256: input.attempt.artifact.sha256,
      byteLength: input.attempt.artifact.byteLength,
    },
    remote: {
      contentMigrationId: remote.contentMigrationId,
      workflowState: 'completed',
    },
    attemptCount: input.attempt.attemptCount,
    publishedAt: input.publishedAt.toISOString(),
  };
}

/** Parses the complete immutable Canvas receipt at the persistence boundary. */
export function parseCanvasPublishReceipt(input: unknown): CanvasPublishReceipt | null {
  const record = asRecord(input);
  const publishId = parseCanvasPublishId(record?.publishId);
  const exportReceipt = parseAssessmentExportFinalReceiptId(
    typeof record?.exportReceiptId === 'string' ? record.exportReceiptId : null,
  );
  const connectionRecord = asRecord(record?.connection);
  const connectionId = parseCanvasConnectionId(connectionRecord?.id);
  const connectionBaseUrl = parseHttpsOrigin(connectionRecord?.baseUrl);
  const destination = parseCanvasPublishDestination(record?.destination);
  const artifact = asRecord(record?.artifact);
  const remote = asRecord(record?.remote);
  if (
    !record ||
    record.schema !== 'qflow.canvas-publish-receipt.v1' ||
    !publishId ||
    !exportReceipt.ok ||
    typeof record.assessmentId !== 'string' ||
    typeof record.publishedBy !== 'string' ||
    !connectionRecord ||
    !connectionId ||
    connectionRecord.provider !== 'canvas' ||
    typeof connectionRecord.name !== 'string' ||
    connectionRecord.name.length === 0 ||
    !connectionBaseUrl ||
    (record.targetId !== 'canvas-classic' && record.targetId !== 'canvas-new-quizzes') ||
    !destination ||
    !artifact ||
    typeof artifact.filename !== 'string' ||
    artifact.filename.length === 0 ||
    typeof artifact.mediaType !== 'string' ||
    artifact.mediaType.length === 0 ||
    typeof artifact.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(artifact.sha256) ||
    typeof artifact.byteLength !== 'number' ||
    !Number.isSafeInteger(artifact.byteLength) ||
    artifact.byteLength < 0 ||
    !remote ||
    typeof remote.contentMigrationId !== 'string' ||
    remote.contentMigrationId.length === 0 ||
    remote.workflowState !== 'completed' ||
    typeof record.attemptCount !== 'number' ||
    !Number.isSafeInteger(record.attemptCount) ||
    record.attemptCount < 1 ||
    typeof record.publishedAt !== 'string' ||
    !isIsoTimestamp(record.publishedAt) ||
    (record.targetId === 'canvas-new-quizzes' && destination._tag === 'QuestionBank')
  ) return null;
  return {
    schema: 'qflow.canvas-publish-receipt.v1',
    publishId,
    exportReceiptId: exportReceipt.receiptId,
    assessmentId: record.assessmentId,
    publishedBy: record.publishedBy,
    connection: {
      id: connectionId,
      provider: 'canvas',
      name: connectionRecord.name,
      baseUrl: connectionBaseUrl,
    },
    targetId: record.targetId,
    destination,
    artifact: {
      filename: artifact.filename,
      mediaType: artifact.mediaType,
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
    },
    remote: {
      contentMigrationId: remote.contentMigrationId,
      workflowState: 'completed',
    },
    attemptCount: record.attemptCount,
    publishedAt: record.publishedAt,
  };
}

function isIsoTimestamp(input: string): boolean {
  try {
    return new Date(input).toISOString() === input;
  } catch (_cause: unknown) {
    return false;
  }
}

function hasControlCharacter(input: string): boolean {
  for (const character of input) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) return true;
  }
  return false;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  // SAFETY: The value is known to be a non-null, non-array object with unknown properties.
  return input as Record<string, unknown>;
}

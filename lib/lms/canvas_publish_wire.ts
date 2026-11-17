import { parseAssessmentExportFinalReceiptId } from '../export/assessment_export_http.ts';
import { isSafeHttpUrl, parseHttpsOrigin } from '../http_url.ts';
import {
  type CanvasConnectionId,
  type CanvasPublishTargetId,
  parseCanvasConnectionId,
} from './canvas_connection_types.ts';
import {
  type CanvasPublishDestination,
  type CanvasPublishFailure,
  type CanvasPublishId,
  type CanvasPublishTerminalCursorToken,
  formatCanvasPublishTerminalCursor,
  parseCanvasPublishDestination,
  parseCanvasPublishId,
  parseCanvasPublishTerminalCursor,
} from './canvas_publish_contract.ts';

/** Public facts for one configured Canvas connection. */
export type CanvasConnectionView = {
  readonly id: CanvasConnectionId;
  readonly name: string;
  readonly baseUrl: string;
  readonly supportedTargetIds: readonly CanvasPublishTargetId[];
};

/** Author-entered Canvas destination serialized at the HTTP boundary. */
export type CanvasPublishDestinationInput =
  | { readonly type: 'course'; readonly courseId: string }
  | {
    readonly type: 'question-bank';
    readonly courseId: string;
    readonly questionBankId: string;
  }
  | {
    readonly type: 'question-bank';
    readonly courseId: string;
    readonly questionBankName: string;
  };

/** Safe Canvas migration facts returned to the authoring workspace. */
export type CanvasPublishRemoteView = {
  readonly contentMigrationId: string;
  readonly workflowState: string | null;
};

/** Public phase of one durable Canvas publish. */
export type CanvasPublishViewState =
  | { readonly _tag: 'Prepared' }
  | { readonly _tag: 'ClaimingCreate' }
  | { readonly _tag: 'Creating'; readonly startedAt: string }
  | { readonly _tag: 'Uploading'; readonly remote: CanvasPublishRemoteView }
  | { readonly _tag: 'Observing'; readonly remote: CanvasPublishRemoteView }
  | { readonly _tag: 'Processing'; readonly remote: CanvasPublishRemoteView }
  | { readonly _tag: 'RetryCreate'; readonly failure: CanvasPublishFailure }
  | {
    readonly _tag: 'RetryUpload';
    readonly failure: CanvasPublishFailure;
    readonly remote: CanvasPublishRemoteView;
  }
  | {
    readonly _tag: 'RetryObserve';
    readonly failure: CanvasPublishFailure;
    readonly remote: CanvasPublishRemoteView;
  }
  | {
    readonly _tag: 'RemoteIdentityUnknown';
    readonly failure: CanvasPublishFailure;
    readonly startedAt: string;
  }
  | {
    readonly _tag: 'RemoteIdentityResolved';
    readonly failure: CanvasPublishFailure;
    readonly startedAt: string;
    readonly outcome: 'import-found' | 'import-not-found';
    readonly resolvedAt: string;
  }
  | {
    readonly _tag: 'Failed';
    readonly failure: CanvasPublishFailure;
    readonly remote: CanvasPublishRemoteView | null;
  }
  | {
    readonly _tag: 'Published';
    readonly remote: CanvasPublishRemoteView;
    readonly receiptUrl: string;
    readonly publishedAt: string;
  };

/** Safe Canvas publish aggregate returned to the authoring workspace. */
export type CanvasPublishView = {
  readonly id: CanvasPublishId;
  readonly connection: {
    readonly id: CanvasConnectionId;
    readonly name: string;
    readonly baseUrl: string;
  };
  readonly targetId: CanvasPublishTargetId;
  readonly destination: CanvasPublishDestination;
  readonly exportReceiptId: string;
  readonly artifact: {
    readonly filename: string;
    readonly mediaType: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly packageUrl: string;
  };
  readonly attemptCount: number;
  readonly state: CanvasPublishViewState;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** Lossless recovery inventory plus one cursor-paginated terminal-history page. */
export type CanvasPublishPageView = {
  readonly actionRequired: readonly CanvasPublishView[];
  readonly terminal: readonly CanvasPublishView[];
  readonly nextTerminalCursor: CanvasPublishTerminalCursorToken | null;
};

/** Parses a complete public Canvas connection at the browser trust boundary. */
export function parseCanvasConnectionView(input: unknown): CanvasConnectionView | null {
  const record = asRecord(input);
  const id = parseCanvasConnectionId(record?.id);
  const baseUrl = parseHttpsOrigin(record?.baseUrl);
  const supportedTargetIds = parseArray(record?.supportedTargetIds, parseCanvasTargetId);
  if (
    !record || !id || !baseUrl || !supportedTargetIds ||
    typeof record.name !== 'string' || record.name.length === 0
  ) return null;
  return { id, name: record.name, baseUrl, supportedTargetIds };
}

/** Parses a complete Canvas publish view at the browser trust boundary. */
export function parseCanvasPublishView(input: unknown): CanvasPublishView | null {
  const record = asRecord(input);
  const id = parseCanvasPublishId(record?.id);
  const connection = parseConnectionSnapshot(record?.connection);
  const targetId = parseCanvasTargetId(record?.targetId);
  const destination = parseCanvasPublishDestination(record?.destination);
  const exportReceipt = parseAssessmentExportFinalReceiptId(
    typeof record?.exportReceiptId === 'string' ? record.exportReceiptId : null,
  );
  const artifact = parseArtifact(record?.artifact);
  const state = parseState(record?.state);
  if (
    !record || !id || !connection || !targetId || !destination || !exportReceipt.ok || !artifact ||
    !state || !isNonNegativeInteger(record.attemptCount) || !isIsoTimestamp(record.createdAt) ||
    !isIsoTimestamp(record.updatedAt) ||
    (targetId === 'canvas-new-quizzes' && destination._tag === 'QuestionBank')
  ) return null;
  return {
    id,
    connection,
    targetId,
    destination,
    exportReceiptId: exportReceipt.receiptId,
    artifact,
    attemptCount: record.attemptCount,
    state,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Parses one Canvas recovery and terminal-history page at the browser trust boundary. */
export function parseCanvasPublishPageView(input: unknown): CanvasPublishPageView | null {
  const record = asRecord(input);
  if (!record) return null;
  const actionRequired = parseArray(record.actionRequired, parseCanvasPublishView);
  const terminal = parseArray(record.terminal, parseCanvasPublishView);
  const parsedCursor = record.nextTerminalCursor === null
    ? null
    : parseCanvasPublishTerminalCursor(record.nextTerminalCursor);
  if (
    !actionRequired || !terminal ||
    (record.nextTerminalCursor !== null && parsedCursor === null) ||
    actionRequired.some((publish) => !isCanvasPublishActionRequired(publish)) ||
    terminal.some(isCanvasPublishActionRequired) ||
    hasDuplicatePublishIds([...actionRequired, ...terminal])
  ) return null;
  return {
    actionRequired,
    terminal,
    nextTerminalCursor: parsedCursor === null
      ? null
      : formatCanvasPublishTerminalCursor(parsedCursor),
  };
}

/** Returns whether a publish must remain outside bounded terminal history. */
export function isCanvasPublishActionRequired(publish: CanvasPublishView): boolean {
  return publish.state._tag !== 'Published' && publish.state._tag !== 'Failed' &&
    publish.state._tag !== 'RemoteIdentityResolved';
}

function parseState(input: unknown): CanvasPublishViewState | null {
  const record = asRecord(input);
  if (!record || typeof record._tag !== 'string') return null;
  if (record._tag === 'Prepared' || record._tag === 'ClaimingCreate') return { _tag: record._tag };
  if (record._tag === 'Creating' && isIsoTimestamp(record.startedAt)) {
    return { _tag: 'Creating', startedAt: record.startedAt };
  }
  if (
    record._tag === 'Uploading' || record._tag === 'Observing' || record._tag === 'Processing'
  ) {
    const remote = parseRemote(record.remote);
    return remote ? { _tag: record._tag, remote } : null;
  }
  if (record._tag === 'RetryCreate') {
    const failure = parseFailure(record.failure);
    return failure ? { _tag: 'RetryCreate', failure } : null;
  }
  if (record._tag === 'RetryUpload' || record._tag === 'RetryObserve') {
    const failure = parseFailure(record.failure);
    const remote = parseRemote(record.remote);
    return failure && remote ? { _tag: record._tag, failure, remote } : null;
  }
  if (record._tag === 'RemoteIdentityUnknown') {
    const failure = parseFailure(record.failure);
    return failure && isIsoTimestamp(record.startedAt)
      ? { _tag: 'RemoteIdentityUnknown', failure, startedAt: record.startedAt }
      : null;
  }
  if (record._tag === 'RemoteIdentityResolved') {
    const failure = parseFailure(record.failure);
    const outcome = record.outcome === 'import-found' || record.outcome === 'import-not-found'
      ? record.outcome
      : null;
    return failure && outcome && isIsoTimestamp(record.startedAt) &&
        isIsoTimestamp(record.resolvedAt)
      ? {
        _tag: 'RemoteIdentityResolved',
        failure,
        startedAt: record.startedAt,
        outcome,
        resolvedAt: record.resolvedAt,
      }
      : null;
  }
  if (record._tag === 'Failed') {
    const failure = parseFailure(record.failure);
    const remote = record.remote === null ? null : parseRemote(record.remote);
    return failure && (remote !== null || record.remote === null)
      ? { _tag: 'Failed', failure, remote }
      : null;
  }
  if (record._tag === 'Published') {
    const remote = parseRemote(record.remote);
    return remote && typeof record.receiptUrl === 'string' && isSafeHttpUrl(record.receiptUrl) &&
        isIsoTimestamp(record.publishedAt)
      ? {
        _tag: 'Published',
        remote,
        receiptUrl: record.receiptUrl,
        publishedAt: record.publishedAt,
      }
      : null;
  }
  return null;
}

function parseConnectionSnapshot(input: unknown): CanvasPublishView['connection'] | null {
  const record = asRecord(input);
  const id = parseCanvasConnectionId(record?.id);
  const baseUrl = parseHttpsOrigin(record?.baseUrl);
  if (!record || !id || !baseUrl || typeof record.name !== 'string' || record.name.length === 0) {
    return null;
  }
  return { id, name: record.name, baseUrl };
}

function parseArtifact(input: unknown): CanvasPublishView['artifact'] | null {
  const record = asRecord(input);
  if (
    !record || typeof record.filename !== 'string' || record.filename.length === 0 ||
    typeof record.mediaType !== 'string' || record.mediaType.length === 0 ||
    typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256) ||
    !isNonNegativeInteger(record.byteLength) || typeof record.packageUrl !== 'string' ||
    !isSafeHttpUrl(record.packageUrl)
  ) return null;
  return {
    filename: record.filename,
    mediaType: record.mediaType,
    sha256: record.sha256,
    byteLength: record.byteLength,
    packageUrl: record.packageUrl,
  };
}

function parseRemote(input: unknown): CanvasPublishRemoteView | null {
  const record = asRecord(input);
  if (
    !record || typeof record.contentMigrationId !== 'string' ||
    record.contentMigrationId.length === 0 ||
    !(record.workflowState === null || typeof record.workflowState === 'string')
  ) return null;
  return {
    contentMigrationId: record.contentMigrationId,
    workflowState: record.workflowState,
  };
}

function parseFailure(input: unknown): CanvasPublishFailure | null {
  const record = asRecord(input);
  return record && typeof record.code === 'string' && record.code.length > 0 &&
      typeof record.message === 'string' && record.message.length > 0
    ? { code: record.code, message: record.message }
    : null;
}

function parseCanvasTargetId(input: unknown): CanvasPublishTargetId | null {
  return input === 'canvas-classic' || input === 'canvas-new-quizzes' ? input : null;
}

function isIsoTimestamp(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  const epoch = Date.parse(input);
  return !Number.isNaN(epoch) && new Date(epoch).toISOString() === input;
}

function isNonNegativeInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0;
}

function parseArray<T>(
  input: unknown,
  parseEntry: (entry: unknown) => T | null,
): readonly T[] | null {
  if (!Array.isArray(input)) return null;
  const values: T[] = [];
  for (const entry of input) {
    const parsed = parseEntry(entry);
    if (parsed === null) return null;
    values.push(parsed);
  }
  return values;
}

function hasDuplicatePublishIds(publishes: readonly CanvasPublishView[]): boolean {
  const ids = new Set<CanvasPublishId>();
  for (const publish of publishes) {
    if (ids.has(publish.id)) return true;
    ids.add(publish.id);
  }
  return false;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  // SAFETY: The value is known to be a non-null, non-array object with unknown properties.
  return input as Record<string, unknown>;
}

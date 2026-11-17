import { safeErrorSummary } from '../error_summary.ts';
import {
  parseAssessmentExportAcknowledgementToken,
  parseAssessmentExportPreflightId,
} from '../export/assessment_export_http.ts';
import type { AssessmentExportRequirementSelection } from '../export/assessment_export_http.ts';
import { parseCanvasConnectionId } from './canvas_connection_types.ts';
import {
  type CanvasPublishAttempt,
  type CanvasPublishDestination,
  type CanvasPublishId,
  type CanvasPublishRequest,
  type CanvasPublishState,
  parseCanvasPublishDestination,
  parseCanvasPublishId,
} from './canvas_publish_contract.ts';
import type {
  CanvasPublishRemoteView,
  CanvasPublishView,
  CanvasPublishViewState,
} from './canvas_publish_wire.ts';

/** Strict parse result for one direct Canvas publish request. */
export type ParseCanvasPublishHttpRequestResult =
  | {
    readonly ok: true;
    readonly publishId: CanvasPublishId;
    readonly request: CanvasPublishRequest;
  }
  | {
    readonly ok: false;
    readonly status: 400;
    readonly body: {
      readonly error: 'CanvasPublishRequestInvalid' | 'IdempotencyKeyInvalid';
      readonly message: string;
    };
  };

/** Strict author decision accepted when an uncertain Canvas create is closed. */
export type CanvasRemoteIdentityResolutionInput = {
  readonly outcome: 'import-found' | 'import-not-found';
};

/** Parses the exact JSON command used to close an uncertain Canvas create. */
export async function parseCanvasRemoteIdentityResolutionRequest(
  request: Request,
): Promise<CanvasRemoteIdentityResolutionInput | null> {
  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
      'application/json'
  ) {
    return null;
  }
  try {
    const record = asRecord(await request.json());
    if (!record || Object.keys(record).some((key) => key !== 'outcome')) return null;
    return record.outcome === 'import-found' || record.outcome === 'import-not-found'
      ? { outcome: record.outcome }
      : null;
  } catch (_cause: unknown) {
    return null;
  }
}

const REQUEST_KEYS = new Set([
  'connectionId',
  'targetId',
  'destination',
  'preflightId',
  'acknowledgement',
  'scoring',
  'interaction',
]);
const FORM_KEYS = new Set([
  'publishId',
  'connectionId',
  'targetId',
  'destinationChoice',
  'courseId',
  'questionBankId',
  'questionBankName',
  'preflightId',
  'acknowledgement',
  'scoring',
  'interaction',
]);

/** Parses one JSON or native-form publish command without accepting unknown fields. */
export async function parseCanvasPublishHttpRequest(
  request: Request,
): Promise<ParseCanvasPublishHttpRequestResult> {
  const input = await readCanvasPublishInput(request);
  if (!input) return invalidCanvasPublishRequest();
  const publishId = parseCanvasPublishId(
    request.headers.get('idempotency-key') ?? input.formPublishId,
  );
  if (!publishId) {
    return invalidRequest(
      'IdempotencyKeyInvalid',
      'Send one client-issued UUID for the Canvas publish.',
    );
  }

  const record = input.record;

  const connectionId = parseCanvasConnectionId(record.connectionId);
  const targetId = record.targetId === 'canvas-classic' ||
      record.targetId === 'canvas-new-quizzes'
    ? record.targetId
    : null;
  const destination = parseCanvasDestination(record.destination);
  const preflight = parseAssessmentExportPreflightId(
    typeof record.preflightId === 'string' ? record.preflightId : null,
  );
  const acknowledgement = parseAssessmentExportAcknowledgementToken(
    typeof record.acknowledgement === 'string'
      ? record.acknowledgement
      : record.acknowledgement === null
      ? null
      : '__invalid__',
  );
  const selection = parseRequirementSelection(record.scoring, record.interaction);
  if (
    !connectionId || !targetId || !destination || !preflight.ok || !acknowledgement.ok ||
    !selection || (targetId === 'canvas-new-quizzes' && destination._tag === 'QuestionBank')
  ) return invalidCanvasPublishRequest();

  return {
    ok: true,
    publishId,
    request: {
      connectionId,
      targetId,
      destination,
      preflightId: preflight.preflightId,
      acknowledgementToken: acknowledgement.acknowledgementToken,
      selection,
    },
  };
}

async function readCanvasPublishInput(
  request: Request,
): Promise<
  { readonly record: Record<string, unknown>; readonly formPublishId: string | null } | null
> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType === 'application/json') {
    try {
      const record = asRecord(await request.json());
      return record && !Object.keys(record).some((key) => !REQUEST_KEYS.has(key))
        ? { record, formPublishId: null }
        : null;
    } catch (_cause: unknown) {
      return null;
    }
  }
  if (mediaType !== 'application/x-www-form-urlencoded') {
    return null;
  }
  try {
    const form = await request.formData();
    if (
      [...form.keys()].some((key) => !FORM_KEYS.has(key) || form.getAll(key).length !== 1)
    ) return null;
    const destinationChoice = formString(form, 'destinationChoice');
    const courseId = formString(form, 'courseId');
    const questionBankId = formString(form, 'questionBankId');
    const questionBankName = formString(form, 'questionBankName');
    const destination = destinationChoice === 'course'
      ? { type: 'course', courseId }
      : destinationChoice === 'existing-bank'
      ? { type: 'question-bank', courseId, questionBankId }
      : destinationChoice === 'new-bank'
      ? { type: 'question-bank', courseId, questionBankName }
      : null;
    return {
      formPublishId: formString(form, 'publishId'),
      record: {
        connectionId: formString(form, 'connectionId'),
        targetId: formString(form, 'targetId'),
        destination,
        preflightId: formString(form, 'preflightId'),
        acknowledgement: formString(form, 'acknowledgement') || null,
        scoring: formString(form, 'scoring'),
        interaction: formString(form, 'interaction'),
      },
    };
  } catch (_cause: unknown) {
    return null;
  }
}

/** Builds URLs and safe state for one Canvas publish without exposing storage or credentials. */
export function canvasPublishView(
  attempt: CanvasPublishAttempt,
  origin: string,
): CanvasPublishView {
  const root = new URL(
    `/api/assessments/${encodeURIComponent(attempt.assessmentId)}/canvas-publishes/${attempt.id}`,
    origin,
  );
  return {
    id: attempt.id,
    connection: attempt.connection,
    targetId: attempt.targetId,
    destination: attempt.destination,
    exportReceiptId: attempt.exportReceiptId,
    artifact: {
      filename: attempt.artifact.filename,
      mediaType: attempt.artifact.mediaType,
      sha256: attempt.artifact.sha256,
      byteLength: attempt.artifact.byteLength,
      packageUrl: `${root.toString()}/package`,
    },
    attemptCount: attempt.attemptCount,
    state: canvasPublishViewState(attempt.state, root),
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
  };
}

/** Maps a durable Canvas phase to the status used by create and resume endpoints. */
export function canvasPublishHttpStatus(state: CanvasPublishState): 200 | 202 | 502 {
  if (state._tag === 'Published' || state._tag === 'RemoteIdentityResolved') return 200;
  if (
    state._tag === 'RetryCreate' || state._tag === 'RetryUpload' ||
    state._tag === 'RetryObserve' || state._tag === 'RemoteIdentityUnknown' ||
    state._tag === 'Failed'
  ) return 502;
  return 202;
}

/** Logs an unexpected Canvas defect without serializing tokens, payloads, or remote bodies. */
export function unexpectedCanvasPublishResponse(
  cause: unknown,
  context: { readonly assessmentId: string; readonly operation: string },
): Response {
  console.error(JSON.stringify({
    event: 'canvas_publish_failed',
    assessmentId: context.assessmentId,
    operation: context.operation,
    causeType: safeErrorSummary(cause),
  }));
  return Response.json(
    {
      error: 'InternalCanvasPublishFailure',
      message: 'Direct Canvas publishing failed unexpectedly.',
    },
    { status: 500 },
  );
}

function canvasPublishViewState(
  state: CanvasPublishState,
  root: URL,
): CanvasPublishViewState {
  switch (state._tag) {
    case 'Prepared':
    case 'ClaimingCreate':
      return { _tag: state._tag };
    case 'Creating':
      return { _tag: 'Creating', startedAt: state.startedAt.toISOString() };
    case 'Uploading':
    case 'Observing':
    case 'Processing':
      return { _tag: state._tag, remote: remoteView(state.remote) };
    case 'RetryCreate':
      return { _tag: 'RetryCreate', failure: state.failure };
    case 'RetryUpload':
    case 'RetryObserve':
      return {
        _tag: state._tag,
        failure: state.failure,
        remote: remoteView(state.remote),
      };
    case 'RemoteIdentityUnknown':
      return {
        _tag: 'RemoteIdentityUnknown',
        failure: state.failure,
        startedAt: state.startedAt.toISOString(),
      };
    case 'RemoteIdentityResolved':
      return {
        _tag: 'RemoteIdentityResolved',
        failure: state.failure,
        startedAt: state.startedAt.toISOString(),
        outcome: state.resolution.outcome,
        resolvedAt: state.resolution.resolvedAt.toISOString(),
      };
    case 'Failed':
      return {
        _tag: 'Failed',
        failure: state.failure,
        remote: state.remote ? remoteView(state.remote) : null,
      };
    case 'Published':
      return {
        _tag: 'Published',
        remote: remoteView(state.remote),
        receiptUrl: `${root.toString()}/receipt`,
        publishedAt: state.publishedAt.toISOString(),
      };
  }
}

function remoteView(
  remote: { readonly contentMigrationId: string; readonly workflowState: string | null },
): CanvasPublishRemoteView {
  return {
    contentMigrationId: remote.contentMigrationId,
    workflowState: remote.workflowState,
  };
}

function parseCanvasDestination(input: unknown): CanvasPublishDestination | null {
  const record = asRecord(input);
  if (!record) return null;
  if (
    record.type === 'course' &&
    Object.keys(record).every((key) => key === 'type' || key === 'courseId')
  ) {
    return parseCanvasPublishDestination({ _tag: 'Course', courseId: record.courseId });
  }
  if (record.type !== 'question-bank') return null;
  if (
    Object.keys(record).some((key) =>
      key !== 'type' && key !== 'courseId' && key !== 'questionBankId' &&
      key !== 'questionBankName'
    )
  ) return null;
  const hasQuestionBankId = record.questionBankId !== undefined;
  const hasQuestionBankName = record.questionBankName !== undefined;
  if (hasQuestionBankId === hasQuestionBankName) return null;
  return parseCanvasPublishDestination({
    _tag: 'QuestionBank',
    courseId: record.courseId,
    bank: hasQuestionBankId
      ? { _tag: 'Existing', questionBankId: record.questionBankId }
      : { _tag: 'New', questionBankName: record.questionBankName },
  });
}

function parseRequirementSelection(
  scoring: unknown,
  interaction: unknown,
): AssessmentExportRequirementSelection | null {
  if (
    (scoring !== 'automatic' && scoring !== 'manual-accepted') ||
    (interaction !== 'preserve' && interaction !== 'fallback-accepted')
  ) return null;
  return { scoring, interaction };
}

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  // SAFETY: The value is known to be a non-null, non-array object with unknown properties.
  return input as Record<string, unknown>;
}

function invalidCanvasPublishRequest() {
  return invalidRequest(
    'CanvasPublishRequestInvalid',
    'Select one Canvas connection, export target, and exact course or question bank.',
  );
}

function invalidRequest(
  error: 'CanvasPublishRequestInvalid' | 'IdempotencyKeyInvalid',
  message: string,
): Extract<ParseCanvasPublishHttpRequestResult, { readonly ok: false }> {
  return { ok: false, status: 400, body: { error, message } };
}

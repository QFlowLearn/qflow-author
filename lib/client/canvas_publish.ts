import type { AssessmentExportRequirementSelection } from '../export/assessment_export_http.ts';
import type {
  AssessmentExportAcknowledgementToken,
  AssessmentExportPreflightId,
} from '../export/assessment_export_preflight.ts';
import type { CanvasPublishTargetId } from '../lms/canvas_connection_types.ts';
import {
  type CanvasConnectionView,
  type CanvasPublishDestinationInput,
  type CanvasPublishPageView,
  type CanvasPublishView,
  parseCanvasConnectionView,
  parseCanvasPublishPageView,
  parseCanvasPublishView,
} from '../lms/canvas_publish_wire.ts';
import type { CanvasPublishTerminalCursorToken } from '../lms/canvas_publish_contract.ts';

export type {
  CanvasConnectionView,
  CanvasPublishDestinationInput,
  CanvasPublishPageView,
  CanvasPublishView,
} from '../lms/canvas_publish_wire.ts';
export type { CanvasPublishTerminalCursorToken } from '../lms/canvas_publish_contract.ts';

/** Stable diagnostic code supplied by a local fallback or validated server envelope. */
export type CanvasPublishClientErrorCode = string;
/** Expected client result for Canvas connection discovery and publish operations. */
export type CanvasPublishClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: CanvasPublishClientErrorCode } };

/** Loads configured Canvas connections without exposing credential references or tokens. */
export async function loadCanvasConnections(
  options: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal } = {},
): Promise<CanvasPublishClientResult<readonly CanvasConnectionView[]>> {
  const response = await requestJson(
    '/api/canvas/connections',
    { method: 'GET', signal: options.signal },
    options.fetchImpl,
  );
  if (!response.ok) return response;
  const connections = parseArray(asRecord(response.value)?.connections, parseCanvasConnectionView);
  return connections ? { ok: true, value: connections } : invalidResponse('Canvas connection list');
}

/** Loads lossless recovery work and one terminal-history page for one assessment. */
export async function loadCanvasPublishes(
  assessmentId: string,
  targetId: CanvasPublishTargetId,
  options: {
    readonly terminalCursor?: CanvasPublishTerminalCursorToken;
    readonly fetchImpl?: typeof fetch;
    readonly signal?: AbortSignal;
  } = {},
): Promise<CanvasPublishClientResult<CanvasPublishPageView>> {
  const query = new URLSearchParams({ target: targetId });
  if (options.terminalCursor) query.set('terminalCursor', options.terminalCursor);
  const response = await requestJson(
    `/api/assessments/${encodeURIComponent(assessmentId)}/canvas-publishes?${query}`,
    { method: 'GET', signal: options.signal },
    options.fetchImpl,
  );
  if (!response.ok) return response;
  const page = parseCanvasPublishPageView(response.value);
  return page ? { ok: true, value: page } : invalidResponse('Canvas publish list');
}

/** Creates or safely replays one Canvas publish using a caller-retained idempotency UUID. */
export async function createCanvasPublish(
  input: {
    readonly assessmentId: string;
    readonly publishId: string;
    readonly connectionId: string;
    readonly targetId: CanvasPublishTargetId;
    readonly destination: CanvasPublishDestinationInput;
    readonly preflightId: AssessmentExportPreflightId;
    readonly acknowledgement: AssessmentExportAcknowledgementToken | null;
    readonly selection: AssessmentExportRequirementSelection;
  },
  options: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal } = {},
): Promise<CanvasPublishClientResult<CanvasPublishView>> {
  return await publishRequest(
    `/api/assessments/${encodeURIComponent(input.assessmentId)}/publish/canvas`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.publishId,
      },
      body: JSON.stringify({
        connectionId: input.connectionId,
        targetId: input.targetId,
        destination: input.destination,
        preflightId: input.preflightId,
        acknowledgement: input.acknowledgement,
        scoring: input.selection.scoring,
        interaction: input.selection.interaction,
      }),
      signal: options.signal,
    },
    options.fetchImpl,
  );
}

/** Polls or retries the exact persisted Canvas operation without creating a second migration. */
export async function resumeCanvasPublish(
  assessmentId: string,
  publishId: string,
  options: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal } = {},
): Promise<CanvasPublishClientResult<CanvasPublishView>> {
  return await publishRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/canvas-publishes/${publishId}/resume`,
    { method: 'POST', signal: options.signal },
    options.fetchImpl,
  );
}

/** Records the author's Canvas check and closes an uncertain create operation. */
export async function resolveCanvasRemoteIdentity(
  assessmentId: string,
  publishId: string,
  outcome: 'import-found' | 'import-not-found',
  options: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal } = {},
): Promise<CanvasPublishClientResult<CanvasPublishView>> {
  return await publishRequest(
    `/api/assessments/${
      encodeURIComponent(assessmentId)
    }/canvas-publishes/${publishId}/resolve-remote-identity`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome }),
      signal: options.signal,
    },
    options.fetchImpl,
  );
}

async function publishRequest(
  url: string,
  init: RequestInit,
  fetchImpl?: typeof fetch,
): Promise<CanvasPublishClientResult<CanvasPublishView>> {
  const response = await requestJson(url, init, fetchImpl);
  if (!response.ok) return response;
  const publish = parseCanvasPublishView(asRecord(response.value)?.publish);
  return publish ? { ok: true, value: publish } : invalidResponse('Canvas publish');
}

async function requestJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasPublishClientResult<unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (cause: unknown) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    return {
      ok: false,
      error: {
        code: 'CanvasPublishRequestFailed',
      },
    };
  }
  const payload: unknown = await response.json().catch(() => null);
  const publish = parseCanvasPublishView(asRecord(payload)?.publish);
  if (publish) return { ok: true, value: { publish } };
  if (!response.ok) {
    const record = asRecord(payload);
    return {
      ok: false,
      error: {
        code: isStableCode(record?.error) ? record.error : 'CanvasPublishRequestFailed',
      },
    };
  }
  return { ok: true, value: payload };
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

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  // SAFETY: The value is known to be a non-null, non-array object with unknown properties.
  return input as Record<string, unknown>;
}

function invalidResponse(_subject: string): CanvasPublishClientResult<never> {
  return {
    ok: false,
    error: {
      code: 'CanvasPublishResponseInvalid',
    },
  };
}

function isStableCode(input: unknown): input is string {
  return typeof input === 'string' && input.length > 0;
}

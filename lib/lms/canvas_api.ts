import { reveal } from '../redacted.ts';
import type { AuthorizedCanvasConnection } from './canvas_connections.ts';
import type { CanvasCourseId, CanvasPublishDestination } from './canvas_publish_contract.ts';

/** Safe, classified Canvas failure suitable for persistence and author-facing recovery. */
export type CanvasConnectorFailure = {
  readonly code:
    | 'CanvasAuthenticationFailed'
    | 'CanvasPermissionDenied'
    | 'CanvasDestinationNotFound'
    | 'CanvasRateLimited'
    | 'CanvasUnavailable'
    | 'CanvasRequestRejected'
    | 'CanvasResponseInvalid'
    | 'CanvasUploadFailed'
    | 'CanvasUploadResponseInvalid'
    | 'CanvasUploadConfirmationFailed'
    | 'CanvasRequestTimedOut'
    | 'CanvasRequestCancelled';
  readonly message: string;
  readonly retryable: boolean;
};

/** Result returned by every expected Canvas transport operation. */
export type CanvasConnectorResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CanvasConnectorFailure };

/** Opaque signed upload contract returned by Canvas. */
export type CanvasUploadContract = {
  readonly uploadUrl: string;
  readonly uploadParams: Readonly<Record<string, string>>;
};

/** Remote identity and progress locator returned by Canvas content migrations. */
export type CanvasContentMigration = {
  readonly id: string;
  readonly progressUrl: string;
  readonly workflowState: string | null;
  readonly upload: CanvasUploadContract | null;
};

/** Parsed state from Canvas' asynchronous Progress API. */
export type CanvasImportProgress = {
  readonly workflowState: 'queued' | 'running' | 'completed' | 'failed';
  readonly completion: number | null;
};

type CanvasRequestOptions = {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
};

type CanvasPackage = {
  readonly filename: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
};

/** Creates a qti_converter migration for one explicit Canvas course and target contract. */
export async function createCanvasQtiMigration(
  connection: AuthorizedCanvasConnection,
  input: {
    readonly targetId: 'canvas-classic' | 'canvas-new-quizzes';
    readonly destination: CanvasPublishDestination;
    readonly artifact: CanvasPackage;
  },
  options: CanvasRequestOptions = {},
): Promise<CanvasConnectorResult<CanvasContentMigration & { upload: CanvasUploadContract }>> {
  const form = canvasQtiMigrationForm(input);
  return await sendMigrationWrite(
    connection,
    input.destination.courseId,
    null,
    'POST',
    form,
    options,
  );
}

/** Requests a fresh signed upload contract for an existing migration after an upload failure. */
export async function refreshCanvasQtiMigrationUpload(
  connection: AuthorizedCanvasConnection,
  input: {
    readonly courseId: CanvasCourseId;
    readonly contentMigrationId: string;
    readonly artifact: CanvasPackage;
  },
  options: CanvasRequestOptions = {},
): Promise<CanvasConnectorResult<CanvasContentMigration & { upload: CanvasUploadContract }>> {
  const form = new FormData();
  appendPreAttachment(form, input.artifact);
  return await sendMigrationWrite(
    connection,
    input.courseId,
    input.contentMigrationId,
    'PUT',
    form,
    options,
  );
}

/** Uploads package bytes to Canvas' opaque signed URL, then confirms the upload with Canvas. */
export async function uploadCanvasQtiPackage(
  connection: AuthorizedCanvasConnection,
  upload: CanvasUploadContract,
  artifact: CanvasPackage,
  options: CanvasRequestOptions = {},
): Promise<CanvasConnectorResult<void>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const uploadUrl = parseSignedUploadUrl(upload.uploadUrl);
  if (uploadUrl === null) return invalidResponse('CanvasUploadResponseInvalid');
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.uploadParams)) form.append(name, value);
  form.append(
    'file',
    new Blob([copyArrayBuffer(artifact.bytes)], { type: artifact.mediaType }),
    artifact.filename,
  );

  let response: Response;
  try {
    response = await fetchImpl(uploadUrl, {
      method: 'POST',
      body: form,
      redirect: 'manual',
      signal: options.signal,
    });
  } catch (cause: unknown) {
    return classifyCanvasFetchFailure(cause, options.signal, 'CanvasUploadFailed');
  }
  if (response.status !== 201 && (response.status < 300 || response.status >= 400)) {
    return failure(
      'CanvasUploadFailed',
      'Canvas could not receive the preserved package.',
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
  const location = response.headers.get('location');
  if (location === null) return invalidResponse('CanvasUploadResponseInvalid');
  const confirmationUrl = parseCanvasResponseUrl(location, connection.baseUrl, uploadUrl);
  if (confirmationUrl === null) return invalidResponse('CanvasUploadResponseInvalid');

  const confirmation = await authenticatedFetch(
    connection,
    confirmationUrl,
    {
      method: 'GET',
      signal: options.signal,
    },
    fetchImpl,
    'CanvasUploadConfirmationFailed',
  );
  return confirmation.ok ? { ok: true, value: undefined } : confirmation;
}

/** Loads the existing migration selected by its persisted Canvas identity. */
export async function getCanvasContentMigration(
  connection: AuthorizedCanvasConnection,
  input: { readonly courseId: CanvasCourseId; readonly contentMigrationId: string },
  options: CanvasRequestOptions = {},
): Promise<CanvasConnectorResult<CanvasContentMigration>> {
  const url = contentMigrationUrl(connection.baseUrl, input.courseId, input.contentMigrationId);
  const response = await authenticatedJson(
    connection,
    url,
    { method: 'GET', signal: options.signal },
    options.fetchImpl ?? fetch,
  );
  if (!response.ok) return response;
  return parseContentMigration(response.value, connection.baseUrl, false);
}

/** Loads the exact same-origin progress URL returned by Canvas. */
export async function getCanvasImportProgress(
  connection: AuthorizedCanvasConnection,
  progressUrl: string,
  options: CanvasRequestOptions = {},
): Promise<CanvasConnectorResult<CanvasImportProgress>> {
  const url = parseCanvasProgressUrl(progressUrl, connection.baseUrl);
  if (url === null) return invalidResponse('CanvasResponseInvalid');
  const response = await authenticatedJson(
    connection,
    url,
    { method: 'GET', signal: options.signal },
    options.fetchImpl ?? fetch,
  );
  if (!response.ok) return response;
  const record = asRecord(response.value);
  const workflowState = record?.workflow_state;
  const completion = record?.completion;
  if (
    !record ||
    (workflowState !== 'queued' && workflowState !== 'running' &&
      workflowState !== 'completed' && workflowState !== 'failed') ||
    !(completion === null || completion === undefined ||
      (typeof completion === 'number' && Number.isFinite(completion) && completion >= 0 &&
        completion <= 100))
  ) return invalidResponse('CanvasResponseInvalid');
  return {
    ok: true,
    value: {
      workflowState,
      completion: typeof completion === 'number' ? completion : null,
    },
  };
}

function canvasQtiMigrationForm(input: {
  readonly targetId: 'canvas-classic' | 'canvas-new-quizzes';
  readonly destination: CanvasPublishDestination;
  readonly artifact: CanvasPackage;
}): FormData {
  const form = new FormData();
  form.append('migration_type', 'qti_converter');
  appendPreAttachment(form, input.artifact);
  form.append(
    'settings[import_quizzes_next]',
    input.targetId === 'canvas-new-quizzes' ? 'true' : 'false',
  );
  if (input.destination._tag === 'QuestionBank') {
    if (input.destination.bank._tag === 'Existing') {
      form.append('settings[question_bank_id]', input.destination.bank.questionBankId);
    } else {
      form.append('settings[question_bank_name]', input.destination.bank.questionBankName);
    }
  }
  return form;
}

function appendPreAttachment(form: FormData, artifact: CanvasPackage): void {
  form.append('pre_attachment[name]', artifact.filename);
  form.append('pre_attachment[size]', String(artifact.bytes.byteLength));
  form.append('pre_attachment[content_type]', artifact.mediaType);
}

async function sendMigrationWrite(
  connection: AuthorizedCanvasConnection,
  courseId: CanvasCourseId,
  contentMigrationId: string | null,
  method: 'POST' | 'PUT',
  body: FormData,
  options: CanvasRequestOptions,
): Promise<CanvasConnectorResult<CanvasContentMigration & { upload: CanvasUploadContract }>> {
  const url = contentMigrationUrl(connection.baseUrl, courseId, contentMigrationId);
  const response = await authenticatedJson(
    connection,
    url,
    { method, body, signal: options.signal },
    options.fetchImpl ?? fetch,
  );
  if (!response.ok) return response;
  return parseContentMigration(response.value, connection.baseUrl, true);
}

async function authenticatedJson(
  connection: AuthorizedCanvasConnection,
  url: URL,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<CanvasConnectorResult<unknown>> {
  const response = await authenticatedFetch(
    connection,
    url,
    init,
    fetchImpl,
    'CanvasUnavailable',
  );
  if (!response.ok) return response;
  try {
    return { ok: true, value: await response.value.json() };
  } catch (_cause: unknown) {
    return invalidResponse('CanvasResponseInvalid');
  }
}

async function authenticatedFetch(
  connection: AuthorizedCanvasConnection,
  url: URL,
  init: RequestInit,
  fetchImpl: typeof fetch,
  networkCode: CanvasConnectorFailure['code'],
): Promise<CanvasConnectorResult<Response>> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${reveal(connection.accessToken)}`);
  headers.set('accept', 'application/json');
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, headers, redirect: 'manual' });
  } catch (cause: unknown) {
    return classifyCanvasFetchFailure(cause, init.signal ?? undefined, networkCode);
  }
  if (response.ok) return { ok: true, value: response };
  return classifyCanvasHttpFailure(response.status, networkCode);
}

function parseContentMigration(
  input: unknown,
  baseUrl: string,
  requireUpload: true,
): CanvasConnectorResult<CanvasContentMigration & { upload: CanvasUploadContract }>;
function parseContentMigration(
  input: unknown,
  baseUrl: string,
  requireUpload: false,
): CanvasConnectorResult<CanvasContentMigration>;
function parseContentMigration(
  input: unknown,
  baseUrl: string,
  requireUpload: boolean,
): CanvasConnectorResult<CanvasContentMigration> {
  const record = asRecord(input);
  const id = parseRemoteId(record?.id);
  const progressUrl = typeof record?.progress_url === 'string' &&
      parseCanvasProgressUrl(record.progress_url, baseUrl) !== null
    ? new URL(record.progress_url, baseUrl).toString()
    : null;
  const workflowState = typeof record?.workflow_state === 'string' ? record.workflow_state : null;
  const upload = record?.pre_attachment === undefined
    ? null
    : parseUploadContract(record.pre_attachment);
  if (!record || !id || !progressUrl || (requireUpload && !upload)) {
    return invalidResponse('CanvasResponseInvalid');
  }
  return { ok: true, value: { id, progressUrl, workflowState, upload } };
}

function parseUploadContract(input: unknown): CanvasUploadContract | null {
  const record = asRecord(input);
  const params = asRecord(record?.upload_params);
  if (!record || typeof record.upload_url !== 'string' || !params) return null;
  const uploadUrl = parseSignedUploadUrl(record.upload_url);
  if (!uploadUrl) return null;
  const uploadParams: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== 'string') return null;
    uploadParams[name] = value;
  }
  return { uploadUrl: uploadUrl.toString(), uploadParams };
}

function parseRemoteId(input: unknown): string | null {
  if (typeof input === 'number' && Number.isSafeInteger(input) && input >= 0) return String(input);
  if (typeof input === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(input)) return input;
  return null;
}

function contentMigrationUrl(
  baseUrl: string,
  courseId: string,
  contentMigrationId: string | null,
): URL {
  const path = `/api/v1/courses/${encodeURIComponent(courseId)}/content_migrations`;
  return new URL(
    contentMigrationId === null ? path : `${path}/${encodeURIComponent(contentMigrationId)}`,
    baseUrl,
  );
}

function parseCanvasProgressUrl(input: string, baseUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(input, baseUrl);
  } catch (_cause: unknown) {
    return null;
  }
  const base = new URL(baseUrl);
  if (
    url.protocol !== 'https:' ||
    url.origin !== base.origin ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    !/^\/api\/v1\/progress\/[^/]+$/.test(url.pathname)
  ) return null;
  return url;
}

function parseSignedUploadUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch (_cause: unknown) {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) return null;
  return url;
}

function parseCanvasResponseUrl(
  location: string,
  baseUrl: string,
  responseUrl: URL,
): URL | null {
  let url: URL;
  try {
    url = new URL(location, responseUrl);
  } catch (_cause: unknown) {
    return null;
  }
  const base = new URL(baseUrl);
  if (
    url.protocol !== 'https:' ||
    url.origin !== base.origin ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) return null;
  return url;
}

function classifyCanvasHttpFailure(
  status: number,
  operationCode: CanvasConnectorFailure['code'],
): CanvasConnectorResult<never> {
  if (status === 401) {
    return failure(
      'CanvasAuthenticationFailed',
      'Canvas rejected the connection access token. Update the Canvas connection, then retry this publish.',
      true,
    );
  }
  if (status === 403) {
    return failure(
      'CanvasPermissionDenied',
      'The Canvas connection cannot import content into this destination. Update its permissions, then retry this publish.',
      true,
    );
  }
  if (status === 404) {
    return failure(
      'CanvasDestinationNotFound',
      'Canvas could not find the selected course or publish operation.',
      false,
    );
  }
  if (status === 429) {
    return failure('CanvasRateLimited', 'Canvas asked QFlowLearn to retry later.', true);
  }
  if (status === 408 || status >= 500) {
    return failure(operationCode, canvasFailureMessage(operationCode), true);
  }
  return failure(
    'CanvasRequestRejected',
    'Canvas rejected the direct publish request.',
    false,
  );
}

function invalidResponse(code: 'CanvasResponseInvalid' | 'CanvasUploadResponseInvalid') {
  return failure(code, canvasFailureMessage(code), false);
}

function canvasFailureMessage(code: CanvasConnectorFailure['code']): string {
  if (code === 'CanvasRequestTimedOut') {
    return 'Canvas did not respond before the request deadline.';
  }
  if (code === 'CanvasRequestCancelled') return 'The Canvas request was cancelled.';
  return code.startsWith('CanvasUpload')
    ? 'Canvas returned an invalid package upload response.'
    : 'Canvas is unavailable or returned an invalid response.';
}

function classifyCanvasFetchFailure(
  cause: unknown,
  signal: AbortSignal | null | undefined,
  fallbackCode: CanvasConnectorFailure['code'],
): CanvasConnectorResult<never> {
  if (signal?.aborted) {
    const reason = signal.reason;
    const timedOut = reason instanceof DOMException && reason.name === 'TimeoutError';
    const code = timedOut ? 'CanvasRequestTimedOut' : 'CanvasRequestCancelled';
    return failure(code, canvasFailureMessage(code), true);
  }
  if (cause instanceof DOMException && cause.name === 'TimeoutError') {
    return failure('CanvasRequestTimedOut', canvasFailureMessage('CanvasRequestTimedOut'), true);
  }
  return failure(fallbackCode, canvasFailureMessage(fallbackCode), true);
}

function failure(
  code: CanvasConnectorFailure['code'],
  message: string,
  retryable: boolean,
): CanvasConnectorResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  // SAFETY: The value is known to be a non-null, non-array object with unknown properties.
  return input as Record<string, unknown>;
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

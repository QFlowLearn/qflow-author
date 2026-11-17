import {
  parseUploadApiError,
  type UploadApiErrorCode,
  type UploadApiErrorParams,
} from '../http/upload_api_contract.ts';

/** Metadata returned after a file is stored in QFlow. */
export type UploadedFile = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly url: string;
  readonly createdAt: string;
};

export type UploadRequestErrorCode = UploadApiErrorCode | 'request_failed' | 'invalid_response';

export class UploadRequestError extends Error {
  readonly code: UploadRequestErrorCode;
  readonly params?: UploadApiErrorParams;

  constructor(code: UploadRequestErrorCode, params?: UploadApiErrorParams) {
    super(code);
    this.name = 'UploadRequestError';
    this.code = code;
    this.params = params;
  }
}

/** Upload one authoring asset and return its tenant-scoped URL and metadata. */
export async function uploadFile(file: File): Promise<UploadedFile> {
  const body = new FormData();
  body.append('file', file, file.name);
  let response: Response;
  try {
    response = await fetch('/api/uploads', { method: 'POST', body });
  } catch (_error: unknown) {
    throw new UploadRequestError('request_failed');
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch (_err: unknown) {
    payload = null;
  }

  if (!response.ok) {
    const failure = parseUploadApiError(payload);
    throw failure
      ? new UploadRequestError(failure.code, 'params' in failure ? failure.params : undefined)
      : new UploadRequestError('request_failed');
  }

  const uploaded = parseUploadedFile(payload);
  if (!uploaded) {
    throw new UploadRequestError('invalid_response');
  }
  return uploaded;
}

function parseUploadedFile(input: unknown): UploadedFile | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  if (
    !('id' in input) ||
    typeof input.id !== 'string' ||
    !('name' in input) ||
    typeof input.name !== 'string' ||
    !('type' in input) ||
    typeof input.type !== 'string' ||
    !('size' in input) ||
    typeof input.size !== 'number' ||
    !('url' in input) ||
    typeof input.url !== 'string' ||
    !input.url ||
    !('createdAt' in input) ||
    typeof input.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    size: input.size,
    url: input.url,
    createdAt: input.createdAt,
  };
}

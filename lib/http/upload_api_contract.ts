import type { UploadKind } from '../upload_policy.ts';

export type UploadApiErrorCode =
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'payload_unreadable'
  | 'file_field_required'
  | 'file_empty'
  | 'file_too_large'
  | 'content_unsupported'
  | 'content_type_mismatch'
  | 'filename_extension_mismatch'
  | 'kind_too_large'
  | 'storage_failed';
type NoParamsError = {
  readonly error: true;
  readonly code:
    | 'unsupported_media_type'
    | 'payload_unreadable'
    | 'file_field_required'
    | 'file_empty'
    | 'content_unsupported'
    | 'content_type_mismatch'
    | 'filename_extension_mismatch'
    | 'storage_failed';
};
type MaxSizeError = {
  readonly error: true;
  readonly code: 'payload_too_large' | 'file_too_large';
  readonly params: { readonly maxMebibytes: number };
};
type KindSizeError = {
  readonly error: true;
  readonly code: 'kind_too_large';
  readonly params: { readonly kind: UploadKind; readonly maxMebibytes: number };
};
export type UploadApiError = NoParamsError | MaxSizeError | KindSizeError;
export type UploadApiErrorParams = UploadApiError extends infer Error
  ? Error extends { params: infer Params } ? Params : never
  : never;
const codes: ReadonlySet<string> = new Set<UploadApiErrorCode>([
  'payload_too_large',
  'unsupported_media_type',
  'payload_unreadable',
  'file_field_required',
  'file_empty',
  'file_too_large',
  'content_unsupported',
  'content_type_mismatch',
  'filename_extension_mismatch',
  'kind_too_large',
  'storage_failed',
]);
const kinds: ReadonlySet<string> = new Set<UploadKind>([
  'image',
  'audio',
  'video',
  'pdf',
  'captions',
]);
const noParamCodes: ReadonlySet<string> = new Set([
  'unsupported_media_type',
  'payload_unreadable',
  'file_field_required',
  'file_empty',
  'content_unsupported',
  'content_type_mismatch',
  'filename_extension_mismatch',
  'storage_failed',
]);
export function parseUploadApiError(input: unknown): UploadApiError | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  if (!('error' in input) || input.error !== true || !('code' in input)) return null;
  if (typeof input.code !== 'string' || !codes.has(input.code)) return null;
  const code = input.code as UploadApiErrorCode;
  if (noParamCodes.has(code)) {
    return 'params' in input ? null : { error: true, code } as UploadApiError;
  }
  if (
    !('params' in input) || input.params === undefined || typeof input.params !== 'object' ||
    input.params === null || Array.isArray(input.params)
  ) return null;
  const params = input.params as Record<string, unknown>;
  if (Object.keys(params).some((key) => key !== 'maxMebibytes' && key !== 'kind')) return null;
  const allowsKind = code === 'kind_too_large';
  if (
    !('maxMebibytes' in params) || typeof params.maxMebibytes !== 'number' ||
    !Number.isFinite(params.maxMebibytes) || params.maxMebibytes <= 0
  ) return null;
  if (
    allowsKind &&
    (!('kind' in params) || typeof params.kind !== 'string' || !kinds.has(params.kind))
  ) return null;
  if (!allowsKind && 'kind' in params) return null;
  return { error: true, code, params: params as UploadApiErrorParams } as UploadApiError;
}

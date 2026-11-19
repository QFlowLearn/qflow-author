import { saveUpload, UploadCleanupRequiredError } from '../../../uploads.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import { BoundedMultipartError, parseBoundedMultipartFormData } from '../../bounded_multipart.ts';
import { resolveStorage } from '../../../storage.ts';
import { requireAuthContext } from '../../../tenants.ts';
import {
  inspectUpload,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MEBIBYTES,
  MAX_UPLOAD_REQUEST_BYTES,
  UPLOAD_POLICIES,
} from '../../../upload_policy.ts';
import type { UploadApiError } from '../../upload_api_contract.ts';

type UploadResponse = {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  createdAt: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function error(body: UploadApiError, status = 400, message = uploadCompatibilityMessage(body)) {
  return json({ ...body, message }, status);
}

function uploadCompatibilityMessage(body: UploadApiError): string {
  switch (body.code) {
    case 'payload_too_large':
      return `Upload requests must contain no more than ${body.params.maxMebibytes} MB of file data.`;
    case 'unsupported_media_type':
      return 'Send the upload as multipart form data.';
    case 'payload_unreadable':
      return 'Unable to read upload payload.';
    case 'file_field_required':
      return 'Attach a file using the "file" field.';
    case 'file_empty':
      return 'Uploaded file is empty.';
    case 'file_too_large':
      return `Files must be ${body.params.maxMebibytes} MB or smaller.`;
    case 'kind_too_large':
      return `${body.params.kind} must be ${body.params.maxMebibytes} MB or smaller.`;
    case 'content_unsupported':
      return 'The uploaded file type is not supported.';
    case 'content_type_mismatch':
      return 'The uploaded file content does not match its type.';
    case 'filename_extension_mismatch':
      return 'The uploaded filename does not match its type.';
    case 'storage_failed':
      return 'Failed to store upload. Please try again later.';
  }
}

function uploadFailureLogFields(cause: unknown): Record<string, unknown> {
  const fields: Record<string, unknown> = { cause: safeErrorSummary(cause) };
  if (!(cause instanceof UploadCleanupRequiredError)) return fields;
  return {
    ...fields,
    cleanupRequired: true,
    uploadId: cause.uploadId,
    objectKey: cause.objectKey,
    persistenceCause: safeErrorSummary(cause.cause),
    cleanupCause: safeErrorSummary(cause.cleanupCause),
  };
}

/** Shared bank API endpoint contract and implementation. */
export const uploadBankRoute = defineHttpRoute('/api/uploads', { 'POST': handle });

async function handle(ctx: HttpRequest) {
  const { req } = ctx;

  const auth = requireAuthContext(ctx.state);

  let form: FormData;
  try {
    form = await parseBoundedMultipartFormData(req, { maxBytes: MAX_UPLOAD_REQUEST_BYTES });
  } catch (cause: unknown) {
    if (cause instanceof BoundedMultipartError) {
      if (cause.code === 'payload_too_large') {
        return error({
          error: true,
          code: 'payload_too_large',
          params: { maxMebibytes: MAX_UPLOAD_MEBIBYTES },
        }, 413);
      }
      if (cause.code === 'unsupported_media_type') {
        return error({ error: true, code: 'unsupported_media_type' }, 415);
      }
    }
    return error({ error: true, code: 'payload_unreadable' });
  }

  const fields = [...form.entries()];
  if (fields.length !== 1 || fields[0]?.[0] !== 'file') {
    return error({ error: true, code: 'file_field_required' });
  }
  const fileField = fields[0][1];
  if (typeof fileField === 'string') return error({ error: true, code: 'file_field_required' });

  const file = fileField;
  if (!file.size) return error({ error: true, code: 'file_empty' });

  if (file.size > MAX_UPLOAD_BYTES) {
    return error({
      error: true,
      code: 'file_too_large',
      params: { maxMebibytes: MAX_UPLOAD_MEBIBYTES },
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspection = inspectUpload(bytes, { name: file.name, claimedType: file.type });
  if (inspection._tag === 'invalid') {
    const message = inspection.code === 'content_unsupported'
      ? 'The file contents are not a supported image, audio file, video file, PDF, or WebVTT caption file.'
      : inspection.code === 'content_type_mismatch'
      ? 'The file contents do not match the media type reported by the browser.'
      : 'The file contents do not match the filename extension.';
    return error({ error: true, code: inspection.code }, 415, message);
  }
  const uploadPolicy = UPLOAD_POLICIES[inspection.upload.kind];
  if (file.size > uploadPolicy.maxBytes) {
    return error(
      {
        error: true,
        code: 'kind_too_large',
        params: {
          kind: inspection.upload.kind,
          maxMebibytes: uploadPolicy.maxMebibytes,
        },
      },
      400,
      `${uploadPolicy.label} must be ${uploadPolicy.maxMebibytes} MB or smaller.`,
    );
  }

  try {
    const stored = await saveUpload(auth, bytes, {
      name: file.name,
      type: inspection.upload.mimeType,
      storage: resolveStorage(ctx.runtime),
      runtime: ctx.runtime,
    });
    const payload: UploadResponse = {
      id: stored.id,
      name: stored.name,
      type: stored.type,
      size: stored.size,
      url: stored.url,
      createdAt: stored.createdAt,
    };
    return json(payload, 201);
  } catch (cause: unknown) {
    (ctx.runtime.diagnostics ?? console).error('file upload failed', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      ...uploadFailureLogFields(cause),
    });
    return error({ error: true, code: 'storage_failed' }, 500);
  }
}

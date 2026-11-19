import { getUpload } from '../../../uploads.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { resolveStorage } from '../../../storage.ts';
import { StorageObjectNotFoundError } from '../../../storage_contract.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Shared bank API endpoint contract and implementation. */
export const uploadContentBankRoute = defineHttpRoute('/uploads/:id', {
  GET: handleGET,
  HEAD: handleGET,
});

export default function _() {
  return null;
}

async function handleGET(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  const result = await getUpload(auth, ctx.params.id);
  if (result.status === 'forbidden') return new Response('Forbidden', { status: 403 });
  if (result.status === 'not_found') return new Response('Not Found', { status: 404 });
  const upload = result.upload;
  try {
    const object = await resolveStorage(ctx.runtime).readObjectStream(upload.path);
    if (object.contentLength !== upload.size || object.contentType !== upload.type) {
      const mismatchFields = {
        tenantId: auth.tenantId,
        uploadId: upload.id,
        expectedContentLength: upload.size,
        actualContentLength: object.contentLength,
        expectedContentType: upload.type,
        actualContentType: object.contentType,
      };
      try {
        await object.body.cancel();
      } catch (cause: unknown) {
        (ctx.runtime.diagnostics ?? console).error(
          'failed to cancel upload body after metadata mismatch',
          {
            ...mismatchFields,
            cause: safeErrorSummary(cause),
          },
        );
      }
      (ctx.runtime.diagnostics ?? console).error(
        'upload storage metadata mismatch',
        mismatchFields,
      );
      return new Response('Internal Server Error', { status: 500 });
    }
    return new Response(object.body, {
      headers: {
        'content-type': object.contentType,
        'cache-control': 'private, no-store, max-age=0',
        'pragma': 'no-cache',
        'content-security-policy':
          "default-src 'none'; script-src 'none'; frame-ancestors 'none'; sandbox",
        'content-length': String(object.contentLength),
      },
    });
  } catch (cause: unknown) {
    (ctx.runtime.diagnostics ?? console).error('failed to read upload', {
      tenantId: auth.tenantId,
      uploadId: upload.id,
      cause: safeErrorSummary(cause),
    });
    return cause instanceof StorageObjectNotFoundError
      ? new Response('Gone', { status: 410 })
      : new Response('Internal Server Error', { status: 500 });
  }
}

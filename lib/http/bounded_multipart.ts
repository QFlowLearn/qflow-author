/** Stable failure codes returned by bounded multipart parsing. */
export type BoundedMultipartFailureCode =
  | 'invalid_content_length'
  | 'invalid_multipart'
  | 'payload_too_large'
  | 'unsupported_media_type';

/** A safe multipart boundary failure suitable for protocol translation. */
export class BoundedMultipartError extends Error {
  readonly _tag = 'BoundedMultipartError' as const;

  constructor(readonly code: BoundedMultipartFailureCode, message: string) {
    super(message);
    this.name = 'BoundedMultipartError';
  }
}

/** Options for parsing a multipart request without unbounded body materialization. */
export type BoundedMultipartOptions = {
  readonly maxBytes: number;
};

/** Parse multipart form data while enforcing the byte cap on declared and streamed bodies. */
export async function parseBoundedMultipartFormData(
  request: Request,
  options: BoundedMultipartOptions,
): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? '';
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'multipart/form-data') {
    await discardRequestBody(request);
    throw new BoundedMultipartError(
      'unsupported_media_type',
      'Expected a multipart request.',
    );
  }
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new Error('Bounded multipart maxBytes must be a positive safe integer.');
  }

  let contentLength: number | null;
  try {
    contentLength = parseContentLength(request.headers.get('content-length'));
  } catch (cause: unknown) {
    await discardRequestBody(request);
    throw cause;
  }
  if (contentLength !== null && contentLength > options.maxBytes) {
    await discardRequestBody(request);
    throw new BoundedMultipartError(
      'payload_too_large',
      'Multipart request exceeds the configured byte limit.',
    );
  }

  let streamedBytes = 0;
  let streamExceededLimit = false;
  const boundedBody = request.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        streamedBytes += chunk.byteLength;
        if (streamedBytes > options.maxBytes) {
          streamExceededLimit = true;
          controller.error(
            new BoundedMultipartError(
              'payload_too_large',
              'Multipart request exceeds the configured byte limit.',
            ),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  ) ?? null;

  try {
    return await new Response(boundedBody, {
      headers: { 'content-type': contentType },
    }).formData();
  } catch (cause: unknown) {
    if (streamExceededLimit) {
      throw new BoundedMultipartError(
        'payload_too_large',
        'Multipart request exceeds the configured byte limit.',
      );
    }
    if (cause instanceof BoundedMultipartError) throw cause;
    throw new BoundedMultipartError('invalid_multipart', 'Unable to parse multipart form data.');
  }
}

async function discardRequestBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // The protocol failure owns this path; cancellation is best-effort cleanup.
  }
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) {
    throw new BoundedMultipartError(
      'invalid_content_length',
      'Multipart Content-Length is invalid.',
    );
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new BoundedMultipartError(
      'payload_too_large',
      'Multipart request exceeds the configured byte limit.',
    );
  }
  return length;
}

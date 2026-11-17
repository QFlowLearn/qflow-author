/** A bounded object-store range request, never a whole-file download. */
export type ObjectByteRange = { readonly offset: number; readonly length: number };

/** Validate a range before issuing a request or allocating its result. */
export function assertObjectByteRange(range: ObjectByteRange): void {
  if (
    !Number.isSafeInteger(range.offset) || range.offset < 0 ||
    !Number.isSafeInteger(range.length) || range.length < 1 ||
    range.length > 8 * 1024 * 1024 || !Number.isSafeInteger(range.offset + range.length)
  ) {
    throw new Error(
      'Object range must be positive, bounded to 8 MiB, and within safe integer offsets.',
    );
  }
}

/** Enforce actual range length even when the backing service sends incorrect metadata. */
export async function readExactObjectRange(
  body: ReadableStream<Uint8Array>,
  length: number,
): Promise<Uint8Array> {
  assertObjectByteRange({ offset: 0, length });
  const reader = body.getReader();
  const bytes = new Uint8Array(length);
  let offset = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (offset + chunk.value.length > length) throw new Error('Object range body is oversized.');
      bytes.set(chunk.value, offset);
      offset += chunk.value.length;
    }
    if (offset !== length) throw new Error('Object range body is truncated.');
    return bytes;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

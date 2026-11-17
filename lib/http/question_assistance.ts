/** Authorized HTTP seam; dependencies own tenant access, throttling, and provider execution. */
export async function handleQuestionAuthoring<Input, Value>(
  request: Request,
  deps: {
    readonly authorize: () => Promise<boolean>;
    readonly parse: (raw: unknown) => Input | null;
    readonly timeoutMs: number;
    readonly execute: (
      input: Input,
      signal: AbortSignal,
    ) => Promise<
      { readonly ok: true; readonly value: Value } | {
        readonly ok: false;
        readonly code: 'unavailable' | 'invalid_response' | 'aborted' | 'limited';
      }
    >;
  },
): Promise<Response> {
  const reply = (data: unknown, status: number) =>
    Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  if (!await deps.authorize()) return reply({ error: 'not_found' }, 404);
  // Bound actual streamed bytes rather than trusting Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: 'invalid_request' }, 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > 52000) {
        await reader.cancel();
        return reply({ error: 'too_large' }, 413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return reply({ error: 'invalid_request' }, 400);
  }
  const input = deps.parse(raw);
  if (!input) return reply({ error: 'invalid_request' }, 400);
  const result = await deps.execute(
    input,
    AbortSignal.any([request.signal, AbortSignal.timeout(deps.timeoutMs)]),
  );
  return result.ok
    ? reply(result.value, 200)
    : reply({ error: result.code }, result.code === 'limited' ? 429 : 503);
}

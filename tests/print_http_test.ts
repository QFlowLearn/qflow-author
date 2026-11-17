import { expect, test } from 'vitest';
import {
  printConfirmHttp,
  printDownloadHttp,
  printPreflightHttp,
} from '../lib/http/assessment_print.ts';
import { makeHttpRequest } from './helpers/http_route.ts';

test('paper HTTP caps actual streamed bytes when the declared request length is absent or false', async () => {
  for (const declared of [undefined, '1']) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(40000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const options = {
      method: 'POST',
      body: stream,
      duplex: 'half',
      headers: declared ? { 'content-length': declared } : undefined,
    };
    const response = await printPreflightHttp(
      makeHttpRequest(
        new Request(
          'http://local/api/assessments/11111111-1111-4111-8111-111111111111/print-packs/preflight',
          options,
        ),
        { omitAuth: true, params: { id: '11111111-1111-4111-8111-111111111111' } },
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_input' });
    expect(cancelled).toBe(true);
  }
});
test('confirmation is nonnull and no delivery endpoint accepts a kind or object-key override', async () => {
  const id = crypto.randomUUID(),
    packId = crypto.randomUUID(),
    base = `http://local/api/assessments/${id}/print-packs/${packId}`;
  const missing = await printConfirmHttp(
    makeHttpRequest(new Request(base + '/confirm', { method: 'POST', body: 'null' }), {
      omitAuth: true,
      params: { id, packId },
    }),
  );
  expect(missing.status).toBe(400);
  for (const kind of ['student', 'marking', 'manifest'] as const) {
    const response = await printDownloadHttp(kind, false)(
      makeHttpRequest(new Request(base + '/' + kind + '?key=another-tenant'), {
        omitAuth: true,
        params: { id, packId },
      }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  }
});

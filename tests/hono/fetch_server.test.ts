import { expect, it } from 'vitest';
import { startFetchServer } from '../helpers/fetch_server.ts';

it('Node Fetch fixtures preserve streamed request/response bodies, cookies and HEAD semantics', async () => {
  const server = await startFetchServer((request) => {
    const headers = new Headers({ 'content-type': 'text/plain', 'x-method': request.method });
    headers.append('set-cookie', 'first=a; Path=/; HttpOnly');
    headers.append('set-cookie', 'second=b; Path=/; SameSite=Lax');
    return new Response(request.method === 'POST' ? request.body : 'head body', { headers });
  });
  try {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first '));
        controller.enqueue(new TextEncoder().encode('second'));
        controller.close();
      },
    });
    const init = { method: 'POST', body, duplex: 'half' as const };
    const response = await fetch(server.origin, init);
    expect(await response.text()).toBe('first second');
    expect(response.headers.getSetCookie()).toEqual([
      'first=a; Path=/; HttpOnly',
      'second=b; Path=/; SameSite=Lax',
    ]);
    const head = await fetch(server.origin, { method: 'HEAD' });
    expect(await head.text()).toBe('');
    expect(head.headers.get('x-method')).toBe('HEAD');
    expect(head.headers.getSetCookie()).toHaveLength(2);
  } finally {
    await server.close();
    await server.close();
  }
});

it('disconnect aborts an owned handler and closing releases the listening port', async () => {
  let started = false;
  const aborted = Promise.withResolvers<void>();
  const server = await startFetchServer(async (request) => {
    started = true;
    await new Promise<void>((done) =>
      request.signal.addEventListener('abort', () => {
        aborted.resolve();
        done();
      }, { once: true })
    );
    return new Response('cancelled');
  });
  const abort = new AbortController();
  const pending = fetch(server.origin, { signal: abort.signal }).catch(() => null);
  try {
    await expect.poll(() => started, { timeout: 3000 }).toBe(true);
    abort.abort();
    await aborted.promise;
    expect(await pending).toBeNull();
  } finally {
    abort.abort();
    await server.close();
  }
  await expect(fetch(server.origin)).rejects.toThrow();
});

it('cancelling a streamed HTTP response cancels the Fetch body owned by the server', async () => {
  let cancelled = false;
  const server = await startFetchServer(() =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('first'));
        },
        cancel() {
          cancelled = true;
        },
      }),
    )
  );
  try {
    const response = await fetch(server.origin);
    if (!response.body) throw new Error('Expected a streamed response.');
    const reader = response.body.getReader();
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('first');
      await reader.cancel();
      await expect.poll(() => cancelled, { timeout: 3000 }).toBe(true);
    } finally {
      reader.releaseLock();
    }
  } finally {
    await server.close();
  }
});

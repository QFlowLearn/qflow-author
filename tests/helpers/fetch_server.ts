import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { safeErrorSummary } from '../../lib/error_summary.ts';

/** One owned loopback Fetch fixture. Application browser tests use the built Worker instead. */
export type FetchFixtureServer = {
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
};

/** Bridge protocol fixtures to Node HTTP with streamed bodies, multiple cookies and awaited shutdown. */
export async function startFetchServer(
  handler: (request: Request) => Response | Promise<Response>,
): Promise<FetchFixtureServer> {
  const active = new Set<Promise<void>>();
  const requests = new Set<AbortController>();
  let defects = 0;
  const server = createServer((incoming, outgoing) => {
    const abort = new AbortController();
    requests.add(abort);
    const operation = serve(incoming, outgoing, abort, handler).catch(() => {
      defects += 1;
      outgoing.destroy();
    }).finally(() => {
      requests.delete(abort);
      active.delete(operation);
    });
    // The server owns every operation, catches its failures and awaits the set during close.
    active.add(operation);
  });
  await new Promise<void>((done, reject) => {
    const failed = (cause: unknown) => reject(cause);
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', failed);
      done();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((done) => server.close(() => done()));
    throw new Error('Fetch fixture did not acquire a loopback port.');
  }
  let closing: Promise<void> | undefined;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close() {
      return closing ??= (async () => {
        for (const request of requests) request.abort();
        const closed = new Promise<void>((done, reject) => {
          server.close((cause) => cause ? reject(cause) : done());
        });
        server.closeAllConnections();
        await closed;
        await Promise.all([...active]);
        if (defects) throw new Error('Fetch fixture left a failed request operation.');
      })();
    },
  };
}

async function serve(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  abort: AbortController,
  handler: (request: Request) => Response | Promise<Response>,
): Promise<void> {
  const cancel = () => abort.abort();
  const closed = () => {
    if (!outgoing.writableFinished) cancel();
  };
  incoming.once('aborted', cancel);
  outgoing.once('close', closed);
  try {
    const headers = new Headers();
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      const key = incoming.rawHeaders[index], value = incoming.rawHeaders[index + 1];
      if (key && value !== undefined && key.toLowerCase() !== 'cookie') headers.append(key, value);
    }
    if (incoming.headers.cookie) headers.set('cookie', incoming.headers.cookie);
    const method = incoming.method;
    const target = incoming.url;
    if (!method || !target) throw new Error('Incomplete fixture request line.');
    const address = incoming.socket.localAddress;
    const port = incoming.socket.localPort;
    if (address !== '127.0.0.1' || port === undefined) {
      throw new Error('Unexpected fixture address.');
    }
    const hasBody = method !== 'GET' && method !== 'HEAD';
    // SAFETY: raw IncomingMessage is not in object mode and emits Uint8Array/Buffer chunks.
    const body = hasBody ? Readable.toWeb(incoming) as ReadableStream<Uint8Array> : undefined;
    const init = {
      method,
      headers,
      signal: abort.signal,
      ...(body ? { body, duplex: 'half' as const } : {}),
    };
    const request = new Request(new URL(target, `http://127.0.0.1:${port}`), init);
    const response = await handler(request);
    if (abort.signal.aborted) {
      await response.body?.cancel();
      return;
    }
    outgoing.statusCode = response.status;
    outgoing.statusMessage = response.statusText;
    for (const [name, value] of response.headers) {
      if (name !== 'set-cookie') outgoing.setHeader(name, value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader('set-cookie', cookies);
    if (method === 'HEAD' || !response.body) {
      await response.body?.cancel();
      outgoing.end();
      return;
    }
    // SAFETY: a Node 24 Fetch Response body is the platform's standard WHATWG byte stream.
    const stream = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
    await pipeline(stream, outgoing, { signal: abort.signal });
  } catch (cause: unknown) {
    if (abort.signal.aborted) {
      outgoing.destroy();
      return;
    }
    console.error(`Fetch fixture failed: ${safeErrorSummary(cause)}`);
    if (outgoing.headersSent) outgoing.destroy();
    else {
      outgoing.statusCode = 500;
      outgoing.end('Fixture request failed.');
    }
  } finally {
    incoming.off('aborted', cancel);
    outgoing.off('close', closed);
  }
}

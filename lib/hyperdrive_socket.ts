import { createConnection, type Socket } from 'node:net';

/**
 * Use Workers' native Node socket lifecycle for Hyperdrive's internal plaintext endpoint.
 * Postgres.js 3.4.9's CF socket polyfill throws after removing its error listeners on close:
 * https://github.com/porsager/postgres/issues/1202
 * Hyperdrive owns TLS to the origin; this adapter never disables origin TLS settings.
 */
export function hyperdriveSocket(databaseUrl: string): () => Promise<Socket> {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('Hyperdrive connection string is invalid.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.searchParams.has('ssl') ||
    url.searchParams.has('sslmode') && url.searchParams.get('sslmode') !== 'disable'
  ) {
    throw new Error('Hyperdrive requires its internal connection string with SSL disabled.');
  }
  return () =>
    new Promise((resolve, reject) => {
      const socket = createConnection({
        host: url.hostname.replace(/^\[|\]$/g, ''),
        port: Number(url.port || 5432),
      });
      // Own a connection deadline, not a socket inactivity timeout. In the pinned
      // Workers runtime, setTimeout(0) can leave the earlier socket timer armed.
      const deadline = setTimeout(() => {
        socket.destroy(new Error('Hyperdrive connection timed out.'));
      }, 30000);
      function failed(error: Error) {
        clearTimeout(deadline);
        socket.removeListener('connect', connected);
        socket.removeListener('close', closed);
        reject(error);
      }
      function closed() {
        failed(new Error('Hyperdrive connection closed before connecting.'));
      }
      function connected() {
        clearTimeout(deadline);
        socket.removeListener('error', failed);
        socket.removeListener('close', closed);
        resolve(socket);
      }
      socket.once('error', failed);
      socket.once('close', closed);
      socket.once('connect', connected);
    });
}

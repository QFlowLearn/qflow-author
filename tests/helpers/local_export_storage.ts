import { expect } from 'vitest';
import { startFetchServer } from './fetch_server.ts';

import { sha256Hex } from '../../lib/sha256.ts';
import { createMemoryObjectStorage } from '../memory_object_storage.ts';

/**
 * Test-owned loopback HTTP fixture for immutable export objects. The application's real
 * S3 adapter still signs and sends every request. This fixture checks payload identity and
 * conditional writes; it is not an independent implementation of AWS signature verification.
 */
export async function openLocalExportStorage() {
  const storage = createMemoryObjectStorage();
  const keys = new Set<string>();
  const requests: { method: string; key: string }[] = [];
  const bucket = 'qa-export-artifacts';
  const accessKey = 'qa-local-access-key';
  const server = await startFetchServer(async (request) => {
    const path = new URL(request.url).pathname;
    const prefix = `/${bucket}/`;
    if (!path.startsWith(prefix)) return new Response(null, { status: 404 });
    const key = decodeURIComponent(path.slice(prefix.length));
    if (!/^assessment-export-artifacts\/[\da-f-]+\/[\da-f-]+\/[\da-f]{64}\.package$/.test(key)) {
      return new Response(null, { status: 400 });
    }
    if (
      !request.headers.get('authorization')?.startsWith(`AWS4-HMAC-SHA256 Credential=${accessKey}/`)
    ) {
      return new Response(null, { status: 403 });
    }
    requests.push({ method: request.method, key });
    if (request.method === 'PUT') {
      const data = new Uint8Array(await request.arrayBuffer());
      const sha256 = request.headers.get('x-amz-meta-qflow-sha256');
      const contentType = request.headers.get('content-type');
      if (
        !sha256 || !contentType || request.headers.get('if-none-match') !== '*' ||
        await sha256Hex(data) !== sha256 || request.headers.get('x-amz-content-sha256') !== sha256
      ) return new Response(null, { status: 400 });
      if (keys.has(key)) return new Response(null, { status: 412 });
      await storage.putObject({ key, data, contentType, immutableIdentity: { sha256 } });
      keys.add(key);
      return new Response(null, { status: 200 });
    }
    if (!keys.has(key)) return new Response(null, { status: 404 });
    if (request.method === 'GET' || request.method === 'HEAD') {
      const object = await storage.readObjectStream(key);
      if (!(object.contentSha256)) expect.unreachable('Expected object.contentSha256');
      const headers = {
        'content-length': String(object.contentLength),
        'content-type': object.contentType,
        'x-amz-meta-qflow-sha256': object.contentSha256,
      };
      if (request.method === 'HEAD') {
        await object.body.cancel();
        return new Response(null, { headers });
      }
      return new Response(object.body, { headers });
    }
    if (request.method === 'DELETE') {
      await storage.deleteObject(key);
      keys.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  });
  return {
    environment: {
      QFLOW_STORAGE_BACKEND: 's3-compatible',
      R2_ENDPOINT: `http://127.0.0.1:${server.port}`,
      R2_ACCESS_KEY_ID: accessKey,
      R2_SECRET_ACCESS_KEY: 'qa-local-secret-key',
      R2_BUCKET: bucket,
      R2_FORCE_PATH_STYLE: 'true',
    },
    requests,
    close: () => server.close(),
  };
}

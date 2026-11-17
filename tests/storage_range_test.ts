import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';

import { createS3CompatibleStorage } from '../lib/storage/s3_compatible_storage.ts';
import { readExactObjectRange } from '../lib/storage/object_range.ts';

testCase('S3 ranges require a correctly signed range and an exact partial response', async () => {
  let mode: 'valid' | 'ignored' | 'wrong' | 'truncated' | 'oversized' = 'valid';
  const server = await startFetchServer((request) => {
    expect(request.headers.get('range')).toStrictEqual('bytes=2-4');
    expect(request.headers.get('authorization')?.includes('host;range;')).toStrictEqual(true);
    const headers = { 'content-range': mode === 'wrong' ? 'bytes 3-5/6' : 'bytes 2-4/6' };
    return new Response(mode === 'truncated' ? 'cd' : mode === 'oversized' ? 'cdef' : 'cde', {
      status: mode === 'ignored' ? 200 : 206,
      headers,
    });
  });
  try {
    const storage = createS3CompatibleStorage({
      endpoint: `http://127.0.0.1:${server.port}`,
      bucket: 'test',
      accessKeyId: 'test',
      secretAccessKey: 'test',
    });
    expect(await storage.readObjectRange('object', 2, 3)).toStrictEqual(
      new TextEncoder().encode('cde'),
    );
    for (const rejected of ['ignored', 'wrong', 'truncated', 'oversized'] as const) {
      mode = rejected;
      await expect(Promise.resolve().then(() => storage.readObjectRange('object', 2, 3))).rejects
        .toBeInstanceOf(Error);
    }
    await expect(Promise.resolve().then(() => storage.readObjectRange('object', -1, 3))).rejects
      .toBeInstanceOf(Error);
    await expect(
      Promise.resolve().then(() => storage.readObjectRange('object', 0, 9 * 1024 * 1024)),
    ).rejects.toBeInstanceOf(Error);
  } finally {
    await server.close();
  }
});

testCase(
  'oversized object streams are cancelled before collecting the rest of the body',
  async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(10));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(Promise.resolve().then(() => readExactObjectRange(stream, 5))).rejects.toSatisfy((
      caught: unknown,
    ) => caught instanceof Error && caught.message.includes('oversized'));
    expect(cancelled).toStrictEqual(true);
  },
);

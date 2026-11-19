import { http } from 'msw/http';
import { setupServer } from 'msw/node';
import { expect, test as testCase } from 'vitest';

import { resolveStorage } from '../lib/storage.ts';
import { createR2BindingStorage } from '../lib/storage/r2_binding_storage.ts';
import { createS3CompatibleStorage } from '../lib/storage/s3_compatible_storage.ts';
import {
  type ObjectStorage,
  StorageObjectIdentityConflictError,
  StorageObjectNotFoundError,
} from '../lib/storage_contract.ts';

testCase('createS3CompatibleStorage signs path-style R2 uploads', async () => {
  const storage = createS3CompatibleStorage({
    endpoint: 'https://example.r2.test',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
    bucket: 'test-bucket',
    forcePathStyle: true,
  });
  const body = new TextEncoder().encode('hello');
  const calls: Array<{ url: string; init: RequestInit }> = [];

  await withStorageResponses((input, init) => {
    calls.push({ url: toUrlString(input), init: init ?? {} });
    return new Response(null, { status: 200 });
  }, async () => {
    await storage.putObject({
      key: 'folder/file name.txt',
      data: body,
      contentType: 'text/plain',
    });
  });

  expect(calls.length).toStrictEqual(1);
  expect(calls[0].url).toStrictEqual('https://example.r2.test/test-bucket/folder/file%20name.txt');
  const headers = new Headers(calls[0].init.headers);
  expect(headers.get('content-type')).toStrictEqual('text/plain');
  expect(headers.get('x-amz-content-sha256')).toStrictEqual(
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  );
  expect(headers.get('x-amz-date') ?? '').toMatch(/^\d{8}T\d{6}Z$/);
  expect(headers.get('authorization') ?? '').toMatch(
    /^AWS4-HMAC-SHA256 Credential=test-access\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
  );
  expect(new TextDecoder().decode(new Uint8Array(calls[0].init.body as ArrayBuffer))).toStrictEqual(
    'hello',
  );
});

testCase('createS3CompatibleStorage signs idempotent object deletes', async () => {
  const storage = createS3CompatibleStorage({
    endpoint: 'https://example.r2.test',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
    bucket: 'test-bucket',
  });
  const requests: Array<{ url: string; init: RequestInit }> = [];

  await withStorageResponses((input, init) => {
    requests.push({ url: toUrlString(input), init: init ?? {} });
    return new Response(null, { status: 404 });
  }, () => storage.deleteObject('uploads/tenant/file name.png'));

  expect(requests[0]?.url).toStrictEqual(
    'https://example.r2.test/test-bucket/uploads/tenant/file%20name.png',
  );
  expect(requests[0]?.init.method).toStrictEqual('DELETE');
  expect(new Headers(requests[0]?.init.headers).get('authorization') ?? '').toContain(
    'SignedHeaders=',
  );
});

testCase(
  'createS3CompatibleStorage conditionally creates immutable objects with identity metadata',
  async () => {
    const storage = createS3CompatibleStorage({
      endpoint: 'https://example.r2.test',
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
      bucket: 'test-bucket',
    });
    const body = new TextEncoder().encode('hello');
    const sha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    let requestHeaders = new Headers();

    await withStorageResponses((_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(null, { status: 200 });
    }, () =>
      storage.putObject({
        key: 'exports/package.zip',
        data: body,
        contentType: 'application/zip',
        immutableIdentity: { sha256 },
      }));

    expect(requestHeaders.get('if-none-match')).toStrictEqual('*');
    expect(requestHeaders.get('x-amz-meta-qflow-sha256')).toStrictEqual(sha256);
    expect(requestHeaders.get('authorization') ?? '').toContain('if-none-match');
    expect(requestHeaders.get('authorization') ?? '').toContain('x-amz-meta-qflow-sha256');
  },
);

testCase(
  'createS3CompatibleStorage rejects a false immutable content identity before upload',
  async () => {
    const storage = createS3CompatibleStorage({
      endpoint: 'https://example.r2.test',
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
      bucket: 'test-bucket',
    });
    let fetchCalled = false;

    await withStorageResponses(() => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    }, async () => {
      await expect(
        Promise.resolve().then(() =>
          storage.putObject({
            key: 'exports/package.zip',
            data: new TextEncoder().encode('actual bytes'),
            contentType: 'application/zip',
            immutableIdentity: { sha256: '0'.repeat(64) },
          })
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('do not match their SHA-256 identity')
      );
    });
    expect(fetchCalled).toStrictEqual(false);
  },
);

testCase('createS3CompatibleStorage accepts only an exact immutable replay', async () => {
  const storage = createS3CompatibleStorage({
    endpoint: 'https://example.r2.test',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
    bucket: 'test-bucket',
  });
  const body = new TextEncoder().encode('hello');
  const sha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  let headMatches = true;

  await withStorageResponses((_input, init) => {
    if (init?.method === 'PUT') return new Response(null, { status: 412 });
    return new Response(null, {
      status: 200,
      headers: {
        'content-length': String(body.byteLength),
        'content-type': 'application/zip',
        'x-amz-meta-qflow-sha256': headMatches ? sha256 : 'f'.repeat(64),
      },
    });
  }, async () => {
    const input = {
      key: 'exports/package.zip',
      data: body,
      contentType: 'application/zip',
      immutableIdentity: { sha256 },
    } as const;
    await storage.putObject(input);
    headMatches = false;
    await expect(Promise.resolve().then(() => storage.putObject(input))).rejects.toSatisfy((
      caught: unknown,
    ) =>
      caught instanceof StorageObjectIdentityConflictError &&
      caught.message.includes('Immutable storage object identity conflict')
    );
  });
});

testCase('createS3CompatibleStorage signs vhost-style R2 reads', async () => {
  const storage = createS3CompatibleStorage({
    endpoint: 'https://example.r2.test',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
    bucket: 'test-bucket',
    forcePathStyle: false,
  });
  const calls: Array<{ url: string; init: RequestInit }> = [];

  const bytes = await withStorageResponses((input, init) => {
    calls.push({ url: toUrlString(input), init: init ?? {} });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }, async () => await storage.readObject('nested/image.png'));

  expect(calls.length).toStrictEqual(1);
  expect(calls[0].url).toStrictEqual('https://test-bucket.example.r2.test/nested/image.png');
  const headers = new Headers(calls[0].init.headers);
  expect(headers.get('x-amz-content-sha256')).toStrictEqual(
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  expect(headers.get('x-amz-date') ?? '').toMatch(/^\d{8}T\d{6}Z$/);
  expect(headers.get('authorization') ?? '').toMatch(
    /^AWS4-HMAC-SHA256 Credential=test-access\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
  );
  expect(Array.from(bytes)).toStrictEqual([1, 2, 3]);
});

testCase(
  'createS3CompatibleStorage exposes an object response as a metadata-bound stream',
  async () => {
    const storage = createS3CompatibleStorage({
      endpoint: 'https://example.r2.test',
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
      bucket: 'test-bucket',
    });
    const streamed = await withStorageResponses(
      () =>
        new Response(Uint8Array.of(4, 5, 6), {
          headers: {
            'content-length': '3',
            'content-type': 'application/zip',
            'x-amz-meta-qflow-sha256': 'a'.repeat(64),
          },
        }),
      () => storage.readObjectStream('exports/package.zip'),
    );

    expect(streamed.contentLength).toStrictEqual(3);
    expect(streamed.contentType).toStrictEqual('application/zip');
    expect(streamed.contentSha256).toStrictEqual('a'.repeat(64));
    expect(Array.from(new Uint8Array(await new Response(streamed.body).arrayBuffer())))
      .toStrictEqual([4, 5, 6]);
  },
);

testCase('createS3CompatibleStorage maps 404 responses to StorageObjectNotFoundError', async () => {
  const storage = createS3CompatibleStorage({
    endpoint: 'https://example.r2.test',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
    bucket: 'test-bucket',
    forcePathStyle: true,
  });
  await withStorageResponses(
    () => new Response('missing', { status: 404 }),
    async () => {
      await expect(Promise.resolve().then(() => storage.readObject('missing.txt'))).rejects
        .toSatisfy((caught: unknown) =>
          caught instanceof StorageObjectNotFoundError &&
          caught.message.includes('Storage object not found: missing.txt')
        );
    },
  );
});

testCase('createR2BindingStorage writes and reads through R2 bucket binding', async () => {
  const calls: Array<{
    key: string;
    value: Uint8Array | ArrayBuffer | ReadableStream;
    contentType?: string;
  }> = [];
  const stored = new Map<string, Uint8Array>();
  const storage = createR2BindingStorage({
    put(key, value, options) {
      calls.push({ key, value, contentType: options?.httpMetadata?.contentType });
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
      stored.set(key, bytes);
      return Promise.resolve();
    },
    get(key) {
      const bytes = stored.get(key);
      if (!bytes) return Promise.resolve(null);
      const copy = new Uint8Array(bytes);
      return Promise.resolve({
        arrayBuffer() {
          return Promise.resolve(copy.slice().buffer);
        },
        body: streamFromBytes(copy),
        size: copy.byteLength,
        httpMetadata: { contentType: 'image/png' },
      });
    },
    delete(key) {
      stored.delete(key);
      return Promise.resolve();
    },
  });

  await storage.putObject({
    key: 'uploads/tenant/file.png',
    data: new Uint8Array([1, 2, 3]),
    contentType: 'image/png',
  });
  const data = await storage.readObject('uploads/tenant/file.png');
  const streamed = await storage.readObjectStream('uploads/tenant/file.png');

  expect(calls.length).toStrictEqual(1);
  expect(calls[0].key).toStrictEqual('uploads/tenant/file.png');
  expect(calls[0].contentType).toStrictEqual('image/png');
  expect(Array.from(data)).toStrictEqual([1, 2, 3]);
  expect(streamed.contentLength).toStrictEqual(3);
  expect(streamed.contentType).toStrictEqual('image/png');
  expect(streamed.contentSha256).toStrictEqual(null);
  expect(Array.from(new Uint8Array(await new Response(streamed.body).arrayBuffer()))).toStrictEqual(
    [1, 2, 3],
  );
  await storage.deleteObject('uploads/tenant/file.png');
  await expect(Promise.resolve().then(() => storage.readObject('uploads/tenant/file.png'))).rejects
    .toBeInstanceOf(StorageObjectNotFoundError);
});

testCase(
  'createR2BindingStorage verifies exact immutable replays against stored checksums',
  async () => {
    const sha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    const body = new TextEncoder().encode('hello');
    let requestedOptions: Parameters<Parameters<typeof createR2BindingStorage>[0]['put']>[2];
    const storage = createR2BindingStorage({
      put(_key, _value, options) {
        requestedOptions = options;
        return Promise.resolve(null);
      },
      get() {
        return Promise.resolve({
          arrayBuffer: () => Promise.resolve(body.slice().buffer),
          body: streamFromBytes(body),
          size: body.byteLength,
          httpMetadata: { contentType: 'application/zip' },
          customMetadata: { 'qflow-sha256': sha256 },
          checksums: { sha256: arrayBufferFromHex(sha256) },
        });
      },
      delete() {
        return Promise.resolve();
      },
    });

    await storage.putObject({
      key: 'exports/package.zip',
      data: body,
      contentType: 'application/zip',
      immutableIdentity: { sha256 },
    });
    expect(requestedOptions?.onlyIf).toStrictEqual({ etagDoesNotMatch: '*' });
    expect(requestedOptions?.sha256).toStrictEqual(sha256);
    expect(requestedOptions?.customMetadata).toStrictEqual({ 'qflow-sha256': sha256 });
  },
);

testCase('createR2BindingStorage cancels opened bodies whose metadata is invalid', async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      canceled = true;
    },
  });
  const storage = createR2BindingStorage({
    put() {
      return Promise.resolve();
    },
    get() {
      return Promise.resolve({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        body,
        size: 0,
      });
    },
    delete() {
      return Promise.resolve();
    },
  });

  await expect(Promise.resolve().then(() => storage.readObjectStream('missing-metadata.bin')))
    .rejects.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('missing required streaming metadata')
    );
  expect(canceled).toStrictEqual(true);
});

testCase('createR2BindingStorage maps missing objects to StorageObjectNotFoundError', async () => {
  const storage = createR2BindingStorage({
    put() {
      return Promise.resolve();
    },
    get() {
      return Promise.resolve(null);
    },
    delete() {
      return Promise.resolve();
    },
  });

  await expect(Promise.resolve().then(() => storage.readObject('missing.txt'))).rejects.toSatisfy((
    caught: unknown,
  ) =>
    caught instanceof StorageObjectNotFoundError &&
    caught.message.includes('Storage object not found: missing.txt')
  );
});

testCase('resolveStorage uses QFLOW_UPLOADS binding from Worker env when configured', async () => {
  const bucket = fakeR2Bucket(new Map([['file.txt', new TextEncoder().encode('from-binding')]]));
  const state: { storage?: ObjectStorage } = {};

  const storage = resolveStorage({
    state,
    bindings: { QFLOW_STORAGE_BACKEND: 'r2-binding', QFLOW_UPLOADS: bucket },
  });

  const data = await storage.readObject('file.txt');
  expect(new TextDecoder().decode(data)).toStrictEqual('from-binding');
  expect(state.storage).toStrictEqual(storage);
});

testCase(
  'resolveStorage uses explicit S3-compatible runtime bindings when configured',
  async () => {
    const state: { storage?: ObjectStorage } = {};
    const calls: Array<{ url: string; init: RequestInit }> = [];

    await withStorageResponses((input, init) => {
      calls.push({ url: toUrlString(input), init: init ?? {} });
      return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
    }, async () => {
      const storage = resolveStorage({
        state,
        bindings: {
          QFLOW_STORAGE_BACKEND: 's3-compatible',
          R2_ENDPOINT: 'https://runtime.r2.test',
          R2_ACCESS_KEY_ID: 'runtime-access',
          R2_SECRET_ACCESS_KEY: 'runtime-secret',
          R2_BUCKET: 'runtime-bucket',
          R2_FORCE_PATH_STYLE: 'true',
        },
      });
      const data = await storage.readObject('asset.bin');
      expect(Array.from(data)).toStrictEqual([4, 5, 6]);
    });

    expect(calls.length).toStrictEqual(1);
    expect(calls[0].url).toStrictEqual('https://runtime.r2.test/runtime-bucket/asset.bin');
    expect(state.storage).toStrictEqual(resolveStorage({ state }));
  },
);

testCase('resolveStorage fails fast when QFLOW_STORAGE_BACKEND is missing', () => {
  expect(() => {
    resolveStorage({ state: {} });
  }).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error &&
      caught.message.includes('Missing required env var QFLOW_STORAGE_BACKEND')
    ),
  );
});

testCase('resolveStorage fails fast when r2-binding is missing QFLOW_UPLOADS', () => {
  expect(() => {
    resolveStorage({
      state: {},
      bindings: { QFLOW_STORAGE_BACKEND: 'r2-binding' },
    });
  }).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error &&
      caught.message.includes(
        'QFLOW_STORAGE_BACKEND=r2-binding requires the QFLOW_UPLOADS R2 binding.',
      )
    ),
  );
});

testCase('resolveStorage fails fast when QFLOW_STORAGE_BACKEND is invalid', () => {
  expect(() => {
    resolveStorage({
      state: {},
      bindings: { QFLOW_STORAGE_BACKEND: 'memory' },
    });
  }).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error &&
      caught.message.includes(
        'Invalid QFLOW_STORAGE_BACKEND "memory". Expected "r2-binding" or "s3-compatible".',
      )
    ),
  );
});

testCase('resolveStorage fails fast when R2_FORCE_PATH_STYLE is invalid', () => {
  expect(() => {
    resolveStorage({
      state: {},
      bindings: {
        QFLOW_STORAGE_BACKEND: 's3-compatible',
        R2_ENDPOINT: 'https://runtime.r2.test',
        R2_ACCESS_KEY_ID: 'runtime-access',
        R2_SECRET_ACCESS_KEY: 'runtime-secret',
        R2_BUCKET: 'runtime-bucket',
        R2_FORCE_PATH_STYLE: 'sometimes',
      },
    });
  }).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error &&
      caught.message.includes('Invalid R2_FORCE_PATH_STYLE "sometimes". Expected a boolean value.')
    ),
  );
});

testCase('resolveStorage returns existing injected storage', async () => {
  const existing: ObjectStorage = {
    putObject() {
      return Promise.resolve();
    },
    readObject() {
      return Promise.resolve(new TextEncoder().encode('existing'));
    },
    readObjectRange() {
      throw new Error('Existing storage fixture does not read ranges.');
    },
    readObjectStream() {
      throw new Error('Existing storage fixture does not stream objects.');
    },
    deleteObject() {
      return Promise.resolve();
    },
  };
  const state: { storage?: ObjectStorage } = { storage: existing };

  const storage = resolveStorage({ state });

  expect(storage).toStrictEqual(existing);
  expect(new TextDecoder().decode(await storage.readObject('file.txt'))).toStrictEqual('existing');
});

function fakeR2Bucket(stored: Map<string, Uint8Array>) {
  return {
    put(key: string, value: Uint8Array | ArrayBuffer | ReadableStream) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
      stored.set(key, bytes);
      return Promise.resolve();
    },
    get(key: string) {
      const bytes = stored.get(key);
      if (!bytes) return Promise.resolve(null);
      return Promise.resolve({
        arrayBuffer() {
          const copy = new Uint8Array(bytes);
          return Promise.resolve(copy.buffer);
        },
      });
    },
    delete(key: string) {
      stored.delete(key);
      return Promise.resolve();
    },
  };
}

async function withStorageResponses<T>(
  respond: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const network = setupServer(
    http.all(
      /^https:\/\/(?:(?:test-bucket\.)?example|runtime)\.r2\.test\//,
      async ({ request }) => {
        const body = request.body ? await request.arrayBuffer() : undefined;
        return await respond(request.url, {
          method: request.method,
          headers: request.headers,
          body,
        });
      },
    ),
  );
  network.listen({ onUnhandledFrame: 'error' });
  try {
    return await fn();
  } finally {
    network.close();
  }
}

function toUrlString(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.toString();
  if (typeof input === 'string') return input;
  return input.url;
}

function bytesFromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function arrayBufferFromHex(value: string): ArrayBuffer {
  const bytes = bytesFromHex(value);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

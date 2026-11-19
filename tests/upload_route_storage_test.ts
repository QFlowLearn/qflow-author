import { inspect } from 'node:util';
import { diagnosticConsole } from './helpers/diagnostic_console.ts';
import { expect, test as testCase } from 'vitest';

import { uploadBankRoute as uploadHandlerEndpoint } from '../lib/http/routes/bank_api/upload.ts';
import { makeHttpRequest } from './helpers/http_route.ts';
import type { ObjectStorage, ObjectWriteLifecycle, ObjectWriter } from '../lib/storage_contract.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { MAX_UPLOAD_REQUEST_BYTES } from '../lib/upload_policy.ts';

const uploadHandler = uploadHandlerEndpoint.handle;

function uploadContext(
  req: Request,
  state: {
    readonly auth?: RequestContext;
    readonly storage?: Partial<ObjectStorage>;
    readonly diagnostics?: Pick<Console, 'error'>;
  },
): Parameters<typeof uploadHandler>[0] {
  return makeHttpRequest(req, {
    auth: state.auth,
    omitAuth: !state.auth,
    state: { storage: state.storage, runtime: { diagnostics: state.diagnostics } },
  });
}

testCase('/api/uploads removes staged objects when metadata persistence fails', async () => {
  const diagnostics = diagnosticConsole();
  const writes: Array<{ key: string; data: Uint8Array; contentType?: string }> = [];
  const deletes: string[] = [];
  const storage: ObjectWriteLifecycle = {
    putObject(input) {
      writes.push(input);
      return Promise.resolve();
    },
    deleteObject(key) {
      deletes.push(key);
      return Promise.resolve();
    },
  };
  const auth: RequestContext = {
    tenantId: 'tenant-route-storage',
    userId: 'user-route-storage',
    role: 'owner',
  };
  const form = new FormData();
  form.set(
    'file',
    new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      'sample.png',
      { type: 'image/png' },
    ),
  );
  const req = new Request('http://local/api/uploads', {
    ...{ duplex: 'half' },
    method: 'POST',
    body: form,
  });

  const result = await uploadHandler(
    uploadContext(req, { auth, storage, diagnostics: diagnostics.console }),
  );
  if (!(result instanceof Response)) throw new Error('Expected upload handler response.');
  const response = result;

  expect(response.status).toStrictEqual(500);
  expect(writes.length).toStrictEqual(1);
  expect(writes[0].key.startsWith('uploads/tenant-route-storage/')).toStrictEqual(true);
  expect(Array.from(writes[0].data)).toStrictEqual([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]);
  expect(writes[0].contentType).toStrictEqual('image/png');
  expect(deletes).toStrictEqual([writes[0].key]);
});

testCase('/api/uploads accepts audio and preserves its media type', async () => {
  const diagnostics = diagnosticConsole();
  const writes: Array<{ key: string; data: Uint8Array; contentType?: string }> = [];
  const storage: ObjectWriter = {
    putObject(input) {
      writes.push(input);
      throw new Error('stop before db insert');
    },
  };
  const auth: RequestContext = {
    tenantId: 'tenant-audio-upload',
    userId: 'user-audio-upload',
    role: 'owner',
  };
  const form = new FormData();
  form.set(
    'file',
    new File([new Uint8Array([73, 68, 51])], 'instructions.mp3', { type: 'audio/mpeg' }),
  );
  const req = new Request('http://local/api/uploads', {
    ...{ duplex: 'half' },
    method: 'POST',
    body: form,
  });
  const result = await uploadHandler(
    uploadContext(req, { auth, storage, diagnostics: diagnostics.console }),
  );
  if (!(result instanceof Response)) throw new Error('Expected upload handler response.');
  expect(result.status).toStrictEqual(500);

  expect(writes.length).toStrictEqual(1);
  expect(writes[0].contentType).toStrictEqual('audio/mpeg');
  expect(writes[0].key.startsWith('uploads/tenant-audio-upload/')).toStrictEqual(true);
});

testCase('/api/uploads records safe cleanup identity when object compensation fails', async () => {
  const diagnostics = diagnosticConsole();
  const writes: Array<{ key: string; data: Uint8Array; contentType?: string }> = [];
  const storage: ObjectWriteLifecycle = {
    putObject(input) {
      writes.push(input);
      return Promise.resolve();
    },
    deleteObject() {
      return Promise.reject(new Error('Simulated object cleanup failure.'));
    },
  };
  const auth: RequestContext = {
    tenantId: 'tenant-cleanup-required',
    userId: 'user-cleanup-required',
    role: 'owner',
  };
  const form = new FormData();
  form.set(
    'file',
    new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      'private-name.png',
      { type: 'image/png' },
    ),
  );
  const req = new Request('http://local/api/uploads', {
    ...{ duplex: 'half' },
    method: 'POST',
    body: form,
  });

  const result = await uploadHandler(
    uploadContext(req, { auth, storage, diagnostics: diagnostics.console }),
  );
  if (!(result instanceof Response)) throw new Error('Expected upload handler response.');
  const response = result;

  expect(response.status).toStrictEqual(500);
  expect(writes.length).toStrictEqual(1);
  const output = diagnostics.text();
  expect(output.trim()).toStrictEqual(
    'file upload failed ' +
      inspect(
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          cause: 'UploadCleanupRequiredError',
          cleanupRequired: true,
          uploadId: writes[0].key.split('/').at(-1),
          objectKey: writes[0].key,
          persistenceCause: 'Error',
          cleanupCause: 'Error',
        },
        { depth: null, colors: false },
      ),
  );
  expect(output).not.toContain('private-name.png');
  expect(writes[0].key.includes('private-name.png')).toStrictEqual(false);
});

testCase('/api/uploads rejects unsupported executable files before storage', async () => {
  const writes: Array<{ key: string; data: Uint8Array; contentType?: string }> = [];
  const storage: ObjectWriter = {
    putObject(input) {
      writes.push(input);
      return Promise.resolve();
    },
  };
  const auth: RequestContext = {
    tenantId: 'tenant-rejected-upload',
    userId: 'user-rejected-upload',
    role: 'owner',
  };
  const form = new FormData();
  form.set(
    'file',
    new File([new Uint8Array([1])], 'payload.exe', {
      type: 'application/x-msdownload',
    }),
  );
  const req = new Request('http://local/api/uploads', {
    ...{ duplex: 'half' },
    method: 'POST',
    body: form,
  });
  const result = await uploadHandler(uploadContext(req, { auth, storage }));

  if (!(result instanceof Response)) throw new Error('Expected upload handler response.');
  expect(result.status).toStrictEqual(415);
  expect(writes.length).toStrictEqual(0);
});

testCase('/api/uploads rejects executable bytes mislabeled as an image', async () => {
  const writes: Array<{ key: string; data: Uint8Array; contentType?: string }> = [];
  const storage: ObjectWriter = {
    putObject(input) {
      writes.push(input);
      return Promise.resolve();
    },
  };
  const auth: RequestContext = {
    tenantId: 'tenant-spoofed-upload',
    userId: 'user-spoofed-upload',
    role: 'owner',
  };
  const form = new FormData();
  form.set(
    'file',
    new File([new Uint8Array([0x4d, 0x5a])], 'payload.exe', { type: 'image/png' }),
  );
  const req = new Request('http://local/api/uploads', {
    ...{ duplex: 'half' },
    method: 'POST',
    body: form,
  });
  const result = await uploadHandler(uploadContext(req, { auth, storage }));

  if (!(result instanceof Response)) throw new Error('Expected upload handler response.');
  expect(result.status).toStrictEqual(415);
  expect(writes.length).toStrictEqual(0);
});

testCase(
  '/api/uploads accepts inspected m4a bytes when the browser omits MIME metadata',
  async () => {
    const diagnostics = diagnosticConsole();
    const writes: Array<{ key: string; data: Uint8Array; contentType?: string }> = [];
    const storage: ObjectWriter = {
      putObject(input) {
        writes.push(input);
        throw new Error('stop before db insert');
      },
    };
    const auth: RequestContext = {
      tenantId: 'tenant-m4a-upload',
      userId: 'user-m4a-upload',
      role: 'owner',
    };
    const form = new FormData();
    const m4aHeader = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x18,
      0x66,
      0x74,
      0x79,
      0x70,
      0x4d,
      0x34,
      0x41,
      0x20,
    ]);
    form.set('file', new File([m4aHeader], 'lecture.m4a', { type: '' }));
    const req = new Request('http://local/api/uploads', {
      ...{ duplex: 'half' },
      method: 'POST',
      body: form,
    });
    const result = await uploadHandler(
      uploadContext(req, { auth, storage, diagnostics: diagnostics.console }),
    );
    if (!(result instanceof Response)) throw new Error('Expected upload handler response.');
    expect(result.status).toStrictEqual(500);

    expect(writes.length).toStrictEqual(1);
    expect(writes[0].contentType).toStrictEqual('audio/mp4');
  },
);

testCase('/api/uploads rejects the removed legacy image form field', async () => {
  const auth: RequestContext = {
    tenantId: 'tenant-legacy-upload',
    userId: 'user-legacy-upload',
    role: 'owner',
  };
  const form = new FormData();
  form.set(
    'image',
    new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      'sample.png',
      { type: 'image/png' },
    ),
  );
  const req = new Request('http://local/api/uploads', {
    ...{ duplex: 'half' },
    method: 'POST',
    body: form,
  });
  const result = await uploadHandler(uploadContext(req, { auth }));

  if (!(result instanceof Response)) throw new Error('Expected upload handler response.');
  expect(result.status).toStrictEqual(400);
});

testCase('/api/uploads rejects a declared oversized body before reading it', async () => {
  let bodyWasCancelled = false;
  const req = new Request('http://local/api/uploads', {
    ...{ duplex: 'half' },
    method: 'POST',
    headers: {
      'content-type': 'multipart/form-data; boundary=upload-test',
      'content-length': String(MAX_UPLOAD_REQUEST_BYTES + 1),
    },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array());
      },
      cancel() {
        bodyWasCancelled = true;
      },
    }),
  });

  const result = await uploadHandler(uploadContext(req, {
    auth: {
      tenantId: 'tenant-oversized-upload',
      userId: 'user-oversized-upload',
      role: 'owner',
    } satisfies RequestContext,
  }));

  if (!(result instanceof Response)) throw new Error('Expected upload handler response.');
  expect(result.status).toStrictEqual(413);
  expect(bodyWasCancelled).toStrictEqual(true);
});

testCase('/api/uploads rejects non-multipart payloads', async () => {
  const req = new Request('http://local/api/uploads', {
    ...{ duplex: 'half' },
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Uint8Array.of(1),
  });
  const result = await uploadHandler(uploadContext(req, {
    auth: {
      tenantId: 'tenant-raw-upload',
      userId: 'user-raw-upload',
      role: 'owner',
    } satisfies RequestContext,
  }));

  if (!(result instanceof Response)) throw new Error('Expected upload handler response.');
  expect(result.status).toStrictEqual(415);
});

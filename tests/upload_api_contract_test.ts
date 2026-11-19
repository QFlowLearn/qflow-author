import { diagnosticConsole } from './helpers/diagnostic_console.ts';
import { expect, test as testCase } from 'vitest';

import { parseUploadApiError } from '../lib/http/upload_api_contract.ts';
import { uploadBankRoute as uploadHandlerEndpoint } from '../lib/http/routes/bank_api/upload.ts';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_REQUEST_BYTES } from '../lib/upload_policy.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const uploadHandler = uploadHandlerEndpoint.handle;

testCase('upload API error parser accepts only closed codes and safe params', () => {
  expect(parseUploadApiError({ error: true, code: 'content_unsupported' })).toStrictEqual({
    error: true,
    code: 'content_unsupported',
  });
  expect(
    parseUploadApiError({
      error: true,
      code: 'kind_too_large',
      params: { kind: 'image', maxMebibytes: 8 },
    })?.code,
  ).toStrictEqual('kind_too_large');
  for (
    const input of [
      null,
      [],
      { error: true, code: 'method_not_allowed' },
      { error: true, code: 'content_unsupported', params: [] },
      { error: true, code: 'content_unsupported', params: { maxMebibytes: -1 } },
      { error: true, code: 'kind_too_large', params: { kind: 'secret', maxMebibytes: 8 } },
      { error: true, code: 'file_too_large', params: {} },
      { error: true, code: 'file_empty', params: {} },
      { error: true, code: 'kind_too_large' },
      { error: true, code: 'kind_too_large', params: { maxMebibytes: 8 } },
      { error: true, code: 'file_too_large', params: { maxMebibytes: 8, extra: 1 } },
    ]
  ) expect(parseUploadApiError(input)).toStrictEqual(null);
  for (
    const code of [
      'unsupported_media_type',
      'payload_unreadable',
      'file_field_required',
      'file_empty',
      'content_unsupported',
      'content_type_mismatch',
      'filename_extension_mismatch',
      'storage_failed',
    ] as const
  ) {
    expect(parseUploadApiError({ error: true, code })).toStrictEqual({ error: true, code });
  }
  for (const code of ['payload_too_large', 'file_too_large']) {
    expect(parseUploadApiError({ error: true, code, params: { maxMebibytes: 8 } })?.code)
      .toStrictEqual(code);
  }
});

testCase('upload route emits exact coded JSON for every failure code', async () => {
  const auth = { auth: { tenantId: 'contract-tenant', userId: 'contract-user', role: 'owner' } };
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const form = (file: File, field = 'file') => {
    const value = new FormData();
    value.set(field, file);
    return value;
  };
  const make = (req: Request, state: Record<string, unknown> = auth) =>
    invokeHttpRoute(uploadHandler, makeHttpRequest(req, { state }));
  const methodNotAllowed = await make(new Request('http://local/api/uploads', { method: 'GET' }));
  expect(methodNotAllowed.status).toStrictEqual(405);
  expect(await methodNotAllowed.text()).toStrictEqual('Method Not Allowed');
  const cases = [
    [
      new Request('http://local/api/uploads', {
        ...{ duplex: 'half' },
        method: 'POST',
        body: 'x',
        headers: { 'content-type': 'text/plain' },
      }),
      415,
      { error: true, code: 'unsupported_media_type' },
    ],
    [
      new Request('http://local/api/uploads', {
        ...{ duplex: 'half' },
        method: 'POST',
        body: form(new File([], 'x.png')),
      }),
      400,
      { error: true, code: 'file_empty' },
    ],
    [
      new Request('http://local/api/uploads', {
        ...{ duplex: 'half' },
        method: 'POST',
        body: form(new File([Uint8Array.of(1)], 'x.exe')),
      }),
      415,
      { error: true, code: 'content_unsupported' },
    ],
    [
      new Request('http://local/api/uploads', {
        ...{ duplex: 'half' },
        method: 'POST',
        body: form(new File([png], 'x.png', { type: 'video/mp4' })),
      }),
      415,
      { error: true, code: 'content_type_mismatch' },
    ],
    [
      new Request('http://local/api/uploads', {
        ...{ duplex: 'half' },
        method: 'POST',
        body: form(new File([png], 'x.mp4', { type: 'image/png' })),
      }),
      415,
      { error: true, code: 'filename_extension_mismatch' },
    ],
    [
      new Request('http://local/api/uploads', {
        ...{ duplex: 'half' },
        method: 'POST',
        body: form(new File([png], 'x.png'), 'other'),
      }),
      400,
      { error: true, code: 'file_field_required' },
    ],
    [
      new Request('http://local/api/uploads', {
        ...{ duplex: 'half' },
        method: 'POST',
        body: new ReadableStream<Uint8Array>({ pull() {} }),
        headers: {
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(MAX_UPLOAD_REQUEST_BYTES + 1),
        },
      }),
      413,
      { error: true, code: 'payload_too_large', params: { maxMebibytes: 24 } },
    ],
  ] as const;
  for (const [req, status, expected] of cases) {
    const response = await make(req);
    if (!(response instanceof Response)) throw new Error('Expected response');
    expect(response.status).toStrictEqual(status);
    const body = await response.json();
    const expectedMessage = body.code === 'payload_too_large'
      ? 'Upload requests must contain no more than 24 MB of file data.'
      : body.code === 'unsupported_media_type'
      ? 'Send the upload as multipart form data.'
      : body.code === 'payload_unreadable'
      ? 'Unable to read upload payload.'
      : body.code === 'file_field_required'
      ? 'Attach a file using the "file" field.'
      : body.code === 'file_empty'
      ? 'Uploaded file is empty.'
      : body.code === 'file_too_large'
      ? 'Files must be 24 MB or smaller.'
      : body.code === 'kind_too_large'
      ? 'Images must be 8 MB or smaller.'
      : body.code === 'content_unsupported'
      ? 'The file contents are not a supported image, audio file, video file, PDF, or WebVTT caption file.'
      : body.code === 'content_type_mismatch'
      ? 'The file contents do not match the media type reported by the browser.'
      : body.code === 'filename_extension_mismatch'
      ? 'The file contents do not match the filename extension.'
      : body.code === 'storage_failed'
      ? 'Failed to store upload. Please try again later.'
      : body.message;
    expect(body).toStrictEqual({ ...expected, message: expectedMessage });
  }
  const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  oversized.set(png);
  const tooLarge = await make(
    new Request('http://local/api/uploads', {
      ...{ duplex: 'half' },
      method: 'POST',
      body: form(new File([oversized], 'x.png', { type: 'image/png' })),
    }),
  );
  expect(tooLarge.status).toStrictEqual(400);
  expect(await tooLarge.json()).toStrictEqual({
    error: true,
    code: 'file_too_large',
    params: { maxMebibytes: 24 },
    message: 'Files must be 24 MB or smaller.',
  });
  const unreadable = await make(
    new Request('http://local/api/uploads', {
      ...{ duplex: 'half' },
      method: 'POST',
      body: '--bad',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
    }),
  );
  expect(unreadable.status).toStrictEqual(400);
  expect(await unreadable.json()).toStrictEqual({
    error: true,
    code: 'payload_unreadable',
    message: 'Unable to read upload payload.',
  });
  const imageBytes = new Uint8Array(8 * 1024 * 1024 + 1);
  imageBytes.set(png);
  const kindTooLarge = await make(
    new Request('http://local/api/uploads', {
      ...{ duplex: 'half' },
      method: 'POST',
      body: form(new File([imageBytes], 'x.png', { type: 'image/png' })),
    }),
  );
  expect(kindTooLarge.status).toStrictEqual(400);
  expect(await kindTooLarge.json()).toStrictEqual({
    error: true,
    code: 'kind_too_large',
    params: { kind: 'image', maxMebibytes: 8 },
    message: 'Images must be 8 MB or smaller.',
  });
  const diagnostics = diagnosticConsole();
  const storageFailed = await make(
    new Request('http://local/api/uploads', {
      ...{ duplex: 'half' },
      method: 'POST',
      body: form(new File([png], 'x.png', { type: 'image/png' })),
    }),
    {
      auth: auth.auth,
      runtime: { diagnostics: diagnostics.console },
      storage: {
        putObject() {
          throw new Error('storage');
        },
      },
    },
  );
  expect(storageFailed.status).toStrictEqual(500);
  expect(await storageFailed.json()).toStrictEqual({
    error: true,
    code: 'storage_failed',
    message: 'Failed to store upload. Please try again later.',
  });
});

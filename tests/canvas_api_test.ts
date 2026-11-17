import { expect, test as testCase } from 'vitest';

import {
  createCanvasQtiMigration,
  getCanvasImportProgress,
  refreshCanvasQtiMigrationUpload,
  uploadCanvasQtiPackage,
} from '../lib/lms/canvas_api.ts';
import type { AuthorizedCanvasConnection } from '../lib/lms/canvas_connections.ts';
import { parseCanvasPublishDestination } from '../lib/lms/canvas_publish_contract.ts';
import { redact } from '../lib/redacted.ts';

const connection: AuthorizedCanvasConnection = {
  id: '8fdcd9d7-3cb3-4f7e-8c92-31bd3272fda0' as AuthorizedCanvasConnection['id'],
  name: 'Canvas production',
  baseUrl: 'https://canvas.example.edu',
  supportedTargetIds: ['canvas-classic', 'canvas-new-quizzes'],
  accessToken: redact('secret-token'),
};
const artifact = {
  filename: 'assessment-canvas-new-quizzes.zip',
  mediaType: 'application/zip',
  bytes: new Uint8Array([1, 2, 3]),
};

testCase('Canvas connector creates an exact New Quizzes QTI migration', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await createCanvasQtiMigration(connection, {
    targetId: 'canvas-new-quizzes',
    destination: courseDestination('sis_course_id:biology-101'),
    artifact,
  }, {
    fetchImpl: (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(Response.json({
        id: 42,
        workflow_state: 'created',
        progress_url: 'https://canvas.example.edu/api/v1/progress/9',
        pre_attachment: {
          upload_url: 'https://uploads.example.net/signed',
          upload_params: { policy: 'opaque-policy', signature: 'opaque-signature' },
        },
      }));
    },
  });

  expect(result.ok).toStrictEqual(true);
  if (!result.ok) return;
  expect(calls.length).toStrictEqual(1);
  expect(calls[0].url).toStrictEqual(
    'https://canvas.example.edu/api/v1/courses/sis_course_id%3Abiology-101/content_migrations',
  );
  expect(calls[0].init.method).toStrictEqual('POST');
  expect(new Headers(calls[0].init.headers).get('authorization')).toStrictEqual(
    'Bearer secret-token',
  );
  const form = calls[0].init.body;
  if (!(form instanceof FormData)) expect.unreachable('Expected form instanceof FormData');
  expect(form.get('migration_type')).toStrictEqual('qti_converter');
  expect(form.get('pre_attachment[name]')).toStrictEqual(artifact.filename);
  expect(form.get('pre_attachment[size]')).toStrictEqual('3');
  expect(form.get('pre_attachment[content_type]')).toStrictEqual('application/zip');
  expect(form.get('settings[import_quizzes_next]')).toStrictEqual('true');
  expect(result.value.id).toStrictEqual('42');
  expect(result.value.upload.uploadParams.policy).toStrictEqual('opaque-policy');
});

testCase(
  'Canvas connector forwards opaque upload fields, withholds token, and confirms at Canvas',
  async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await uploadCanvasQtiPackage(
      connection,
      {
        uploadUrl: 'https://uploads.example.net/signed',
        uploadParams: { key: 'opaque-key', policy: 'opaque-policy' },
      },
      artifact,
      {
        fetchImpl: (input, init) => {
          const url = String(input);
          calls.push({ url, init: init ?? {} });
          if (url.startsWith('https://uploads.example.net/')) {
            return Promise.resolve(
              new Response(null, {
                status: 302,
                headers: {
                  location: 'https://canvas.example.edu/api/v1/files/17/create_success?uuid=opaque',
                },
              }),
            );
          }
          return Promise.resolve(Response.json({ id: 17 }));
        },
      },
    );

    expect(result).toStrictEqual({ ok: true, value: undefined });
    expect(calls.length).toStrictEqual(2);
    expect(new Headers(calls[0].init.headers).has('authorization')).toStrictEqual(false);
    const uploadForm = calls[0].init.body;
    if (!(uploadForm instanceof FormData)) {
      expect.unreachable('Expected uploadForm instanceof FormData');
    }
    expect([...uploadForm.keys()]).toStrictEqual(['key', 'policy', 'file']);
    expect(uploadForm.get('key')).toStrictEqual('opaque-key');
    if (!(uploadForm.get('file') instanceof File)) {
      expect.unreachable("Expected uploadForm.get('file') instanceof File");
    }
    expect(new Headers(calls[1].init.headers).get('authorization')).toStrictEqual(
      'Bearer secret-token',
    );
    expect(calls[1].init.method).toStrictEqual('GET');
  },
);

testCase(
  'Canvas connector refuses cross-origin progress URLs before sending credentials',
  async () => {
    let calls = 0;
    const result = await getCanvasImportProgress(
      connection,
      'https://attacker.example/api/v1/progress/1',
      {
        fetchImpl: () => {
          calls += 1;
          return Promise.resolve(Response.json({}));
        },
      },
    );
    expect(result).toStrictEqual({
      ok: false,
      error: {
        code: 'CanvasResponseInvalid',
        message: 'Canvas is unavailable or returned an invalid response.',
        retryable: false,
      },
    });
    expect(calls).toStrictEqual(0);
  },
);

testCase(
  'Canvas connector classifies authentication failures without retaining remote bodies',
  async () => {
    const result = await createCanvasQtiMigration(connection, {
      targetId: 'canvas-classic',
      destination: existingBankDestination('17', '9'),
      artifact,
    }, {
      fetchImpl: () => Promise.resolve(Response.json({ token: 'must-not-leak' }, { status: 401 })),
    });
    expect(result).toStrictEqual({
      ok: false,
      error: {
        code: 'CanvasAuthenticationFailed',
        message:
          'Canvas rejected the connection access token. Update the Canvas connection, then retry this publish.',
        retryable: true,
      },
    });
    expect(JSON.stringify(result).includes('must-not-leak')).toStrictEqual(false);
  },
);

testCase(
  'Canvas connector keeps permission failures resumable after connection repair',
  async () => {
    const result = await refreshCanvasQtiMigrationUpload(connection, {
      courseId: courseDestination('17').courseId,
      contentMigrationId: '42',
      artifact,
    }, {
      fetchImpl: () => Promise.resolve(Response.json({}, { status: 403 })),
    });
    expect(result).toStrictEqual({
      ok: false,
      error: {
        code: 'CanvasPermissionDenied',
        message:
          'The Canvas connection cannot import content into this destination. Update its permissions, then retry this publish.',
        retryable: true,
      },
    });
  },
);

testCase(
  'Canvas connector classifies an enforced request deadline without leaking an exception',
  async () => {
    const signal = AbortSignal.timeout(1);
    const result = await createCanvasQtiMigration(connection, {
      targetId: 'canvas-classic',
      destination: courseDestination('17'),
      artifact,
    }, {
      signal,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const requestSignal = init?.signal;
          if (!requestSignal) return reject(new Error('Expected request signal.'));
          requestSignal.addEventListener('abort', () => reject(requestSignal.reason), {
            once: true,
          });
        }),
    });
    expect(result).toStrictEqual({
      ok: false,
      error: {
        code: 'CanvasRequestTimedOut',
        message: 'Canvas did not respond before the request deadline.',
        retryable: true,
      },
    });
  },
);

function courseDestination(courseId: string) {
  const destination = parseCanvasPublishDestination({ _tag: 'Course', courseId });
  if (!destination) throw new Error('Expected valid Canvas course destination.');
  return destination;
}

function existingBankDestination(courseId: string, questionBankId: string) {
  const destination = parseCanvasPublishDestination({
    _tag: 'QuestionBank',
    courseId,
    bank: { _tag: 'Existing', questionBankId },
  });
  if (!destination) throw new Error('Expected valid Canvas question-bank destination.');
  return destination;
}

import { expect, test as testCase } from 'vitest';

import {
  parseCanvasPublishHttpRequest,
  parseCanvasRemoteIdentityResolutionRequest,
} from '../lib/lms/canvas_publish_http.ts';

const CONNECTION_ID = '8fdcd9d7-3cb3-4f7e-8c92-31bd3272fda0';
const PUBLISH_ID = 'a505462d-2f72-4d99-ae04-77e10bc783e8';
const CONTENT_ID = 'a'.repeat(64);

testCase(
  'Canvas publish HTTP parser requires exact connection, target, destination, and approvals',
  async () => {
    const result = await parseCanvasPublishHttpRequest(request({
      connectionId: CONNECTION_ID,
      targetId: 'canvas-classic',
      destination: {
        type: 'question-bank',
        courseId: ' sis_course_id:BIO.101-2026 ',
        questionBankName: 'Biology midterm',
      },
      preflightId: CONTENT_ID,
      acknowledgement: CONTENT_ID,
      scoring: 'automatic',
      interaction: 'preserve',
    }));
    expect(result.ok).toStrictEqual(true);
    if (!result.ok) return;
    expect(result.publishId).toStrictEqual(PUBLISH_ID);
    expect(result.request.destination).toStrictEqual({
      _tag: 'QuestionBank',
      courseId: 'sis_course_id:BIO.101-2026',
      bank: { _tag: 'New', questionBankName: 'Biology midterm' },
    });
  },
);

testCase(
  'Canvas publish HTTP parser rejects control characters and oversized course IDs',
  async () => {
    const valid = {
      connectionId: CONNECTION_ID,
      targetId: 'canvas-classic',
      destination: { type: 'course', courseId: '17' },
      preflightId: CONTENT_ID,
      acknowledgement: null,
      scoring: 'automatic',
      interaction: 'preserve',
    };
    for (const courseId of ['sis_course_id:biology\n101', 'x'.repeat(256)]) {
      const result = await parseCanvasPublishHttpRequest(request({
        ...valid,
        destination: { type: 'course', courseId },
      }));
      expect(result.ok).toStrictEqual(false);
    }
  },
);

testCase('Canvas publish HTTP parser rejects question-bank inference for New Quizzes', async () => {
  const result = await parseCanvasPublishHttpRequest(request({
    connectionId: CONNECTION_ID,
    targetId: 'canvas-new-quizzes',
    destination: {
      type: 'question-bank',
      courseId: '17',
      questionBankId: '9',
    },
    preflightId: CONTENT_ID,
    acknowledgement: null,
    scoring: 'automatic',
    interaction: 'preserve',
  }));
  expect(result).toStrictEqual({
    ok: false,
    status: 400,
    body: {
      error: 'CanvasPublishRequestInvalid',
      message: 'Select one Canvas connection, export target, and exact course or question bank.',
    },
  });
});

testCase(
  'Canvas publish HTTP parser rejects unknown fields and missing idempotency identity',
  async () => {
    const body = {
      connectionId: CONNECTION_ID,
      targetId: 'canvas-classic',
      destination: { type: 'course', courseId: '17' },
      preflightId: CONTENT_ID,
      acknowledgement: null,
      scoring: 'automatic',
      interaction: 'preserve',
      fallbackCourseId: '18',
    };
    expect(await parseCanvasPublishHttpRequest(request(body))).toStrictEqual({
      ok: false,
      status: 400,
      body: {
        error: 'CanvasPublishRequestInvalid',
        message: 'Select one Canvas connection, export target, and exact course or question bank.',
      },
    });
    const { fallbackCourseId: _ignored, ...validBody } = body;
    const withoutKey = new Request('https://qflow.example/api/publish', {
      ...{ duplex: 'half' },
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(await parseCanvasPublishHttpRequest(withoutKey)).toStrictEqual({
      ok: false,
      status: 400,
      body: {
        error: 'IdempotencyKeyInvalid',
        message: 'Send one client-issued UUID for the Canvas publish.',
      },
    });
  },
);

testCase(
  'Canvas publish HTTP parser accepts the native form fallback with an explicit publish ID',
  async () => {
    const form = new URLSearchParams({
      publishId: PUBLISH_ID,
      connectionId: CONNECTION_ID,
      targetId: 'canvas-classic',
      destinationChoice: 'course',
      courseId: '17',
      preflightId: CONTENT_ID,
      acknowledgement: '',
      scoring: 'automatic',
      interaction: 'preserve',
    });
    const result = await parseCanvasPublishHttpRequest(
      new Request('https://qflow.example/api/publish', {
        ...{ duplex: 'half' },
        method: 'POST',
        body: form,
      }),
    );
    expect(result.ok).toStrictEqual(true);
    if (!result.ok) return;
    expect(result.publishId).toStrictEqual(PUBLISH_ID);
    expect(result.request.destination).toStrictEqual({ _tag: 'Course', courseId: '17' });
  },
);

testCase('Canvas uncertain-create resolution accepts only one exact JSON decision', async () => {
  expect(
    await parseCanvasRemoteIdentityResolutionRequest(
      new Request('https://qflow.example/api/resolve', {
        ...{ duplex: 'half' },
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome: 'import-not-found' }),
      }),
    ),
  ).toStrictEqual({ outcome: 'import-not-found' });
  for (const body of [{ outcome: 'unknown' }, { outcome: 'import-found', force: true }]) {
    expect(
      await parseCanvasRemoteIdentityResolutionRequest(
        new Request('https://qflow.example/api/resolve', {
          ...{ duplex: 'half' },
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),
    ).toStrictEqual(null);
  }
});

function request(body: unknown): Request {
  return new Request('https://qflow.example/api/publish', {
    ...{ duplex: 'half' },
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': PUBLISH_ID,
    },
    body: JSON.stringify(body),
  });
}

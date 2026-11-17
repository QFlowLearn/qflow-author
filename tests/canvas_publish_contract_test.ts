import { expect, test as testCase } from 'vitest';

import {
  formatCanvasPublishTerminalCursor,
  parseCanvasPublishDestination,
  parseCanvasPublishId,
  parseCanvasPublishTerminalCursor,
} from '../lib/lms/canvas_publish_contract.ts';
import { parseCanvasPublishPageView } from '../lib/lms/canvas_publish_wire.ts';

const PUBLISH_ID = 'a505462d-2f72-4d99-ae04-77e10bc783e8';

testCase('Canvas destination parser owns course and question-bank invariants', () => {
  expect(parseCanvasPublishDestination({
    _tag: 'QuestionBank',
    courseId: ' sis_course_id:BIO.101-2026 ',
    bank: { _tag: 'New', questionBankName: ' Biology midterm ' },
  })).toStrictEqual({
    _tag: 'QuestionBank',
    courseId: 'sis_course_id:BIO.101-2026',
    bank: { _tag: 'New', questionBankName: 'Biology midterm' },
  });
  for (
    const input of [
      { _tag: 'Course', courseId: '' },
      {
        _tag: 'QuestionBank',
        courseId: '17',
        bank: { _tag: 'Existing', questionBankId: '' },
      },
      {
        _tag: 'QuestionBank',
        courseId: '17',
        bank: { _tag: 'Existing', questionBankId: 'bank-9' },
      },
      {
        _tag: 'QuestionBank',
        courseId: '17',
        bank: { _tag: 'New', questionBankName: 'Bad\nname' },
      },
    ]
  ) expect(parseCanvasPublishDestination(input)).toStrictEqual(null);
});

testCase('Canvas terminal-history cursor round-trips canonically', () => {
  const publishId = parseCanvasPublishId(PUBLISH_ID);
  if (!publishId) expect.unreachable('Expected publishId');
  const token = formatCanvasPublishTerminalCursor({
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    publishId,
  });
  expect(token).toStrictEqual(`2026-08-05T12:00:00.000Z|${PUBLISH_ID}`);
  expect(parseCanvasPublishTerminalCursor(token)).toStrictEqual({
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    publishId,
  });
  expect(parseCanvasPublishTerminalCursor(`2026-08-05|${PUBLISH_ID}`)).toStrictEqual(null);
});

testCase('Canvas publish pages reject duplicate identities across inventory buckets', () => {
  const base = {
    id: PUBLISH_ID,
    connection: {
      id: '8fdcd9d7-3cb3-4f7e-8c92-31bd3272fda0',
      name: 'Canvas production',
      baseUrl: 'https://canvas.example.edu',
    },
    targetId: 'canvas-classic',
    destination: { _tag: 'Course', courseId: '17' },
    exportReceiptId: 'a'.repeat(64),
    artifact: {
      filename: 'assessment.zip',
      mediaType: 'application/zip',
      sha256: 'a'.repeat(64),
      byteLength: 1,
      packageUrl: 'https://qflow.example/package',
    },
    attemptCount: 1,
    createdAt: '2026-08-05T12:00:00.000Z',
    updatedAt: '2026-08-05T12:00:01.000Z',
  };
  expect(parseCanvasPublishPageView({
    actionRequired: [{
      ...base,
      state: {
        _tag: 'RetryCreate',
        failure: { code: 'CanvasUnavailable', message: 'Try again.' },
      },
    }],
    terminal: [{
      ...base,
      state: {
        _tag: 'Failed',
        failure: { code: 'CanvasRequestRejected', message: 'Rejected.' },
        remote: null,
      },
    }],
    nextTerminalCursor: null,
  })).toStrictEqual(null);
});

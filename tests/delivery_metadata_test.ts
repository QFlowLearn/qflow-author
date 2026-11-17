import { expect, test as testCase } from 'vitest';

import { readDeliverySummary } from '../lib/delivery_metadata.ts';

testCase('readDeliverySummary returns latest published delivery links', () => {
  expect(readDeliverySummary({
    delivery: {
      latestPublish: {
        assessmentId: 'assessment-123',
        assessmentVersionId: 'av-123',
        assignmentId: 'assignment-123',
        previewUrl: 'https://deliver.example.test/session?mode=preview&assessmentVersionId=av-123',
        adminUrl: 'https://deliver.example.test/launch?assessmentVersionId=av-123',
        publishedAt: '2026-05-13T12:00:00.000Z',
      },
    },
  })).toStrictEqual({
    assessmentId: 'assessment-123',
    assessmentVersionId: 'av-123',
    assignmentId: 'assignment-123',
    previewUrl: 'https://deliver.example.test/session?mode=preview&assessmentVersionId=av-123',
    adminUrl: 'https://deliver.example.test/launch?assessmentVersionId=av-123',
    publishedAt: '2026-05-13T12:00:00.000Z',
  });
});

testCase('readDeliverySummary returns null when no delivery publish exists', () => {
  expect(readDeliverySummary({})).toStrictEqual(null);
  expect(readDeliverySummary({ delivery: { latestPublish: {} } })).toStrictEqual(null);
});

testCase('readDeliverySummary omits unsafe persisted delivery links', () => {
  expect(readDeliverySummary({
    delivery: {
      latestPublish: {
        assessmentVersionId: 'av-123',
        previewUrl: 'javascript:alert(1)',
        adminUrl: 'http://deliver.example.test/admin',
        publishedAt: '2026-05-13T12:00:00.000Z',
      },
    },
  })).toStrictEqual({
    assessmentId: undefined,
    assessmentVersionId: 'av-123',
    assignmentId: undefined,
    previewUrl: undefined,
    adminUrl: undefined,
    publishedAt: '2026-05-13T12:00:00.000Z',
  });
});

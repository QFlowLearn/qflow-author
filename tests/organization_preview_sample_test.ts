import { expect, test as testCase } from 'vitest';

import {
  type OrganizationReviewCandidate,
  selectOrganizationPreviewPool,
  selectOrganizationReview,
} from '../lib/organization_preview_sample.ts';

function candidate(n: number, sourceKey = 'large', uncertain = false): OrganizationReviewCandidate {
  return {
    questionId: `q-${n}`,
    sourceKey,
    orderKey: String(n).padStart(4, '0'),
    state: 'previewed',
    decision: {
      kind: 'clef',
      receipt: {
        topicId: n % 2 ? 'cells' : 'energy',
        confidence: 0.99,
        probabilities: uncertain
          ? { cells: 0.5, energy: 0.5, __no_match__: 0 }
          : { cells: n % 2 ? 0.99 : 0.01, energy: n % 2 ? 0.01 : 0.99, __no_match__: 0 },
        model: 'clef',
        inputTokens: 20,
        outputTokens: 1,
      },
    },
  };
}
testCase(
  'preview pool samples across uneven source groups and remains bounded and reproducible',
  () => {
    const rows = Array.from({ length: 150 }, (_, i) => candidate(i, i >= 145 ? 'small' : 'large'));
    const pool = selectOrganizationPreviewPool(rows);
    expect(pool.length).toStrictEqual(100);
    expect(new Set(pool).size).toStrictEqual(100);
    for (let i = 145; i < 150; i++) {
      if (!(pool.includes(`q-${i}`))) expect.unreachable('Expected pool.includes(`q-${i}`)');
    }
    expect(selectOrganizationPreviewPool(rows.toReversed())).toStrictEqual(pool);
    expect(selectOrganizationPreviewPool([])).toStrictEqual([]);
  },
);
testCase(
  'review prioritizes flat distributions then includes confident source/topic coverage with no repeats',
  () => {
    const rows = Array.from(
      { length: 100 },
      (_, i) => candidate(i, i === 99 ? 'rare' : 'large', i < 15),
    );
    const sample = selectOrganizationReview(rows);
    expect(sample.length).toStrictEqual(20);
    expect(new Set(sample.map((r) => r.questionId)).size).toStrictEqual(20);
    expect(sample.filter((r) => r.reason === 'uncertain').map((r) => r.questionId)).toStrictEqual(
      rows.slice(0, 10).map((r) => r.questionId),
    );
    const coverage = sample.filter((r) => r.reason === 'coverage');
    if (!(coverage.some((r) => r.questionId === 'q-99'))) {
      expect.unreachable("Expected coverage.some((r) => r.questionId === 'q-99')");
    }
    if (!(coverage.every((r) => Number(r.questionId.slice(2)) >= 15))) {
      expect.unreachable('Expected coverage.every((r) => Number(r.questionId.slice(2)) >= 15)');
    }
    expect(selectOrganizationReview(rows.toReversed())).toStrictEqual(sample);
  },
);
testCase(
  'small and source-only pools use real available counts without fabricating uncertainty',
  () => {
    const rows = Array.from(
      { length: 7 },
      (_, i) => ({ ...candidate(i), decision: { kind: 'source', topicId: 'cells' } as const }),
    );
    expect(selectOrganizationReview(rows).length).toStrictEqual(7);
    if (!(selectOrganizationReview(rows).every((r) => r.reason === 'coverage'))) {
      expect.unreachable(
        "Expected selectOrganizationReview(rows).every((r) => r.reason === 'coverage')",
      );
    }
    expect(selectOrganizationReview([])).toStrictEqual([]);
    const mixed = [...rows, { ...candidate(8, 'other', true), state: 'failed' }];
    if (!(selectOrganizationReview(mixed).every((r) => r.reason === 'coverage'))) {
      expect.unreachable(
        "Expected selectOrganizationReview(mixed).every((r) => r.reason === 'coverage')",
      );
    }
  },
);

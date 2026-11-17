import { expect, test as testCase } from 'vitest';

import { parseAssessmentArrangeRequest } from '../lib/assessment_arrangement.ts';

const partId = '11111111-1111-4111-8111-111111111111';
const textId = '22222222-2222-4222-8222-222222222222';
const first = {
  id: '33333333-3333-4333-8333-333333333333',
  itemId: '44444444-4444-4444-8444-444444444444',
  snapshotRev: 1,
};
const second = {
  id: '55555555-5555-4555-8555-555555555555',
  itemId: '66666666-6666-4666-8666-666666666666',
  snapshotRev: 2,
};
const text = {
  id: textId,
  content: { kind: 'text', text: 'Read this before the second question.' },
  fixed: true,
};

function request(placements: readonly unknown[], options = {}) {
  return {
    expectedVersion: 'a'.repeat(64),
    parts: [{ id: partId, title: 'Part', placements, options }],
  };
}

testCase(
  'arrangement text entries retain exact unscored content between real question references',
  () => {
    const result = parseAssessmentArrangeRequest(request([first, text, second]));
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    expect(result.request.parts[0].placements).toStrictEqual([
      { ...first, blueprintTargetId: null, fixed: false },
      text,
      { ...second, blueprintTargetId: null, fixed: false },
    ]);
  },
);

testCase(
  'text entries reject competing question metadata, malformed content and ambiguous shuffle policy',
  () => {
    for (
      const entry of [
        { ...text, itemId: first.itemId },
        { ...text, snapshotRev: 1 },
        { ...text, blueprintTargetId: 'TARGET' },
        { ...text, fixed: false },
        { ...text, content: { kind: 'text', text: '' } },
        { ...text, content: { kind: 'text', text: '   ' } },
        { ...text, content: { kind: 'text', text: '\u00a0\ufeff' } },
        { ...text, content: { kind: 'text', text: 'invalid\u0001' } },
        { ...text, content: { kind: 'text', text: '\ud800' } },
        { ...text, content: { kind: 'text', text: 'x'.repeat(100001) } },
        { ...text, content: { kind: 'html', text: '<script>bad()</script>' } },
        { ...text, content: { ...text.content, html: '<script>bad()</script>' } },
      ]
    ) {
      expect(parseAssessmentArrangeRequest(request([first, entry, second])).ok).toStrictEqual(
        false,
      );
    }
    expect(
      parseAssessmentArrangeRequest(request([first, text, second], { shuffleQuestions: true })).ok,
    ).toStrictEqual(false);
    expect(parseAssessmentArrangeRequest(request([first, text, { ...text }, second])).ok)
      .toStrictEqual(false);
  },
);

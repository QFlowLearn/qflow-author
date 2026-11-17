import { expect, test as testCase } from 'vitest';

import { assessmentArrangementVersion } from '../lib/assessment_arrangement_version.ts';
import { parseAssessmentArrangeRequest } from '../lib/assessment_arrangement.ts';
import { createArrangeMutations } from '../islands/arrange_board/useArrangeDnD.ts';
import type { Part } from '../islands/arrange_board/types.ts';

const id = '10000000-0000-4000-8000-000000000001';
const part = {
  id,
  title: 'Part',
  options: { navigationMode: 'linear', instructionsHtml: '<p>Read.</p>' },
  placements: [{
    id: '10000000-0000-4000-8000-000000000002',
    itemId: '10000000-0000-4000-8000-000000000003',
    snapshotRev: 1,
    blueprintTargetId: 'math',
  }],
};

testCase(
  'arrangement version includes ordered identities, revision policy, alignment and all settings',
  async () => {
    const version = await assessmentArrangementVersion(id, [part]);
    expect(
      await assessmentArrangementVersion(id, [{
        ...part,
        options: { instructionsHtml: '<p>Read.</p>', navigationMode: 'linear' },
      }]),
    ).toStrictEqual(version);
    for (
      const changed of [
        { ...part, id: '10000000-0000-4000-8000-000000000009' },
        { ...part, title: 'Changed' },
        { ...part, options: { ...part.options, submissionMode: 'simultaneous' } },
        { ...part, options: { ...part.options, instructionsHtml: '<p>Other instructions.</p>' } },
        { ...part, placements: [] },
        {
          ...part,
          placements: [{ ...part.placements[0], id: '10000000-0000-4000-8000-000000000008' }],
        },
        { ...part, placements: [{ ...part.placements[0], snapshotRev: null }] },
        { ...part, placements: [{ ...part.placements[0], blueprintTargetId: 'science' }] },
      ]
    ) expect(await assessmentArrangementVersion(id, [changed])).not.toStrictEqual(version);
    expect(await assessmentArrangementVersion(id + 'a', [part])).not.toStrictEqual(version);
    const other = { ...part, id: '10000000-0000-4000-8000-000000000009' };
    expect(await assessmentArrangementVersion(id, [part, other])).not.toStrictEqual(
      await assessmentArrangementVersion(id, [other, part]),
    );
    const second = { ...part.placements[0], id: other.id };
    expect(
      await assessmentArrangementVersion(id, [{
        ...part,
        placements: [part.placements[0], second],
      }]),
    ).not.toStrictEqual(
      await assessmentArrangementVersion(id, [{
        ...part,
        placements: [second, part.placements[0]],
      }]),
    );
  },
);

testCase('arrangement commands require an explicit valid base version', () => {
  for (const value of [undefined, null, '', 'old', 'A'.repeat(64)]) {
    expect(parseAssessmentArrangeRequest({ parts: [part], expectedVersion: value }).ok)
      .toStrictEqual(false);
  }
  expect(parseAssessmentArrangeRequest({ parts: [part] }).ok).toStrictEqual(false);
  expect(parseAssessmentArrangeRequest({ parts: [part], expectedVersion: 'a'.repeat(64) }).ok)
    .toStrictEqual(true);
});

testCase('cross-part movement does not mutate an earlier arrangement snapshot', () => {
  const original: Part[] = [
    { id: 'first', title: 'First', placements: [{ id: 'p', itemId: 'q' }] },
    { id: 'second', title: 'Second', placements: [] },
  ];
  Object.freeze(original[0].placements);
  let current = original;
  const moves = createArrangeMutations((update) => current = update(current));
  moves.moveItemTo(0, 0, 1);
  expect(original[0].placements).toStrictEqual([{ id: 'p', itemId: 'q' }]);
  expect(current[0].placements).toStrictEqual([]);
  expect(current[1].placements).toStrictEqual([{ id: 'p', itemId: 'q' }]);
});

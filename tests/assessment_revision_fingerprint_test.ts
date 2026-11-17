import { expect, test as testCase } from 'vitest';

import { assessmentRevisionFingerprint } from '../lib/assessment_content.ts';
import type { Part } from '../islands/assessment_builder/types.ts';

testCase(
  'publication refresh detects exact text, section policies and fixed-position changes',
  () => {
    const part: Part = {
      id: 'part',
      title: 'Part',
      options: { shuffleQuestions: false },
      placements: [
        { id: 'question', itemId: 'item', snapshotRev: 1, fixed: false },
        { id: 'text', content: { kind: 'text', text: 'Read this.' }, fixed: true },
      ],
    };
    const before = assessmentRevisionFingerprint([part], {});
    for (
      const changed of [
        { ...part, options: { ...part.options, shuffleQuestions: true } },
        {
          ...part,
          placements: part.placements.map((placement) =>
            'itemId' in placement ? { ...placement, fixed: true } : placement
          ),
        },
        {
          ...part,
          placements: part.placements.map((placement) =>
            'content' in placement
              ? { ...placement, content: { ...placement.content, text: 'Read this. ' } }
              : placement
          ),
        },
      ]
    ) expect(assessmentRevisionFingerprint([changed], {})).not.toStrictEqual(before);
  },
);

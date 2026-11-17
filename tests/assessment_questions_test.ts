import { expect, test as testCase } from 'vitest';

import {
  assessmentBlueprintAlignments,
  assessmentHasQuestions,
} from '../islands/assessment_builder/assessment_questions.ts';

testCase('assessmentHasQuestions is false for empty parts', () => {
  expect(assessmentHasQuestions([{ id: 'p1', title: 'Part 1', placements: [] }])).toStrictEqual(
    false,
  );
});

testCase('assessment blueprint alignments exclude deleted placement metadata', () => {
  const alignments = assessmentBlueprintAlignments(
    [{
      id: 'p1',
      title: 'Part 1',
      placements: [{ id: 'current', itemId: 'question-1' }],
    }],
    {
      current: {
        id: 'current',
        itemId: 'question-1',
        title: 'Current',
        latestRev: 1,
        questionTypeId: 'single_select',
        questionType: 'Single Select',
        preview: {},
        blueprintTargetId: 'current-target',
        reviewSuggestions: [],
      },
      deleted: {
        id: 'deleted',
        itemId: 'question-2',
        title: 'Deleted',
        latestRev: 1,
        questionTypeId: 'text_entry',
        questionType: 'Text Entry',
        preview: {},
        blueprintTargetId: 'deleted-target',
        reviewSuggestions: [],
      },
    },
  );

  expect(alignments).toStrictEqual([{
    blueprintTargetId: 'current-target',
    questionType: 'single_select',
  }]);
});

testCase('assessmentHasQuestions is true when any part has placements', () => {
  expect(assessmentHasQuestions([
    { id: 'p1', title: 'Part 1', placements: [] },
    { id: 'p2', title: 'Part 2', placements: [{ id: 'pl1', itemId: 'item-1' }] },
  ])).toStrictEqual(true);
});

import { expect, test } from 'vitest';
import { importMoodleQuestion, matchingSubquestion } from './helpers/moodle_second_pass.ts';
import { expectImportedScore } from './helpers/lms_import.ts';
test('Moodle matching preserves literal mathematical and code answer values', async () => {
  const { imported } = await importMoodleQuestion(
    'matching',
    '<p>Match the code.</p>',
    matchingSubquestion('Small', '<5>') + matchingSubquestion('Element', '<div>'),
  );
  expect(imported.items[0].draft.targets?.map((t) => t.text)).toEqual(['<5>', '<div>']);
  expect(imported.items[0].draft.correctPairs).toHaveLength(2);
  expectImportedScore(imported, { RESPONSE: ['S1 T1', 'S2 T2'] }, 1);
});

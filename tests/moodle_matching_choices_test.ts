import { expect, test } from 'vitest';
import { importMoodleQuestion, matchingSubquestion } from './helpers/moodle_second_pass.ts';
import { expectImportedScore } from './helpers/lms_import.ts';
test('Moodle matching empty stems remain target-only distractors', async () => {
  const { imported } = await importMoodleQuestion(
    'matching',
    '<p>Match.</p>',
    matchingSubquestion('France', 'Paris') + matchingSubquestion('Germany', 'Berlin') +
      matchingSubquestion('', 'Rome'),
  );
  expect(imported.items[0].draft.sources).toHaveLength(2);
  expect(imported.items[0].draft.targets).toHaveLength(3);
  expect(imported.items[0].draft.correctPairs).toHaveLength(2);
  expectImportedScore(imported, { RESPONSE: ['S1 T1', 'S2 T2'] }, 1);
});
test('Moodle matching targets remain reusable in exported player constraints', async () => {
  const { imported } = await importMoodleQuestion(
    'matching',
    '<p>Match.</p>',
    matchingSubquestion('France', 'Europe') + matchingSubquestion('Germany', 'Europe'),
  );
  expect(imported.items[0].draft.targets).toHaveLength(1);
  expect(imported.items[0].draft.targets?.[0].matchMax).toBe(0);
  expect(imported.items[0].xml).toContain('identifier="T1" match-max="0"');
  expectImportedScore(imported, { RESPONSE: ['S1 T1', 'S2 T1'] }, 1);
});

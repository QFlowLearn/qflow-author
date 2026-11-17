import { expect, test } from 'vitest';
import { importMoodleQuestion } from './helpers/moodle_second_pass.ts';
import { expectImportedScore } from './helpers/lms_import.ts';
const dragboxes =
  '<shuffleanswers>1</shuffleanswers><dragbox><text>Paris</text><group>1</group><infinite/></dragbox><dragbox><text>Berlin</text><group>1</group></dragbox>';
test('Moodle exported dragboxes map position indexes into canonical choices and gaps', async () => {
  const { imported, analysis } = await importMoodleQuestion(
    'ddwtos',
    '<p>Capital: [[1]].</p>',
    dragboxes,
  );
  expect(analysis.items[0].readiness).toBe('ready');
  expect(imported.items[0].draft.gapChoices).toHaveLength(2);
  expect(imported.items[0].draft.gapChoices?.[0].matchMax).toBe(0);
  expect(imported.items[0].draft.correctGapPairs).toEqual([{
    choiceId: 'CHOICE_1',
    gapId: 'GAP_1',
  }]);
  expectImportedScore(imported, { RESPONSE: ['CHOICE_1 GAP_1'] }, 1);
});
test('repeated Moodle dragboxes use distinct gaps and cannot hide unsupported normalized grading', async () => {
  const { imported, analysis } = await importMoodleQuestion(
    'ddwtos',
    '<p>[[1]] and [[1]].</p>',
    dragboxes,
  );
  expect(imported.items[0].draft.gaps?.map((gap) => gap.id)).toEqual(['GAP_1', 'GAP_2']);
  expect(imported.items[0].draft.correctGapPairs).toHaveLength(2);
  expect(analysis.items[0].readiness).toBe('blocked');
  expect(analysis.items[0].warnings.some((w) => w.code === 'LMS_SCORING_REVIEW')).toBe(true);
});

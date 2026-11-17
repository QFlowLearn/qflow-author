import { expect, test } from 'vitest';
import { importMoodleQuestion } from './helpers/moodle_second_pass.ts';
import { expectImportedScore } from './helpers/lms_import.ts';
const choices = ['One', 'Two', 'Three'].map((answer, index) =>
  `<answer fraction="${index}" format="html"><text>${answer}</text></answer>`
).join('');
test('Moodle ordering keeps supported grading and initial shuffle', async () => {
  const { imported, analysis } = await importMoodleQuestion(
    'ordering',
    '<p>Order.</p>',
    `<selecttype>ALL</selecttype><selectcount>3</selectcount><gradingtype>ALL_OR_NOTHING</gradingtype>${choices}`,
  );
  expect(analysis.items[0].readiness).toBe('ready');
  expect(imported.items[0].draft.shuffle).toBe(true);
  expectImportedScore(imported, { RESPONSE: ['C1', 'C2', 'C3'] }, 1);
});
test('Moodle ordering blocks unsupported grading and discloses fixed subset conversion', async () => {
  const { imported, analysis } = await importMoodleQuestion(
    'ordering',
    '<p>Order.</p>',
    `<selecttype>RANDOM</selecttype><selectcount>2</selectcount><gradingtype>ABSOLUTE_POSITION</gradingtype>${choices}`,
  );
  expect(analysis.items[0].readiness).toBe('blocked');
  expect(
    analysis.items[0].warnings.some((w) =>
      w.code === 'LMS_SCORING_REVIEW' && w.message.includes('ABSOLUTE_POSITION')
    ),
  ).toBe(true);
  expect(analysis.items[0].warnings.some((w) => w.message.includes('RANDOM with count 2'))).toBe(
    true,
  );
  expect(imported.items[0].draft.choices).toHaveLength(3);
});

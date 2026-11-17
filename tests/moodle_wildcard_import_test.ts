import { expect, test } from 'vitest';
import { expectImportedScore, importMoodle, moodleQuestion } from './helpers/lms_import.ts';
test('Moodle wildcard matching cannot become an undisclosed literal answer', async () => {
  const q = moodleQuestion('shortanswer', '<answer fraction="100"><text>colo*r</text></answer>');
  const { imported, analysis } = await importMoodle(q + q.replace('Question', 'Other'));
  expect(imported.items[0].draft.textEntries?.[0].answers[0].value).toBe('colo*r');
  expect(
    analysis.items.every((item) =>
      item.readiness === 'blocked' &&
      item.warnings.some((warning) => warning.message.includes('wildcards'))
    ),
  ).toBe(true);
});
test('escaped literal stars and angle brackets retain exact answer text', async () => {
  const { imported, analysis } = await importMoodle(
    moodleQuestion(
      'shortanswer',
      '<usecase>1</usecase><answer fraction="100"><text><![CDATA[C\\*<T>]]></text></answer>',
    ),
  );
  expect(analysis.items[0].readiness).toBe('ready');
  expectImportedScore(imported, { RESPONSE: 'C*<T>' }, 1);
  expectImportedScore(imported, { RESPONSE: 'C<T>' }, 0);
});

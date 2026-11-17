import { expect, test } from 'vitest';
import { importMoodle, moodleChoices, moodleQuestion } from './helpers/lms_import.ts';
test('unsupported Moodle questions retain their position, content and blocking review notice', async () => {
  const { imported, analysis } = await importMoodle(
    moodleQuestion('multichoice', moodleChoices, 'First') +
      moodleQuestion('calculated', '', 'Calculated') +
      moodleQuestion('multichoice', moodleChoices, 'Last'),
  );
  expect(imported.items.map((item) => item.title)).toEqual(['First', 'Calculated', 'Last']);
  expect(analysis.items.map((item) => item.readiness)).toEqual(['ready', 'blocked', 'ready']);
  expect(analysis.items[1].warnings.map((warning) => warning.code)).toContain(
    'UNSUPPORTED_MOODLE_TYPE',
  );
  expect(imported.items[1].draft.bodyHtml).toContain('Source prompt.');
});

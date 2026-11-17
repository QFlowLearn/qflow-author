import { expect, test } from 'vitest';
import { importMoodle, moodleChoices, moodleQuestion } from './helpers/lms_import.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
test('Moodle shuffleanswers element survives import and generated QTI', async () => {
  for (
    const [value, expected] of [['true', true], ['1', true], ['false', false], [
      '0',
      false,
    ]] as const
  ) {
    const { imported } = await importMoodle(
      moodleQuestion('multichoice', `<shuffleanswers>${value}</shuffleanswers>${moodleChoices}`),
    );
    expect(imported.items[0].draft.shuffle).toBe(expected);
    const preview = buildQtiPreviewXml(imported.items[0].draft);
    if (!preview.ok) expect.unreachable('Expected usable preview');
    expect(preview.xml).toContain(`shuffle="${expected}"`);
  }
});

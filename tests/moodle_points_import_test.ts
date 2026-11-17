import { expect, test } from 'vitest';
import {
  expectImportedScore,
  importMoodle,
  moodleChoices,
  moodleQuestion,
} from './helpers/lms_import.ts';
test('Moodle points survive import, preview and export including fractional and zero maxima', async () => {
  for (const points of [0, 2.5, 5]) {
    const { imported } = await importMoodle(
      moodleQuestion('multichoice', `<defaultgrade>${points}</defaultgrade>${moodleChoices}`),
    );
    expect(imported.items[0].draft.maximumScore).toBe(points);
    expectImportedScore(imported, { RESPONSE: 'A' }, points);
    expectImportedScore(imported, { RESPONSE: 'B' }, 0);
    const text = await importMoodle(
      moodleQuestion(
        'shortanswer',
        `<defaultgrade>${points}</defaultgrade><answer fraction="100"><text>Paris</text></answer>`,
      ),
    );
    expectImportedScore(text.imported, { RESPONSE: 'Paris' }, points);
  }
});
test('invalid Moodle marks require correction rather than a ready one-point conversion', async () => {
  for (const points of ['-1', 'invalid', 'Infinity']) {
    expect(
      (await importMoodle(
        moodleQuestion('multichoice', `<defaultgrade>${points}</defaultgrade>${moodleChoices}`),
      )).analysis.items[0].readiness,
    ).toBe('blocked');
  }
});

import { expect, test } from 'vitest';
import { expectImportedScore, importMoodle, moodleQuestion } from './helpers/lms_import.ts';
const answers = (fractions: number[]) =>
  fractions.map((value, index) =>
    `<answer fraction="${value}"><text>Option ${index + 1}</text></answer>`
  ).join('');
test('unsupported Moodle choice weights and penalties require correction on the affected question', async () => {
  for (const [single, fractions] of [[true, [100, 50, 0]], [false, [20, 80, -50]]] as const) {
    const q = moodleQuestion('multichoice', `<single>${single}</single>${answers([...fractions])}`);
    const result = await importMoodle(q + q.replace('Question', 'Second'));
    expect(
      result.analysis.items.every((item) =>
        item.readiness === 'blocked' &&
        item.warnings.some((warning) => warning.code === 'LMS_SCORING_REVIEW')
      ),
    ).toBe(true);
  }
});
test('equal Moodle choice fractions retain their point scale through preview and export', async () => {
  const { imported, analysis } = await importMoodle(
    moodleQuestion(
      'multichoice',
      `<defaultgrade>5</defaultgrade><single>false</single>${answers([50, 50, 0])}`,
    ),
  );
  expect(analysis.items[0].readiness).toBe('ready');
  expectImportedScore(imported, { RESPONSE: ['A'] }, 2.5);
  expectImportedScore(imported, { RESPONSE: ['A', 'B'] }, 5);
});

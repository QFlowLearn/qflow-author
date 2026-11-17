import { expect, test } from 'vitest';
import { importMoodleQuestion } from './helpers/moodle_second_pass.ts';
import { expectImportedScore } from './helpers/lms_import.ts';
test('Moodle Cloze escapes and an initially weighted alternative retain their exact keys', async () => {
  for (
    const [body, response, score] of [[String.raw`<p>{1:SHORTANSWER:=a\#b}</p>`, 'a#b', 1], [
      String.raw`<p>{1:SA:=a\}b}</p>`,
      'a}b',
      1,
    ], ['<p>{1:SHORTANSWER:%50%cat~=dog}</p>', 'cat', .5]] as const
  ) {
    const { imported, analysis } = await importMoodleQuestion('cloze', body);
    expect(analysis.items[0].readiness).toBe('ready');
    expectImportedScore(imported, { RESPONSE_1: response }, score);
  }
});
test('Moodle Cloze aliases preserve case and shuffle settings', async () => {
  const { imported } = await importMoodleQuestion('cloze', '<p>{:SAC:=Cat}</p>');
  expectImportedScore(imported, { RESPONSE_1: 'Cat' }, 1);
  expectImportedScore(imported, { RESPONSE_1: 'cat' }, 0);
  const shuffled = await importMoodleQuestion('cloze', '<p>{1:MCS:=Paris~Berlin}</p>');
  expect(shuffled.imported.items[0].draft.inlineChoices?.[0].shuffle).toBe(true);
});

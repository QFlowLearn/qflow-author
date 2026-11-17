import { expect, test } from 'vitest';
import { importMoodleQuestion } from './helpers/moodle_second_pass.ts';
import { expectImportedScore } from './helpers/lms_import.ts';
test('Moodle numerical Cloze separates zero tolerance from the actual numeric key', async () => {
  const { imported, analysis } = await importMoodleQuestion('cloze', '<p>{1:NUMERICAL:=10:0}</p>');
  expect(analysis.items[0].readiness).toBe('ready');
  expect(imported.items[0].draft.textEntries?.[0].answers[0].value).toBe('10');
  expectImportedScore(imported, { RESPONSE_1: 10 }, 1);
  expectImportedScore(imported, { RESPONSE_1: 11 }, 0);
});
test('unsupported or malformed Cloze tolerances remain explicit correction items', async () => {
  for (const rule of ['10:0.5', '10:invalid', '10:-1', '10:0:extra']) {
    const { imported, analysis } = await importMoodleQuestion('cloze', `<p>{1:NM:=${rule}}</p>`);
    expect(analysis.items[0].readiness).toBe('blocked');
    expect(analysis.items[0].warnings.some((w) => w.code === 'LMS_SCORING_REVIEW')).toBe(true);
    expect(imported.items[0].draft.textEntries?.[0].answers[0].value).toBe('10');
    expectImportedScore(imported, { RESPONSE_1: 10 }, 1);
  }
});

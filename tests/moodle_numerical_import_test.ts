import { expect, test } from 'vitest';
import { expectImportedScore, importMoodle, moodleQuestion } from './helpers/lms_import.ts';
test('Moodle tolerance and unit losses are retained as blocking item-owned findings', async () => {
  for (
    const extra of [
      '<tolerance>0.5</tolerance>',
      '<tolerance>-1</tolerance>',
      '<tolerance>invalid</tolerance>',
    ]
  ) {
    const q = moodleQuestion(
      'numerical',
      `<answer fraction="100"><text>10</text>${extra}</answer>`,
    );
    const { imported, analysis } = await importMoodle(q + q.replace('Question', 'Second'));
    expect(imported.items[0].draft.textEntries?.[0].answers[0].value).toBe('10');
    expect(analysis.items.every((item) => item.readiness === 'blocked')).toBe(true);
    expect(analysis.items[0].warnings[0].message).toContain('tolerances');
  }
  const units = await importMoodle(
    moodleQuestion(
      'numerical',
      '<answer fraction="100"><text>10</text></answer><units><unit><unit_name>cm</unit_name><multiplier>1</multiplier></unit></units>',
    ),
  );
  expect(units.analysis.items[0].readiness).toBe('blocked');
});
test('exact Moodle numerical matching retains source points', async () => {
  const { imported, analysis } = await importMoodle(
    moodleQuestion(
      'numerical',
      '<defaultgrade>3</defaultgrade><answer fraction="100"><text>10</text><tolerance>0</tolerance></answer>',
    ),
  );
  expect(analysis.items[0].readiness).toBe('ready');
  expectImportedScore(imported, { RESPONSE: 10 }, 3);
  expectImportedScore(imported, { RESPONSE: 10.3 }, 0);
});

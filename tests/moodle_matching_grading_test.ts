import { expect, test } from 'vitest';
import { importMoodleQuestion, matchingSubquestion } from './helpers/moodle_second_pass.ts';
test('Moodle matching cannot silently approve a partial-credit scoring downgrade', async () => {
  const { imported, analysis } = await importMoodleQuestion(
    'matching',
    '<p>Match.</p>',
    matchingSubquestion('France', 'Paris') + matchingSubquestion('Germany', 'Berlin'),
  );
  expect(imported.items[0].draft.type).toBe('match');
  expect(imported.items[0].draft.correctPairs).toHaveLength(2);
  expect(analysis.items[0].readiness).toBe('blocked');
  expect(
    analysis.items[0].warnings.some((w) =>
      w.code === 'LMS_SCORING_REVIEW' && w.message.includes('independent credit')
    ),
  ).toBe(true);
});
test('one-pair Moodle matching does not acquire a false scoring blocker', async () => {
  const { analysis } = await importMoodleQuestion(
    'matching',
    '<p>Match.</p>',
    matchingSubquestion('France', 'Paris') + matchingSubquestion('', 'Berlin'),
  );
  expect(analysis.items[0].readiness).toBe('ready');
});

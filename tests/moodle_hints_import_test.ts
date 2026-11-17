import { expect, test } from 'vitest';
import { importMoodleQuestion, twoChoices } from './helpers/moodle_second_pass.ts';
test('Moodle hints and retry flags survive as evidence with an explicit delivery notice', async () => {
  const { imported, analysis } = await importMoodleQuestion(
    'multichoice',
    '<p>Pick</p>',
    `${twoChoices}<hint format="html"><text><![CDATA[<p>Remember capitals.</p>]]></text><shownumcorrect/><clearwrong/></hint>`,
  );
  expect(analysis.items[0].readiness).toBe('minor_review');
  expect(imported.items[0].sourceEvidence?.find((e) => e.blockId === 'hint-1')?.quote).toContain(
    'shownumcorrect=true, clearwrong=true',
  );
  expect(imported.items[0].sourceEvidence?.find((e) => e.blockId === 'hint-1')?.quote).toContain(
    'Remember capitals.',
  );
  expect(imported.items[0].draft.bodyHtml).not.toContain('Remember');
});
test('missing media inside a Moodle hint produces an owning-item blocker', async () => {
  const { analysis } = await importMoodleQuestion(
    'multichoice',
    '<p>Pick</p>',
    `${twoChoices}<hint format="html"><text><![CDATA[<img src="@@PLUGINFILE@@/hint.png" alt="Hint">]]></text></hint>`,
  );
  expect(analysis.items[0].readiness).toBe('blocked');
  expect(analysis.items[0].warnings.map((w) => w.code)).toContain('LMS_MEDIA_REVIEW');
});

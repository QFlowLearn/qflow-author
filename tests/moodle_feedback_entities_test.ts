import { expect, test } from 'vitest';
import { importMoodleQuestion, twoChoices } from './helpers/moodle_second_pass.ts';
test('Moodle HTML feedback decodes entities once before literal feedback projection', async () => {
  const { imported, analysis } = await importMoodleQuestion(
    'multichoice',
    '<p>Pick</p>',
    `${twoChoices}<generalfeedback format="html"><text><![CDATA[2 &lt; 3 &amp; 4 &gt; 3; &#169; &amp;lt;]]></text></generalfeedback>`,
  );
  expect(imported.items[0].draft.answerFeedback?.correct?.text).toBe('2 < 3 & 4 > 3; © &lt;');
  expect(imported.items[0].xml).not.toContain('2 &amp;lt;');
  expect(analysis.items[0].readiness).toBe('ready');
});
test('Moodle plain feedback remains literal even when it contains markup or entities', async () => {
  const { imported, analysis } = await importMoodleQuestion(
    'multichoice',
    '<p>Pick</p>',
    `${twoChoices}<generalfeedback format="plain_text"><text><![CDATA[<b> &lt; literal]]></text></generalfeedback>`,
  );
  expect(imported.items[0].draft.answerFeedback?.correct?.text).toBe('<b> &lt; literal');
  expect(analysis.items[0].readiness).toBe('ready');
});

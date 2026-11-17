import { expect, test } from 'vitest';
import {
  expectImportedScore,
  importMoodle,
  moodleChoices,
  moodleQuestion,
} from './helpers/lms_import.ts';
test('Moodle whole-response feedback survives export without appearing in the learner prompt', async () => {
  const { imported, analysis } = await importMoodle(
    moodleQuestion(
      'multichoice',
      `${moodleChoices}<generalfeedback><text>General explanation.</text></generalfeedback><correctfeedback><text>Well done.</text></correctfeedback><incorrectfeedback><text>Try again.</text></incorrectfeedback>`,
    ),
  );
  expect(analysis.items[0].readiness).toBe('ready');
  expect(imported.items[0].draft.answerFeedback?.correct?.text).toContain('Well done.');
  expect(imported.items[0].xml).toContain('Try again.');
  expect(imported.items[0].draft.bodyHtml).not.toContain('explanation');
  expectImportedScore(imported, { RESPONSE: 'A' }, 1);
});
test('unsupported answer-specific feedback is visible in evidence and review notices', async () => {
  const { imported, analysis } = await importMoodle(
    moodleQuestion(
      'multichoice',
      moodleChoices.replace(
        '<text>Paris</text>',
        '<text>Paris</text><feedback format="html"><text><![CDATA[<strong>Because Paris is in France.</strong>]]></text></feedback>',
      ),
    ),
  );
  expect(imported.items[0].sourceEvidence?.[0].quote).toContain('Because Paris');
  expect(analysis.items[0].warnings.map((warning) => warning.code)).toContain('LMS_CONTENT_REVIEW');
});

import { expect, test } from 'vitest';
import { expectImportedScore, importMoodle, moodleQuestion } from './helpers/lms_import.ts';
test('Moodle essays remain pending human grading and retain grader instructions and source points', async () => {
  const { imported, analysis } = await importMoodle(
    moodleQuestion(
      'essay',
      '<defaultgrade>5</defaultgrade><responseformat>editor</responseformat><responsefieldlines>15</responsefieldlines><graderinfo format="html"><text><![CDATA[<p>Grade <strong>reasoning</strong>.</p>]]></text></graderinfo><maxwordlimit>200</maxwordlimit>',
    ),
  );
  expect(imported.items[0].draft).toMatchObject({
    externalScored: 'human',
    format: 'xhtml',
    expectedLines: 15,
  });
  expect(imported.items[0].draft.rubricHtml).toContain('<strong>reasoning</strong>');
  expect(imported.items[0].draft.rubricHtml).toContain('Source maximum: 5 points');
  expect(analysis.items[0].readiness).toBe('minor_review');
  expect(analysis.items[0].warnings.map((warning) => warning.code)).toContain('LMS_CONTENT_REVIEW');
  expectImportedScore(imported, { RESPONSE: 'Reasoning' }, null);
});

import { expect, test } from 'vitest';
import { importMoodleQuestion, twoChoices } from './helpers/moodle_second_pass.ts';
test('unsupported Moodle text formats receive an explicit literal-formatting receipt', async () => {
  for (const format of ['markdown', 'moodle_auto_format', 'wiki_like']) {
    const { imported, analysis } = await importMoodleQuestion(
      'multichoice',
      '**Read carefully**\n\n- red\n- blue',
      twoChoices,
      format,
    );
    expect(imported.items[0].draft.bodyHtml).toContain('**Read carefully**');
    expect(imported.items[0].draft.bodyHtml).toContain('<br/>');
    expect(analysis.items[0].readiness).toBe('minor_review');
    expect(
      analysis.items[0].warnings.some((w) =>
        w.code === 'LMS_CONTENT_REVIEW' && w.message.includes(format)
      ),
    ).toBe(true);
  }
});
test('plain Moodle text retains literal markup and line breaks without a downgrade notice', async () => {
  const { imported, analysis } = await importMoodleQuestion(
    'multichoice',
    '<b>Literal</b>\nNext',
    twoChoices,
    'plain_text',
  );
  expect(imported.items[0].draft.bodyHtml).toContain('&lt;b&gt;Literal&lt;/b&gt;<br/>Next');
  expect(analysis.items[0].readiness).toBe('ready');
});

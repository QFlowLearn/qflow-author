import { expect, test } from 'vitest';
import { giftAdapter } from '../lib/import/adapters/gift.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';
test('GIFT essay-only files are detected and remain human-graded with or without general feedback', async () => {
  for (const answer of ['', '####Teacher explanation.']) {
    const source = {
      filename: 'essay.gift',
      bytes: new TextEncoder().encode(`::Essay::Explain your reasoning. {${answer}}`),
    };
    expect((await giftAdapter.sniff(source)).supported).toBe(true);
    const imported = await giftAdapter.parse(source);
    expect(imported.items[0].draft).toMatchObject({
      type: 'extended_text',
      externalScored: 'human',
    });
    expectImportedScore(imported, { RESPONSE: 'Reasoning.' }, null);
    if (answer) {
      expect(imported.items[0].sourceEvidence?.[0].quote).toBe('Teacher explanation.');
      expect((await analyzeImport(giftAdapter, imported, source)).items[0].warnings[0].code).toBe(
        'GIFT_FEEDBACK_IGNORED',
      );
      expect(imported.items[0].draft.bodyHtml).not.toContain('Teacher explanation');
    }
  }
});

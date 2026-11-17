import { expect, test } from 'vitest';
import { giftAdapter } from '../lib/import/adapters/gift.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';
test('Moodle GIFT true/false explanations survive as evidence with a delivery notice', async () => {
  for (
    const answer of [
      String.raw`TRUE#Wrong \# clue.#Right explanation.`,
      'FALSE##Right explanation.',
    ]
  ) {
    const source = {
      filename: 'moodle.gift',
      bytes: new TextEncoder().encode(`::TF::Statement.{${answer}}`),
    };
    const imported = await giftAdapter.parse(source);
    expect((await analyzeImport(giftAdapter, imported, source)).items[0].readiness).toBe(
      'minor_review',
    );
    const evidence = imported.items[0].sourceEvidence?.map((e) => e.quote).join('\n');
    expect(evidence).toContain('correct response explanation: Right explanation.');
    if (answer.startsWith('TRUE')) {
      expect(evidence).toContain('incorrect response explanation: Wrong # clue.');
    }
    expect(imported.items[0].draft.bodyHtml).not.toContain('explanation');
    expectImportedScore(imported, { RESPONSE: answer.startsWith('TRUE') ? 'TRUE' : 'FALSE' }, 1);
  }
});

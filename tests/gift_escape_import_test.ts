import { expect, test } from 'vitest';
import { giftAdapter } from '../lib/import/adapters/gift.ts';
import { expectImportedScore } from './helpers/lms_import.ts';
test('GIFT reserved characters remain literal through import, preview and export', async () => {
  for (
    const [escaped, literal] of [
      ['C\\#', 'C#'],
      ['x\\=y', 'x=y'],
      ['A\\~B', 'A~B'],
      ['a\\{b\\}', 'a{b}'],
      ['a\\\\b', 'a\\b'],
    ]
  ) {
    const result = await giftAdapter.parse({
      filename: 'escaped.gift',
      bytes: new TextEncoder().encode(`::Literal::Choose \\{literal\\}. {=${escaped}~Other}`),
    });
    expect(result.items[0].draft.choices?.[0].text).toBe(literal);
    expect(result.items[0].draft.bodyHtml).toContain('{literal}');
    expect(result.warnings).toBeUndefined();
    expectImportedScore(result, { RESPONSE: 'A' }, 1);
  }
});

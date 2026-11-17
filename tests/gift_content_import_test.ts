import { expect, test } from 'vitest';
import { giftAdapter } from '../lib/import/adapters/gift.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';
test('GIFT html format retains sanitized rich question and answer markup', async () => {
  const source = {
    filename: 'rich.gift',
    bytes: new TextEncoder().encode(
      '::Rich::[html]<p>Choose <strong>bold</strong>.</p>{=<em>Yes</em>~No}',
    ),
  };
  const imported = await giftAdapter.parse(source);
  expect(imported.items[0].draft.bodyHtml).toContain('<strong>bold</strong>');
  expect(imported.items[0].draft.choices?.[0].html).toContain('<em>Yes</em>');
  expect(imported.items[0].xml).not.toContain('[html]');
  expectImportedScore(imported, { RESPONSE: 'A' }, 1);
});
test('GIFT plain text stays literal and unsupported formatting gets a review notice', async () => {
  for (const format of ['plain', 'markdown']) {
    const source = {
      filename: 'text.gift',
      bytes: new TextEncoder().encode(`::Text::[${format}]Choose <strong>text</strong>. {=Yes~No}`),
    };
    const imported = await giftAdapter.parse(source);
    expect(imported.items[0].draft.bodyHtml).toContain('&lt;strong&gt;');
    if (format === 'markdown') {
      expect((await analyzeImport(giftAdapter, imported, source)).items[0].readiness).toBe(
        'minor_review',
      );
    }
  }
});

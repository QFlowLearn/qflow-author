import { expect, test } from 'vitest';
import { giftAdapter } from '../lib/import/adapters/gift.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';
test('Moodle numerical GIFT alternatives produce valid floats and preserve answer weights', async () => {
  const source = {
    filename: 'numbers.gift',
    bytes: new TextEncoder().encode('::Number::Give a value. {# =%100%3.14:0 =%50%3:0}'),
  };
  const imported = await giftAdapter.parse(source);
  expect((await analyzeImport(giftAdapter, imported, source)).items[0].readiness).toBe('ready');
  expectImportedScore(imported, { RESPONSE: 3.14 }, 1);
  expectImportedScore(imported, { RESPONSE: 3 }, 0.5);
  expectImportedScore(imported, { RESPONSE: 7 }, 0);
});
test('GIFT tolerances, ranges and malformed numerical values require correction', async () => {
  for (const number of ['3.14:0.1', '=%100%3.14:0.1', '1..5', 'invalid']) {
    const source = {
      filename: 'numbers.gift',
      bytes: new TextEncoder().encode(
        `::Number::Give a value. {#${number}}\n\n::Good::Pick. {=Yes~No}`,
      ),
    };
    const imported = await giftAdapter.parse(source);
    expect((await analyzeImport(giftAdapter, imported, source)).items.map((item) => item.readiness))
      .toEqual(['blocked', 'ready']);
    expect(imported.items[0].xml).not.toContain('=%100%');
  }
});

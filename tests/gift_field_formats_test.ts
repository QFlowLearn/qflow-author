import { expect, test } from 'vitest';
import { giftAdapter } from '../lib/import/adapters/gift.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';
test('GIFT answer formats override their prompt format before rendering', async () => {
  for (
    const text of [
      '::Formats::[plain]Choose.{=[html]<b>Paris</b> ~Berlin}',
      '::Formats::[html]<p>Choose.</p>{=Paris ~[plain]<b>Literal</b>}',
    ]
  ) {
    const source = { filename: 'moodle.gift', bytes: new TextEncoder().encode(text) };
    const imported = await giftAdapter.parse(source);
    expect(imported.items[0].xml).not.toContain('[html]');
    expect(imported.items[0].xml).not.toContain('[plain]');
    if (text.includes('Literal')) {
      expect(imported.items[0].draft.choices?.[1].text).toBe('<b>Literal</b>');
    } else expect(imported.items[0].draft.choices?.[0].html).toBe('<b>Paris</b>');
    expect((await analyzeImport(giftAdapter, imported, source)).items[0].readiness).toBe('ready');
    expectImportedScore(imported, { RESPONSE: 'A' }, 1);
  }
});
test('GIFT per-answer unsupported formatting is disclosed', async () => {
  const source = {
    filename: 'moodle.gift',
    bytes: new TextEncoder().encode('::Formats::[plain]Choose.{=[markdown]**Paris** ~Berlin}'),
  };
  const imported = await giftAdapter.parse(source);
  expect(imported.items[0].draft.choices?.[0].text).toBe('**Paris**');
  expect((await analyzeImport(giftAdapter, imported, source)).items[0].readiness).toBe(
    'minor_review',
  );
});

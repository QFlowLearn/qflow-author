import { expect, test } from 'vitest';
import { giftAdapter } from '../lib/import/adapters/gift.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';
test('Moodle all-tilde GIFT exports remain multiple choice with supported equal weights', async () => {
  const source = {
    filename: 'weights.gift',
    bytes: new TextEncoder().encode('::Weights::Pick two. {~%50%A ~%50%B ~%0%C}'),
  };
  const imported = await giftAdapter.parse(source);
  expect(imported.items[0].draft.type).toBe('multi_select');
  expect((await analyzeImport(giftAdapter, imported, source)).items[0].readiness).toBe('ready');
  expectImportedScore(imported, { RESPONSE: ['A'] }, 0.5);
  expectImportedScore(imported, { RESPONSE: ['A', 'B'] }, 1);
});
test('unequal GIFT weights and penalties block only their source questions', async () => {
  const source = {
    filename: 'weights.gift',
    bytes: new TextEncoder().encode(
      '::Weighted::Pick. {~%20%A ~%80%B ~%-100%C}\n\n::Good::Pick. {=Yes~No}',
    ),
  };
  const imported = await giftAdapter.parse(source);
  const analysis = await analyzeImport(giftAdapter, imported, source);
  expect(analysis.items.map((item) => item.readiness)).toEqual(['blocked', 'ready']);
  expect(analysis.items[0].warnings[0].code).toBe('LMS_SCORING_REVIEW');
});

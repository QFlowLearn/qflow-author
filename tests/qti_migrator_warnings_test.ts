import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';
import { buildMigrationAnalysis } from '../lib/import/migration_analysis.ts';

test('multi-question migration attaches blocking diagnostics to their own generated item paths', async () => {
  const source = {
    filename: 'review-identity.xml',
    bytes: await readFile(new URL('fixtures/import/sakai/review-identity.xml', import.meta.url)),
  };
  const sniff = await qti12Adapter.sniff(source);
  const parsed = await qti12Adapter.parse(source);
  const analysis = buildMigrationAnalysis(
    parsed,
    { adapter: qti12Adapter, sniff },
    { _tag: 'Assessment' },
  );
  expect(analysis.items.map((item) => item.readiness)).toEqual(['blocked', 'blocked', 'ready']);
  for (const item of analysis.items.slice(0, 2)) {
    expect(item.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'QTI12_RESPONSE_PROCESSING_UNSUPPORTED',
      'UNSUPPORTED_ITEM_STUBBED',
    ]));
    expect(item.warnings.every((warning) => warning.path === item.sourceHref)).toBe(true);
  }
  expect(analysis.items[2].warnings).toEqual([]);
  expect(analysis.summary.counts.blocked).toBe(2);
});

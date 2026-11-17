import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';
import { buildMigrationAnalysis } from '../lib/import/migration_analysis.ts';

test('failed QTI 1.x questions keep their own identity in compact and indented assessments', async () => {
  const original = await readFile(
    new URL('fixtures/import/sakai/review-identity.xml', import.meta.url),
    'utf8',
  );
  for (const xml of [original, original.replaceAll('><', '>\n    <')]) {
    const source = { filename: 'sakai.xml', bytes: new TextEncoder().encode(xml) };
    const sniff = await qti12Adapter.sniff(source);
    const parsed = await qti12Adapter.parse(source);
    expect(parsed.items.map((item) => item.title)).toEqual([
      'First question',
      'Second question',
      'Essay question',
    ]);
    expect(parsed.items.map((item) => item.identifier)).toEqual(['FIRST', 'SECOND', 'ESSAY']);
    expect(parsed.items.map((item) => item.draft.title)).toEqual([
      'First question',
      'Second question',
      'Essay question',
    ]);
    const analysis = buildMigrationAnalysis(parsed, { adapter: qti12Adapter, sniff }, {
      _tag: 'Assessment',
    });
    expect(analysis.items.map((item) => item.readiness)).toEqual(['blocked', 'blocked', 'ready']);
  }
});

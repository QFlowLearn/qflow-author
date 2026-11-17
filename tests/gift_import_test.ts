import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { giftAdapter } from '../lib/import/adapters/gift.ts';
import { writeZip } from '../lib/zip.ts';

const SAMPLE = new URL('fixtures/import/moodle/gift_sample.txt', import.meta.url).pathname;
const EXTRA = new URL('fixtures/import/gift/gift_extra.txt', import.meta.url).pathname;

testCase('GIFT import: sample file maps core types', async () => {
  const bytes = await _fs.readFile(SAMPLE);
  const result = await giftAdapter.parse({
    filename: 'gift_sample.txt',
    bytes,
    mime: 'text/plain',
  });

  expect(result.items.length).toStrictEqual(4);
  const types = result.items.map((item) => item.draft.type);
  expect(types.filter((t) => t === 'single_select').length).toStrictEqual(2);
  expect(types.filter((t) => t === 'text_entry').length).toStrictEqual(1);
  expect(types.filter((t) => t === 'match').length).toStrictEqual(1);
});

testCase('GIFT import: extra file covers cloze, numerical, essay, and categories', async () => {
  const bytes = await _fs.readFile(EXTRA);
  const result = await giftAdapter.parse({
    filename: 'gift_extra.txt',
    bytes,
    mime: 'text/plain',
  });

  expect(result.items.length).toStrictEqual(4);
  const types = result.items.map((item) => item.draft.type);
  expect(types.filter((t) => t === 'text_entry').length).toStrictEqual(2);
  expect(types.filter((t) => t === 'extended_text').length).toStrictEqual(1);
  expect(types.filter((t) => t === 'multi_select').length).toStrictEqual(1);

  const first = result.items[0].draft as { tags?: string[]; bodyHtml?: string };
  expect((first.tags ?? []).join(',')).toContain('Founding');
  expect(first.bodyHtml ?? '').toContain('data-qti-entry');
});

testCase('GIFT sniff does not claim ZIP uploads', async () => {
  const zipBytes = await writeZip([
    { name: 'data.txt', data: new TextEncoder().encode('{=A~B}') },
  ]);

  const result = await giftAdapter.sniff({
    filename: 'not-gift.zip',
    bytes: zipBytes,
    mime: 'application/zip',
  });

  expect(result).toStrictEqual({ supported: false, confidence: 0, reason: 'zip-input' });
});

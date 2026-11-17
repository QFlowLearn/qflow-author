import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { moodleXmlAdapter } from '../lib/import/adapters/moodle_xml.ts';

const SAMPLE = new URL('fixtures/import/moodle/sample1.xml', import.meta.url).pathname;
const SAMPLE_IMAGE =
  new URL('fixtures/import/moodle/sample_with_image.xml', import.meta.url).pathname;
const SAMPLE_CLOZE = new URL('fixtures/import/moodle/sample_cloze.xml', import.meta.url).pathname;
const SAMPLE_DDWTOS = new URL('fixtures/import/moodle/sample_ddwtos.xml', import.meta.url).pathname;

testCase('Moodle XML import: sample1.xml maps core question types', async () => {
  const bytes = await _fs.readFile(SAMPLE);
  const result = await moodleXmlAdapter.parse({
    filename: 'sample1.xml',
    bytes,
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(6);
  const types = result.items.map((item) => item.draft.type);
  expect(types.filter((t) => t === 'single_select').length).toStrictEqual(4);
  expect(types.filter((t) => t === 'extended_text').length).toStrictEqual(1);
  expect(types.filter((t) => t === 'text_entry').length).toStrictEqual(1);
});

testCase('Moodle XML import: requires exact XML attribute names', () => {
  const bytes = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<quiz>
  <question TYPE="essay">
    <name><text>Case-sensitive attribute</text></name>
    <questiontext format="html"><text><![CDATA[<p>Prompt</p>]]></text></questiontext>
  </question>
</quiz>`);
  expect(() =>
    moodleXmlAdapter.parse({
      filename: 'case-sensitive-attribute.xml',
      bytes,
      mime: 'application/xml',
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('No Moodle questions could be imported')
    ),
  );
});

testCase('Moodle XML import: embedded files become assets and URLs are rewritten', async () => {
  const bytes = await _fs.readFile(SAMPLE_IMAGE);
  const result = await moodleXmlAdapter.parse({
    filename: 'sample_with_image.xml',
    bytes,
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(1);
  expect(result.assets.length).toStrictEqual(1);
  const asset = result.assets[0];
  expect(asset.path).toContain('moodle/');
  expect(asset.path).toContain('map.png');
  expect(result.items[0].draft.bodyHtml ?? '').toContain(asset.path);
});

testCase('Moodle XML import: cloze maps to text entry with placeholder', async () => {
  const bytes = await _fs.readFile(SAMPLE_CLOZE);
  const result = await moodleXmlAdapter.parse({
    filename: 'sample_cloze.xml',
    bytes,
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(1);
  const draft = result.items[0].draft as unknown as {
    type?: string;
    textEntries?: Array<{ id: string }>;
    bodyHtml?: string;
  };
  expect(draft.type).toStrictEqual('text_entry');
  expect(draft.textEntries?.length).toStrictEqual(1);
  expect(draft.bodyHtml ?? '').toContain('data-qti-entry');
});

testCase('Moodle XML import: ddwtos maps to gap match', async () => {
  const bytes = await _fs.readFile(SAMPLE_DDWTOS);
  const result = await moodleXmlAdapter.parse({
    filename: 'sample_ddwtos.xml',
    bytes,
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(1);
  const draft = result.items[0].draft as unknown as {
    type?: string;
    gapChoices?: Array<{ id: string }>;
    gaps?: Array<{ id: string }>;
  };
  expect(draft.type).toStrictEqual('gap_match');
  expect(draft.gapChoices?.length).toStrictEqual(2);
  expect(draft.gaps?.length).toStrictEqual(1);
});

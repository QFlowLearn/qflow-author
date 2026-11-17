import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { sha256Hex } from '../lib/sha256.ts';

const fixtureDir = new URL('fixtures/import/respondus/', import.meta.url);
const expectedFiles: string[] = [
  'loose-numbered-quiz.pdf',
  'word-automatic-numbering.docx',
  'word-embedded-media.docx',
  'word-visible-numbering.docx',
];

testCase('Respondus generated fixture bytes match their committed fingerprints', async () => {
  const manifestText = await _fs.readFile(new URL('manifest.json', fixtureDir), 'utf8');
  const manifest = parseManifest(JSON.parse(manifestText));
  expect(manifest.files.map((file) => file.name)).toStrictEqual(expectedFiles);

  for (const file of manifest.files) {
    const bytes = await _fs.readFile(new URL(file.name, fixtureDir));
    expect(bytes.byteLength).toStrictEqual(file.bytes);
    expect(await sha256Hex(bytes)).toStrictEqual(file.sha256);
  }
});

type FixtureManifest = {
  readonly files: readonly {
    readonly name: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
};

function parseManifest(input: unknown): FixtureManifest {
  const manifest = record(input);
  if (
    !manifest ||
    manifest.schema !== 'qflow.respondus-fixture-corpus.v1' ||
    manifest.generator !== 'tools/generate_respondus_fixture_corpus.py' ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error('Respondus fixture manifest envelope is invalid.');
  }
  const files = manifest.files.map((inputFile) => {
    const file = record(inputFile);
    if (
      !file ||
      typeof file.name !== 'string' ||
      typeof file.bytes !== 'number' ||
      !Number.isInteger(file.bytes) ||
      file.bytes <= 0 ||
      typeof file.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(file.sha256)
    ) {
      throw new Error('Respondus fixture manifest file entry is invalid.');
    }
    return {
      name: file.name,
      bytes: file.bytes,
      sha256: file.sha256,
    };
  });
  return { files };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    // SAFETY: The checks establish a non-null, non-array object with unknown fields.
    ? value as Record<string, unknown>
    : null;
}

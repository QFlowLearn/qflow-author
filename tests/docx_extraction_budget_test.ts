import { expect, test as testCase } from 'vitest';

import { zipSync } from 'fflate';

import { extractDocxDocument } from '../lib/conversion/extract_docx_source.ts';
import { SourceExtractionError } from '../lib/conversion/source_model.ts';
import { MAX_SOURCE_ARCHIVE_ENTRIES, MAX_SOURCE_FILE_BYTES } from '../lib/source_intake/policy.ts';

testCase('DOCX extraction rejects compressed bytes before opening the archive', async () => {
  const error = await (async () => {
    const caught: unknown = await Promise.resolve().then(() =>
      extractDocxDocument('Oversized', new Uint8Array(MAX_SOURCE_FILE_BYTES + 1))
    ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
    if (!(caught instanceof SourceExtractionError)) {
      expect.unreachable('Expected SourceExtractionError');
    }
    return caught;
  })();
  expect(error.message).toStrictEqual('DOCX sources must be 16 MB or smaller.');
});

testCase('DOCX extraction rejects archives that exceed the entry budget', async () => {
  const entries: Record<string, Uint8Array> = {};
  for (let index = 0; index <= MAX_SOURCE_ARCHIVE_ENTRIES; index += 1) {
    entries[`entry-${index}.xml`] = new Uint8Array();
  }
  const bytes = zipSync(entries, { level: 0 });

  const error = await (async () => {
    const caught: unknown = await Promise.resolve().then(() =>
      extractDocxDocument('Too many entries', bytes)
    ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
    if (!(caught instanceof SourceExtractionError)) {
      expect.unreachable('Expected SourceExtractionError');
    }
    return caught;
  })();
  expect(error.message).toStrictEqual(
    'DOCX sources may contain no more than 10,000 files and folders.',
  );
});

import { expect, test as testCase } from 'vitest';

import { zipSync } from 'fflate';

import {
  assertImportArchivePolicy,
  ImportArchivePolicyError,
} from '../lib/import/archive_policy.ts';
import { inspectImportAdapters } from '../lib/import/registry.ts';
import {
  MAX_SOURCE_ARCHIVE_ENTRIES,
  MAX_SOURCE_ARCHIVE_EXPANDED_BYTES,
  MAX_SOURCE_FILE_BYTES,
} from '../lib/source_intake/policy.ts';
import { inspectSource } from '../lib/source_intake/registry.ts';
import { withZipArchive } from '../lib/zip_archive.ts';

testCase('import inspection rejects a ZIP that exceeds the expanded-byte budget', async () => {
  const bytes = zipSync({
    'oversized.txt': new Uint8Array(MAX_SOURCE_ARCHIVE_EXPANDED_BYTES + 1),
  }, { level: 9 });
  expect(bytes.byteLength < MAX_SOURCE_FILE_BYTES).toStrictEqual(true);

  const error = await (async () => {
    const caught: unknown = await Promise.resolve().then(() =>
      inspectImportAdapters({ filename: 'oversized.zip', bytes }, [])
    ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
    if (!(caught instanceof ImportArchivePolicyError)) {
      expect.unreachable('Expected ImportArchivePolicyError');
    }
    return caught;
  })();
  expect(error.code).toStrictEqual('uncompressed_size');
});

testCase('import inspection accepts a ZIP with exactly 10,000 entries', async () => {
  const entries: Record<string, Uint8Array> = {};
  for (let index = 0; index < 10_000; index += 1) {
    entries[`entry-${index}.txt`] = new Uint8Array();
  }
  await assertImportArchivePolicy({
    filename: 'ten-thousand-entries.zip',
    bytes: zipSync(entries, { level: 0 }),
  });
});

testCase('import inspection rejects a ZIP with 10,001 entries', async () => {
  const entries: Record<string, Uint8Array> = {};
  for (let index = 0; index <= 10_000; index += 1) {
    entries[`entry-${index}.txt`] = new Uint8Array();
  }
  const bytes = zipSync(entries, { level: 0 });
  expect(bytes.byteLength < MAX_SOURCE_FILE_BYTES).toStrictEqual(true);

  const error = await (async () => {
    const caught: unknown = await Promise.resolve().then(() =>
      inspectImportAdapters({ filename: 'too-many-entries.zip', bytes }, [])
    ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
    if (!(caught instanceof ImportArchivePolicyError)) {
      expect.unreachable('Expected ImportArchivePolicyError');
    }
    return caught;
  })();
  expect(error.code).toStrictEqual('entry_count');
});

testCase('import inspection rejects an invalid ZIP before adapters run', async () => {
  const source = {
    filename: 'invalid.zip',
    bytes: Uint8Array.of(0x50, 0x4b, 0x00, 0x00),
  };
  const error = await (async () => {
    const caught: unknown = await Promise.resolve().then(() => inspectImportAdapters(source, []))
      .then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
    if (!(caught instanceof ImportArchivePolicyError)) {
      expect.unreachable('Expected ImportArchivePolicyError');
    }
    return caught;
  })();
  expect(error.code).toStrictEqual('invalid_archive');

  expect(await inspectSource('recover_existing', { _tag: 'file', source })).toStrictEqual({
    _tag: 'unsupported',
    sourceName: 'invalid.zip',
    message: 'QFlowLearn cannot read this ZIP package. Export a new package, then upload it again.',
    code: 'archive_invalid',
  });
});

testCase('import inspection verifies declared expanded sizes before adapters run', async () => {
  const valid = zipSync({ 'lying-size.txt': new Uint8Array(1_024) }, { level: 9 });
  const bytes = withCentralUncompressedSize(valid, 1);

  const error = await (async () => {
    const caught: unknown = await Promise.resolve().then(() =>
      inspectImportAdapters({ filename: 'lying-size.zip', bytes }, [])
    ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
    if (!(caught instanceof ImportArchivePolicyError)) {
      expect.unreachable('Expected ImportArchivePolicyError');
    }
    return caught;
  })();
  expect(error.code).toStrictEqual('invalid_archive');
});

testCase(
  'import inspection rejects understated expansion metadata before adapters read content',
  async () => {
    const valid = zipSync({
      'lying-size.txt': new Uint8Array(MAX_SOURCE_ARCHIVE_EXPANDED_BYTES + 1),
    }, { level: 9 });
    const bytes = withCentralUncompressedSize(valid, 1);

    const error = await (async () => {
      const caught: unknown = await Promise.resolve().then(() =>
        inspectImportAdapters({ filename: 'lying-size.zip', bytes }, [])
      ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
      if (!(caught instanceof ImportArchivePolicyError)) {
        expect.unreachable('Expected ImportArchivePolicyError');
      }
      return caught;
    })();
    // Node streams expose the malformed declared size before the application byte budget is reached.
    expect(error.code).toStrictEqual('invalid_archive');
  },
);

testCase('bounded entry extraction rejects forged metadata before collecting content', async () => {
  const actualBytes = 2 * 1024 * 1024;
  const maximumBytes = 1024 * 1024;
  const valid = zipSync({ 'lying-size.txt': new Uint8Array(actualBytes) }, { level: 9 });
  const bytes = withCentralUncompressedSize(valid, 1);

  const error = await (async () => {
    const caught: unknown = await Promise.resolve().then(() =>
      withZipArchive(
        bytes,
        {
          maxCompressedBytes: MAX_SOURCE_FILE_BYTES,
          maxEntries: MAX_SOURCE_ARCHIVE_ENTRIES,
          maxTotalUncompressedBytes: maximumBytes,
        },
        async (archive) => {
          const entry = archive.file('lying-size.txt');
          if (!entry) throw new Error('Test ZIP is missing lying-size.txt.');
          await entry.async('uint8array');
        },
      )
    ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
    if (!(caught instanceof Error)) expect.unreachable('Expected Error');
    expect(caught.message).toContain('Invalid uncompressed size');
    return caught;
  })();
  expect(error.message).toStrictEqual('Invalid uncompressed size');
});

function withCentralUncompressedSize(bytes: Uint8Array, size: number): Uint8Array {
  const copy = bytes.slice();
  const signature = [0x50, 0x4b, 0x01, 0x02] as const;
  for (let offset = 0; offset <= copy.length - signature.length; offset += 1) {
    if (signature.every((value, index) => copy[offset + index] === value)) {
      new DataView(copy.buffer, copy.byteOffset, copy.byteLength).setUint32(
        offset + 24,
        size,
        true,
      );
      return copy;
    }
  }
  throw new Error('Test ZIP is missing its central-directory entry.');
}

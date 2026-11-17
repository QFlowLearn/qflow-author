import { expect, test as testCase } from 'vitest';

import { Buffer } from 'node:buffer';

import { zipSync } from 'fflate';
import { openPackageZip, PackageZipError } from '../lib/import/package_zip_source.ts';

const limits = {
  maxCompressedBytes: 16 * 1024 * 1024,
  maxDirectoryBytes: 1024 * 1024,
  maxEntries: 10_000,
  maxEntryBytes: 4 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
};
const encode = (value: string) => new TextEncoder().encode(value);
const bytesSource = (bytes: Uint8Array) => ({
  size: bytes.length,
  read: (offset: number, length: number) => Promise.resolve(bytes.slice(offset, offset + length)),
});

for (const level of [0, 6] as const) {
  testCase(`package ZIP reads stored/deflated data and UTF-8 paths at level ${level}`, async () => {
    const contents = encode('Question data '.repeat(100));
    const zip = zipSync({ 'items/': new Uint8Array(), 'items/é.xml': contents }, { level });
    const source = await openPackageZip(bytesSource(zip), limits);
    expect(source.entries).toStrictEqual([{ path: 'items/é.xml', size: contents.length }]);
    expect(await source.readEntry('items/é.xml', contents.length)).toStrictEqual(contents);
    await expect(Promise.resolve().then(() => source.readEntry('items/é.xml', contents.length - 1)))
      .rejects.toBeInstanceOf(PackageZipError);
  });
}

testCase('package ZIP reads bounded ranges and leaves unrelated asset bytes unread', async () => {
  const zip = zipSync(
    { 'large.bin': new Uint8Array(2 * 1024 * 1024), 'question.xml': encode('<question/>') },
    { level: 0 },
  );
  const reads: { offset: number; length: number }[] = [];
  const source = await openPackageZip({
    size: zip.length,
    read(offset, length) {
      reads.push({ offset, length });
      return Promise.resolve(zip.slice(offset, offset + length));
    },
  }, limits);
  expect(await source.readEntry('question.xml', 100)).toStrictEqual(encode('<question/>'));
  if (!(reads.every((read) => read.length <= 65_557))) {
    expect.unreachable('Expected reads.every((read) => read.length <= 65_557)');
  }
  if (!(reads.reduce((sum, read) => sum + read.length, 0) < 70_000)) {
    expect.unreachable('Expected reads.reduce((sum, read) => sum + read.length, 0) < 70_000');
  }
});

testCase('package ZIP rejects corrupt stored data and mismatched local headers', async () => {
  const zip = zipSync({ 'item.xml': encode('question') }, { level: 0 });
  const corrupt = zip.slice();
  corrupt[30 + 'item.xml'.length] ^= 1;
  const source = await openPackageZip(bytesSource(corrupt), limits);
  await expect(Promise.resolve().then(() => source.readEntry('item.xml', 100))).rejects.toSatisfy((
    caught: unknown,
  ) => caught instanceof PackageZipError && caught.message.includes('integrity'));
  const wrongName = zip.slice();
  wrongName[30] = 120;
  const other = await openPackageZip(bytesSource(wrongName), limits);
  await expect(Promise.resolve().then(() => other.readEntry('item.xml', 100))).rejects.toSatisfy((
    caught: unknown,
  ) => caught instanceof PackageZipError && caught.message.includes('integrity'));
});

testCase(
  'package ZIP enforces actual inflation length against forged directory sizes',
  async () => {
    const zip = zipSync({ 'item.xml': encode('oversized'.repeat(1000)) });
    const bytes = zip.slice();
    const view = new DataView(bytes.buffer);
    const directoryOffset = view.getUint32(bytes.length - 22 + 16, true);
    view.setUint32(directoryOffset + 24, 1, true);
    view.setUint32(22, 1, true);
    const source = await openPackageZip(bytesSource(bytes), limits);
    await expect(Promise.resolve().then(() => source.readEntry('item.xml', 1))).rejects.toSatisfy((
      caught: unknown,
    ) => caught instanceof PackageZipError && caught.message.includes('limit'));
  },
);

for (const path of ['../item.xml', '/item.xml', 'a/../item.xml', './item.xml', 'C:/item.xml']) {
  testCase(`package ZIP rejects unsafe path ${path}`, async () => {
    await expect(
      Promise.resolve().then(() =>
        openPackageZip(bytesSource(zipSync({ [path]: encode('x') })), limits)
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof PackageZipError && caught.message.includes('invalid')
    );
  });
}

testCase(
  'package ZIP rejects entry, directory, expanded byte limits and truncated ranges',
  async () => {
    const bytes = zipSync({ 'a.xml': encode('123'), 'b.xml': encode('456') });
    for (
      const budget of [
        { ...limits, maxEntries: 1 },
        { ...limits, maxDirectoryBytes: 1 },
        { ...limits, maxTotalBytes: 5 },
        { ...limits, maxEntryBytes: 2 },
      ]
    ) {
      await expect(Promise.resolve().then(() => openPackageZip(bytesSource(bytes), budget))).rejects
        .toSatisfy((caught: unknown) =>
          caught instanceof PackageZipError && caught.message.includes('limit')
        );
    }
    await expect(
      Promise.resolve().then(() =>
        openPackageZip({ size: bytes.length, read: () => Promise.resolve(bytes.slice(1)) }, limits)
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof PackageZipError && caught.message.includes('integrity')
    );
  },
);

testCase(
  'package ZIP handles Buffer-backed byte ranges without inflating the backing archive',
  async () => {
    const content = encode('question'.repeat(20));
    const bytes = Buffer.from(zipSync({ 'item.xml': content }));
    const source = await openPackageZip({
      size: bytes.length,
      read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)),
    }, limits);
    expect(await source.readEntry('item.xml', content.length)).toStrictEqual(content);
  },
);

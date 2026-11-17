import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { resolveStorage } from '../lib/storage.ts';
import { openPackageZip } from '../lib/import/package_zip_source.ts';

it('reads and inflates a ZIP through bounded native R2 ranges', async () => {
  const storage = resolveStorage({ bindings: env });
  const key = `package-zip-test/${crypto.randomUUID()}`;
  const content = new TextEncoder().encode('Question content '.repeat(100));
  const bytes = zipSync({ 'items/item.xml': content });
  await storage.putObject({ key, data: bytes, contentType: 'application/zip' });
  try {
    expect(await storage.readObjectRange(key, 0, 4)).toEqual(bytes.slice(0, 4));
    const source = await openPackageZip({
      size: bytes.length,
      read: (offset, length) => storage.readObjectRange(key, offset, length),
    }, {
      maxCompressedBytes: 1024 * 1024,
      maxDirectoryBytes: 1024 * 1024,
      maxEntries: 10000,
      maxEntryBytes: 1024 * 1024,
      maxTotalBytes: 1024 * 1024,
    });
    expect(await source.readEntry('items/item.xml', content.length)).toEqual(content);
    await expect(storage.readObjectRange(key, bytes.length - 1, 2)).rejects.toThrow();
  } finally {
    await storage.deleteObject(key);
  }
});

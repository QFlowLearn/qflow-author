import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { uploadsTable } from '../lib/db/workspace_schema.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';
import { preparePrintAssets } from '../lib/services/assessment_print_assets.ts';

test('same upload metadata/path/size cannot conceal changed live image bytes from paper freshness', async () => {
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      const storage = createMemoryObjectStorage(),
        id = crypto.randomUUID(),
        path = `uploads/${ctx.tenantId}/${id}`,
        url = `/uploads/${id}`;
      const before = new Uint8Array(
        await readFile(new URL('./fixtures/print/metadata-alpha.png', import.meta.url)),
      );
      const after = new Uint8Array(
        await readFile(new URL('./fixtures/print/metadata-alpha-changed.png', import.meta.url)),
      );
      expect(after.length).toBe(before.length);
      await db.insert(uploadsTable).values({
        id,
        tenantId: ctx.tenantId,
        name: 'Diagram',
        mimeType: 'image/png',
        size: before.length,
        path,
        url,
      });
      try {
        await storage.putObject({ key: path, data: before, contentType: 'image/png' });
        const first = await preparePrintAssets(ctx, [url], storage);
        await storage.putObject({ key: path, data: after, contentType: 'image/png' });
        const second = await preparePrintAssets(ctx, [url], storage);
        expect(first.problems.size + second.problems.size).toBe(0);
        expect(second.assets[0].sourceSha256).not.toBe(first.assets[0].sourceSha256);
        expect(second.assets[0].sha256).toBe(first.assets[0].sha256);
        const rejected = await preparePrintAssets(
          { ...ctx, tenantId: crypto.randomUUID() },
          [url],
          storage,
        );
        expect(rejected.assets).toEqual([]);
        expect(rejected.problems.get(url)).toBe('image_unavailable');
      } finally {
        await db.delete(uploadsTable).where(eq(uploadsTable.id, id));
      }
    });
  } finally {
    await shutdownDb();
  }
});

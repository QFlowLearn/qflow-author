import { db, type QflowDatabase } from '../db.ts';
import { and, eq, inArray } from 'drizzle-orm';
import type { RequestContext } from '../tenants.ts';
import { bankReleasePreparations, bankReleases } from '../db/bank_release_schema.ts';
import { questionRevisions } from '../db/question_schema.ts';
import { uploadsTable } from '../db/workspace_schema.ts';
import {
  digest,
  parseReleaseManifest,
  positive,
  releaseManifestDigest,
  type ReleaseResult,
  uuid,
} from '../banks/bank_release.ts';
import { collectPackageAssets } from '../package_export.ts';
import { uploadIdFromUrl } from '../uploads.ts';
import { validateQtiXml } from '../qti_validate.ts';
import { type ObjectStorage, StorageObjectNotFoundError } from '../storage_contract.ts';
import { sha256Hex } from '../sha256.ts';
import { writeZip } from '../zip.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { lockWorkspaceAndRequireAuthority } from './workspace_authorization.ts';
import { recordReleaseEvent } from './bank_releases.ts';

/** Persist the reservation before retaining bytes. No network work occurs inside a SQL transaction. */
export async function prepareBankRelease(
  ctx: RequestContext,
  input: {
    readonly releaseId: string;
    readonly version: number;
    readonly digest: string;
    readonly preparationId: string;
  },
  { storage, database = db, now = () => new Date() }: {
    readonly storage: ObjectStorage;
    readonly database?: QflowDatabase;
    readonly now?: () => Date;
  },
): Promise<ReleaseResult<string>> {
  const deps = { storage, database, now };
  if (
    !uuid(input.releaseId) || !uuid(input.preparationId) || !positive(input.version) ||
    !digest(input.digest)
  ) return { ok: false, code: 'invalid_input' };
  const reserved = await deps.database.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { grant: 'publication' })) {
      return { ok: false as const, code: 'forbidden' as const };
    }
    const [row] = await tx.select().from(bankReleases).where(
      and(eq(bankReleases.id, input.releaseId), eq(bankReleases.tenantId, ctx.tenantId)),
    ).for('update');
    if (!row) return { ok: false as const, code: 'not_found' as const };
    const [existing] = await tx.select().from(bankReleasePreparations).where(
      eq(bankReleasePreparations.id, input.preparationId),
    );
    if (
      existing &&
      (existing.tenantId !== ctx.tenantId || existing.releaseId !== row.id ||
        existing.baseDigest !== input.digest)
    ) return { ok: false as const, code: 'preparation_conflict' as const };
    const manifest = parseReleaseManifest(row.manifest);
    if (
      existing && ['ready', 'adopted'].includes(existing.state) &&
      manifest.preparation?.id === existing.id
    ) return { ok: true as const, value: { complete: true as const } };
    if (row.state !== 'draft') return { ok: false as const, code: 'frozen' as const };
    if (row.digest !== input.digest || row.version !== input.version) {
      return { ok: false as const, code: 'stale_preview' as const };
    }
    if (manifest.preparation) return { ok: false as const, code: 'preparation_conflict' as const };
    if (existing && existing.state !== 'reserved') {
      return { ok: false as const, code: 'preparation_conflict' as const };
    }
    const key = `bank-releases/${ctx.tenantId}/${row.id}/preparations/${input.preparationId}.zip`;
    if (!existing) {
      await tx.insert(bankReleasePreparations).values({
        id: input.preparationId,
        tenantId: ctx.tenantId,
        releaseId: row.id,
        baseDigest: row.digest,
        state: 'reserved',
        objectKey: key,
        createdAt: deps.now(),
      });
    }
    return { ok: true as const, value: { complete: false as const, manifest, key } };
  });
  if (!reserved.ok) return reserved;
  if (reserved.value.complete) return { ok: true, value: input.releaseId };
  const { manifest, key } = reserved.value;
  let bytes: Uint8Array;
  try {
    const rows = await deps.database.select().from(questionRevisions).where(
      and(
        eq(questionRevisions.tenantId, ctx.tenantId),
        inArray(
          questionRevisions.id,
          manifest.items.map((item) => item.revisionId),
        ),
      ),
    );
    if (rows.length !== manifest.items.length) return { ok: false, code: 'technical_blocker' };
    const xml: Record<string, string> = {};
    for (const item of manifest.items) {
      const revision = rows.find((row) =>
        row.id === item.revisionId && row.questionId === item.questionId
      );
      if (!revision || !(await validateQtiXml(revision.qtiXml)).ok) {
        return { ok: false, code: 'technical_blocker' };
      }
      xml[item.revisionId] = revision.qtiXml;
    }
    const collected = await collectPackageAssets({ _tag: 'Items', itemsXml: xml }, {
      getUploadId: uploadIdFromUrl,
      getUpload: async (id) => {
        const [upload] = await deps.database.select().from(uploadsTable).where(
          and(eq(uploadsTable.id, id), eq(uploadsTable.tenantId, ctx.tenantId)),
        );
        return upload ? { ...upload, type: upload.mimeType } : null;
      },
      readUploadFile: (upload) => deps.storage.readObject(upload.path),
    });
    if (!collected.ok) {
      const unavailable = collected.error.reason === 'upload_unavailable' &&
        !(collected.error.cause instanceof StorageObjectNotFoundError);
      return { ok: false, code: unavailable ? 'storage_failed' : 'technical_blocker' };
    }
    const assets = collected.value;
    const date = new Date('2000-01-01T00:00:00.000Z');
    bytes = await writeZip([
      {
        name: 'selection.json',
        data: new TextEncoder().encode(canonicalJsonStringify(manifest)),
        date,
      },
      ...Object.entries(assets.rewrittenXml).map(([id, xml]) => ({
        name: `items/${id}.xml`,
        data: new TextEncoder().encode(xml),
        date,
      })),
      ...assets.assets.map((asset) => ({ name: `assets/${asset.name}`, data: asset.data, date })),
    ]);
    await deps.storage.putObject({
      key,
      data: bytes,
      contentType: 'application/zip',
      immutableIdentity: { sha256: await sha256Hex(bytes) },
    });
  } catch (cause: unknown) {
    if (cause instanceof StorageObjectNotFoundError) {
      return { ok: false, code: 'technical_blocker' };
    }
    return { ok: false, code: 'storage_failed' };
  }
  const sha256 = await sha256Hex(bytes);
  const finalized = await deps.database.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { grant: 'publication' })) {
      return { ok: false as const, code: 'forbidden' as const };
    }
    const [row] = await tx.select().from(bankReleases).where(
      and(eq(bankReleases.id, input.releaseId), eq(bankReleases.tenantId, ctx.tenantId)),
    ).for('update');
    const [prep] = await tx.select().from(bankReleasePreparations).where(
      eq(bankReleasePreparations.id, input.preparationId),
    ).for('update');
    if (!row || !prep) throw new Error('Reserved preparation is missing.');
    const current = parseReleaseManifest(row.manifest);
    if (['ready', 'adopted'].includes(prep.state) && current.preparation?.id === prep.id) {
      return { ok: true as const, value: row.id };
    }
    if (prep.state !== 'reserved') {
      return { ok: false as const, code: 'preparation_conflict' as const };
    }
    if (row.digest !== input.digest || row.version !== input.version || row.state !== 'draft') {
      return { ok: false as const, code: 'stale_preview' as const };
    }
    const next = {
      ...manifest,
      preparation: { id: prep.id, sha256, byteLength: bytes.byteLength },
    };
    await tx.update(bankReleasePreparations).set({
      state: 'ready',
      sha256,
      byteLength: bytes.byteLength,
    }).where(eq(bankReleasePreparations.id, prep.id));
    await tx.update(bankReleases).set({
      manifest: next,
      digest: await releaseManifestDigest(next),
      version: row.version + 1,
    }).where(eq(bankReleases.id, row.id));
    return { ok: true as const, value: row.id };
  });
  if (!finalized.ok) {
    // A cleanup claim wins permanently. If this writer finished late, remove its now-unadoptable object.
    const [prep] = await deps.database.select().from(bankReleasePreparations).where(
      eq(bankReleasePreparations.id, input.preparationId),
    );
    if (prep && ['deleting', 'deleted'].includes(prep.state)) await deps.storage.deleteObject(key);
  }
  return finalized;
}

/** Claim cleanup under the adoption lock. Reservation keys are exclusive, never shared assets. */
export async function cleanupReleasePreparation(
  ctx: RequestContext,
  preparationId: string,
  { storage, database = db, now = () => new Date() }: {
    readonly storage: ObjectStorage;
    readonly database?: QflowDatabase;
    readonly now?: () => Date;
  },
): Promise<ReleaseResult<null>> {
  const deps = { storage, database, now };
  if (!uuid(preparationId)) return { ok: false, code: 'invalid_input' };
  const claimed = await deps.database.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { grant: 'publication' })) {
      return { ok: false as const, code: 'forbidden' as const };
    }
    const [prep] = await tx.select().from(bankReleasePreparations).where(
      and(
        eq(bankReleasePreparations.id, preparationId),
        eq(bankReleasePreparations.tenantId, ctx.tenantId),
      ),
    ).for('update');
    if (!prep) return { ok: false as const, code: 'not_found' as const };
    if (prep.state === 'adopted') return { ok: false as const, code: 'frozen' as const };
    const [release] = await tx.select().from(bankReleases).where(
      eq(bankReleases.id, prep.releaseId),
    );
    if (release && parseReleaseManifest(release.manifest).preparation?.id === prep.id) {
      return { ok: false as const, code: 'preparation_conflict' as const };
    }
    await tx.update(bankReleasePreparations).set({ state: 'deleting' }).where(
      eq(bankReleasePreparations.id, prep.id),
    );
    return { ok: true as const, value: prep };
  });
  if (!claimed.ok) return claimed;
  try {
    await deps.storage.deleteObject(claimed.value.objectKey);
  } catch {
    return { ok: false, code: 'storage_failed' };
  }
  await deps.database.update(bankReleasePreparations).set({ state: 'deleted' }).where(
    and(
      eq(bankReleasePreparations.id, preparationId),
      eq(bankReleasePreparations.state, 'deleting'),
    ),
  );
  return { ok: true, value: null };
}

/** Retrieve retained source bytes, then reauthorize immediately before returning them. This is not an LMS package. */
export async function downloadReleaseSource(
  ctx: RequestContext,
  releaseId: string,
  operationId: string,
  { storage, database = db, now = () => new Date() }: {
    readonly storage: ObjectStorage;
    readonly database?: QflowDatabase;
    readonly now?: () => Date;
  },
): Promise<ReleaseResult<{ readonly bytes: Uint8Array; readonly sha256: string }>> {
  const deps = { storage, database, now };
  if (!uuid(releaseId) || !uuid(operationId)) return { ok: false, code: 'invalid_input' };
  const authorize = () =>
    deps.database.transaction(async (tx) => {
      if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { grant: 'publication' })) {
        return { ok: false as const, code: 'forbidden' as const };
      }
      const [row] = await tx.select().from(bankReleases).where(
        and(eq(bankReleases.id, releaseId), eq(bankReleases.tenantId, ctx.tenantId)),
      );
      if (!row) {
        return { ok: false as const, code: 'not_found' as const };
      }
      if (row.state !== 'frozen') return { ok: false as const, code: 'not_frozen' as const };
      if (row.distribution === 'withdrawn') {
        return {
          ok: false as const,
          code: 'withdrawn' as const,
        };
      }
      const manifest = parseReleaseManifest(row.manifest);
      if (!manifest.preparation) throw new Error('Frozen source identity is missing.');
      const [prep] = await tx.select().from(bankReleasePreparations).where(
        and(
          eq(bankReleasePreparations.id, manifest.preparation.id),
          eq(bankReleasePreparations.state, 'adopted'),
        ),
      );
      if (!prep || prep.sha256 !== manifest.preparation.sha256) {
        throw new Error(
          'Frozen source reservation is missing.',
        );
      }
      return { ok: true as const, value: { prep, manifest } };
    });
  const first = await authorize();
  if (!first.ok) return first;
  let bytes: Uint8Array;
  try {
    bytes = await deps.storage.readObject(first.value.prep.objectKey);
  } catch {
    return { ok: false, code: 'storage_failed' };
  }
  const sha256 = await sha256Hex(bytes);
  if (sha256 !== first.value.prep.sha256 || bytes.byteLength !== first.value.prep.byteLength) {
    return { ok: false, code: 'storage_failed' };
  }
  const last = await deps.database.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { grant: 'publication' })) {
      return { ok: false as const, code: 'forbidden' as const };
    }
    const [row] = await tx.select().from(bankReleases).where(
      and(eq(bankReleases.id, releaseId), eq(bankReleases.tenantId, ctx.tenantId)),
    );
    if (row?.distribution !== 'available') {
      return { ok: false as const, code: 'withdrawn' as const };
    }
    await recordReleaseEvent(
      tx,
      ctx,
      releaseId,
      operationId,
      { action: 'download_source', sha256 },
      deps.now(),
    );
    return { ok: true as const, value: { bytes, sha256 } };
  });
  return last;
}

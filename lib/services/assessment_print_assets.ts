import type { RequestContext } from '../tenants.ts';
import { getUpload } from '../uploads.ts';
import { isCanonicalUuid } from '../uuid.ts';
import type { ObjectStorage } from '../storage_contract.ts';
import {
  preparePrintImage,
  PRINT_IMAGE_MAX_BYTES,
  PRINT_IMAGE_MAX_PIXELS,
  type PrintImage,
} from '../print/print_image.ts';
import { sha256Hex } from '../sha256.ts';
import type { PrintAsset } from '../print/print_snapshot.ts';

/** Authorized source bytes and one explicit metadata-free derivative, before retention. */
export type PreparedPrintAsset = {
  readonly reference: string;
  readonly original: Uint8Array;
  readonly sourceSha256: string;
  readonly sha256: string;
  readonly image: PrintImage;
};

/** Resolve only owned uploads or embedded bytes from an already authorized immutable revision. */
export async function preparePrintAssets(
  ctx: RequestContext,
  references: readonly string[],
  storage: ObjectStorage,
): Promise<{
  readonly assets: readonly PreparedPrintAsset[];
  readonly problems: ReadonlyMap<string, string>;
}> {
  const assets: PreparedPrintAsset[] = [], problems = new Map<string, string>();
  let pixels = 0, bytes = 0;
  for (const reference of references) {
    let original: Uint8Array;
    try {
      const embedded = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(reference);
      if (embedded) {
        if (embedded[1].length > Math.ceil(PRINT_IMAGE_MAX_BYTES * 4 / 3) + 4) {
          problems.set(reference, 'image_limit');
          continue;
        }
        original = Uint8Array.from(atob(embedded[1]), (character) => character.charCodeAt(0));
      } else {
        const match = /\/uploads\/([0-9a-f-]{36})$/i.exec(reference);
        if (!match || !isCanonicalUuid(match[1])) {
          problems.set(reference, 'image_unavailable');
          continue;
        }
        const upload = await getUpload(ctx, match[1]);
        if (
          upload.status !== 'ok' || upload.upload.url !== reference ||
          upload.upload.size > PRINT_IMAGE_MAX_BYTES
        ) {
          problems.set(reference, 'image_unavailable');
          continue;
        }
        original = await readPrintAssetBytes(storage, upload.upload.path, PRINT_IMAGE_MAX_BYTES);
      }
    } catch {
      problems.set(reference, 'image_unavailable');
      continue;
    }
    const image = preparePrintImage(original);
    if (!image.ok) {
      problems.set(reference, image.code);
      continue;
    }
    pixels += image.value.width * image.value.height;
    bytes += image.value.bytes.length;
    if (assets.length >= 8 || pixels > PRINT_IMAGE_MAX_PIXELS || bytes > PRINT_IMAGE_MAX_BYTES) {
      problems.set(reference, 'image_limit');
      continue;
    }
    assets.push({
      reference,
      original,
      sourceSha256: await sha256Hex(original),
      sha256: await sha256Hex(image.value.bytes),
      image: image.value,
    });
  }
  return { assets, problems };
}

/** Retain original and derivative bytes under separate immutable identities. */
export async function retainPrintAssets(
  ctx: RequestContext,
  packId: string,
  assets: readonly PreparedPrintAsset[],
  storage: ObjectStorage,
): Promise<readonly PrintAsset[] | null> {
  const retained: PrintAsset[] = [];
  try {
    for (const asset of assets) {
      const prefix = `print/${ctx.tenantId}/${packId}/assets/`;
      const sourceKey = `${prefix}source-${asset.sourceSha256}`,
        key = `${prefix}image-${asset.sha256}`;
      await storage.putObject({
        key: sourceKey,
        data: asset.original,
        contentType: 'application/octet-stream',
        immutableIdentity: { sha256: asset.sourceSha256 },
      });
      await storage.putObject({
        key,
        data: asset.image.bytes,
        contentType: asset.image.mediaType,
        immutableIdentity: { sha256: asset.sha256 },
      });
      retained.push({
        reference: asset.reference,
        sourceKey,
        sourceSha256: asset.sourceSha256,
        key,
        sha256: asset.sha256,
        mediaType: asset.image.mediaType,
        byteLength: asset.image.bytes.length,
        width: asset.image.width,
        height: asset.image.height,
      });
    }
    return retained;
  } catch {
    return null;
  }
}

/** Reject oversized advertised bodies and cancel if actual streamed bytes exceed the bounded input. */
export async function readPrintAssetBytes(
  storage: ObjectStorage,
  key: string,
  maximum: number,
): Promise<Uint8Array> {
  const object = await storage.readObjectStream(key);
  if (object.contentLength > maximum) {
    await object.body.cancel();
    throw Error('Print image exceeds the supported limit.');
  }
  const reader = object.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > maximum) {
        await reader.cancel();
        throw Error('Print image exceeds the supported limit.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== object.contentLength) throw Error('Print image stream length does not match.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Inline compensation removes only objects belonging to this unconfirmed reservation. */
export async function cleanupPrintAssets(
  ctx: RequestContext,
  id: string,
  assets: readonly PrintAsset[],
  storage: ObjectStorage,
): Promise<void> {
  const prefix = `print/${ctx.tenantId}/${id}/assets/`;
  for (const asset of assets) {
    for (const key of [asset.sourceKey, asset.key]) {
      if (!key.startsWith(prefix)) throw Error('Print cleanup ownership mismatch.');
      await storage.deleteObject(key);
    }
  }
}

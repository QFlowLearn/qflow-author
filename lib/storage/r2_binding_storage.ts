import { assertObjectByteRange, readExactObjectRange } from './object_range.ts';
import {
  immutableContentSha256,
  type ObjectStorage,
  parseStorageObjectStream,
  StorageObjectIdentityConflictError,
  storageObjectMetadataMatches,
  StorageObjectNotFoundError,
} from '../storage_contract.ts';

const CONTENT_SHA256_METADATA_KEY = 'qflow-sha256';

/** Minimal Cloudflare R2 binding surface required by the storage adapter. */
export type R2BucketLike = {
  put(
    key: string,
    value: Uint8Array | ArrayBuffer | ReadableStream,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
      onlyIf?: { etagDoesNotMatch?: string };
      sha256?: string;
    },
  ): Promise<unknown | null>;
  get(
    key: string,
    options?: { range: { offset: number; length: number } },
  ): Promise<R2ObjectBodyLike | null>;
  delete(key: string): Promise<void>;
};

type R2ObjectBodyLike = {
  arrayBuffer(): Promise<ArrayBuffer>;
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly range?: { readonly offset?: number; readonly length?: number };
  readonly httpMetadata?: { readonly contentType?: string };
  readonly customMetadata?: Readonly<Record<string, string>>;
  readonly checksums?: { readonly sha256?: ArrayBuffer };
};

/** Creates object storage backed by a Cloudflare R2 Worker binding. */
export function createR2BindingStorage(bucket: R2BucketLike): ObjectStorage {
  return {
    async putObject(input) {
      const sha256 = immutableContentSha256(input);
      const written = await bucket.put(input.key, input.data, {
        httpMetadata: input.contentType ? { contentType: input.contentType } : undefined,
        customMetadata: sha256 ? { [CONTENT_SHA256_METADATA_KEY]: sha256 } : undefined,
        onlyIf: sha256 ? { etagDoesNotMatch: '*' } : undefined,
        sha256,
      });
      if (written !== null || !sha256) return;

      const existing = await bucket.get(input.key);
      if (!existing) throw new StorageObjectIdentityConflictError(input.key);
      const matches = storageObjectMetadataMatches(
        {
          contentLength: existing.size,
          contentType: existing.httpMetadata?.contentType ?? null,
          contentSha256: r2ObjectSha256(existing),
        },
        input,
      );
      await existing.body.cancel().catch(() => {});
      if (!matches) throw new StorageObjectIdentityConflictError(input.key);
    },
    async readObject(key) {
      const object = await bucket.get(key);
      if (!object) throw new StorageObjectNotFoundError(key);
      return new Uint8Array(await object.arrayBuffer());
    },
    async readObjectRange(key, offset, length) {
      assertObjectByteRange({ offset, length });
      const object = await bucket.get(key, { range: { offset, length } });
      if (!object) throw new StorageObjectNotFoundError(key);
      if (
        object.range?.offset !== offset || object.range?.length !== length ||
        object.size < offset + length
      ) {
        await object.body.cancel().catch(() => {});
        throw new Error('Object storage returned an incorrect byte range.');
      }
      return await readExactObjectRange(object.body, length);
    },
    async readObjectStream(key) {
      const object = await bucket.get(key);
      if (!object) throw new StorageObjectNotFoundError(key);
      return await parseStorageObjectStream({
        body: object.body,
        contentLength: object.size,
        contentType: object.httpMetadata?.contentType ?? null,
        contentSha256: r2ObjectSha256(object),
      });
    },
    async deleteObject(key) {
      await bucket.delete(key);
    },
  };
}

function r2ObjectSha256(object: R2ObjectBodyLike): string | null {
  const checksum = object.checksums?.sha256;
  return checksum
    ? toHex(new Uint8Array(checksum))
    : object.customMetadata?.[CONTENT_SHA256_METADATA_KEY] ?? null;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

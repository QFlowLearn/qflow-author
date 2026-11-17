import { assertObjectByteRange } from '../lib/storage/object_range.ts';
import type { ObjectStorage, StorageObjectStream } from '../lib/storage_contract.ts';
import { sha256Hex } from '../lib/sha256.ts';

type MemoryObject = {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly contentSha256: string | null;
};

/** Creates an isolated, metadata-preserving object-storage adapter for tests. */
export function createMemoryObjectStorage(): ObjectStorage {
  const objects = new Map<string, MemoryObject>();
  return {
    async putObject(input) {
      if (!input.contentType) throw new Error('Memory objects require a content type.');
      if (
        input.immutableIdentity &&
        await sha256Hex(input.data) !== input.immutableIdentity.sha256
      ) {
        throw new Error(`Immutable memory object checksum mismatch: ${input.key}`);
      }
      const existing = objects.get(input.key);
      if (existing && input.immutableIdentity) {
        if (
          existing.bytes.byteLength !== input.data.byteLength ||
          existing.contentType !== input.contentType ||
          existing.contentSha256 !== input.immutableIdentity.sha256
        ) throw new Error(`Immutable memory object identity conflict: ${input.key}`);
        return;
      }
      objects.set(input.key, {
        bytes: new Uint8Array(input.data),
        contentType: input.contentType,
        contentSha256: input.immutableIdentity?.sha256 ?? null,
      });
    },
    readObject(key) {
      const object = requireMemoryObject(objects, key);
      return Promise.resolve(new Uint8Array(object.bytes));
    },
    readObjectRange(key, offset, length) {
      assertObjectByteRange({ offset, length });
      const object = requireMemoryObject(objects, key);
      if (offset + length > object.bytes.length) throw new Error('Object range is truncated.');
      return Promise.resolve(object.bytes.slice(offset, offset + length));
    },
    readObjectStream(key) {
      const object = requireMemoryObject(objects, key);
      return Promise.resolve(storageObjectStreamFromBytes(
        new Uint8Array(object.bytes),
        object.contentType,
        object.contentSha256,
      ));
    },
    deleteObject(key) {
      objects.delete(key);
      return Promise.resolve();
    },
  };
}

function storageObjectStreamFromBytes(
  bytes: Uint8Array,
  contentType: string,
  contentSha256: string | null,
): StorageObjectStream {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    contentLength: bytes.byteLength,
    contentType,
    contentSha256,
  };
}

function requireMemoryObject(
  objects: ReadonlyMap<string, MemoryObject>,
  key: string,
): MemoryObject {
  const object = objects.get(key);
  if (!object) throw new Error(`Missing memory object: ${key}`);
  return object;
}

type PutStorageObjectBase = {
  readonly key: string;
  readonly data: Uint8Array;
};

/** Input for an ordinary replaceable object write or an immutable content-addressed write. */
export type PutStorageObjectInput =
  & PutStorageObjectBase
  & (
    | {
      readonly contentType?: string;
      readonly immutableIdentity?: undefined;
    }
    | {
      readonly contentType: string;
      readonly immutableIdentity: { readonly sha256: string };
    }
  );

/** Streaming object body plus immutable HTTP metadata required by download boundaries. */
export type StorageObjectStream = {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentLength: number;
  readonly contentType: string;
  readonly contentSha256: string | null;
};

/** Object-storage capability for callers that only write objects. */
export type ObjectWriter = {
  putObject(input: PutStorageObjectInput): Promise<void>;
};

/** Object-storage capability for callers that only read complete objects. */
export type ObjectReader = {
  readObject(key: string): Promise<Uint8Array>;
};

/** Random-access object reads used by archive processing. Each range is at most 8 MiB. */
export type ObjectRangeReader = {
  readObjectRange(key: string, offset: number, length: number): Promise<Uint8Array>;
};

/** Object-storage capability for callers that stream object responses. */
export type ObjectStreamReader = {
  readObjectStream(key: string): Promise<StorageObjectStream>;
};

/** Object-storage capability for callers that remove objects. */
export type ObjectDeleter = {
  deleteObject(key: string): Promise<void>;
};

/** Object-storage capabilities required for a compensatable write. */
export type ObjectWriteLifecycle = ObjectWriter & ObjectDeleter;

/** Object-storage capabilities needed to transform one stored object into another. */
export type ObjectReadWriter = ObjectReader & ObjectWriter;

/** Complete storage adapter installed at the runtime composition seam. */
export type ObjectStorage =
  & ObjectWriteLifecycle
  & ObjectReader
  & ObjectStreamReader
  & ObjectRangeReader;

/** Signals that a requested storage key does not exist. */
export class StorageObjectNotFoundError extends Error {
  readonly _tag = 'StorageObjectNotFoundError' as const;

  constructor(readonly key: string) {
    super(`Storage object not found: ${key}`);
    this.name = 'StorageObjectNotFoundError';
  }
}

/** Signals that an immutable object key already belongs to different content. */
export class StorageObjectIdentityConflictError extends Error {
  readonly _tag = 'StorageObjectIdentityConflictError' as const;

  constructor(readonly key: string) {
    super(`Immutable storage object identity conflict: ${key}`);
    this.name = 'StorageObjectIdentityConflictError';
  }
}

/** Validates immutable metadata and cancels an opened body when that metadata is invalid. */
export async function parseStorageObjectStream(input: {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly contentLength: number | string | null;
  readonly contentType: string | null;
  readonly contentSha256: string | null;
}): Promise<StorageObjectStream> {
  if (!input.body) {
    throw new Error('Storage object is missing required streaming metadata.');
  }
  try {
    return { body: input.body, ...parseStorageObjectMetadata(input) };
  } catch (cause: unknown) {
    await input.body.cancel().catch(() => {});
    throw cause;
  }
}

/** Validates a caller-provided immutable content identity. */
export function immutableContentSha256(input: PutStorageObjectInput): string | undefined {
  const sha256 = input.immutableIdentity?.sha256;
  if (sha256 === undefined) return undefined;
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error('Immutable storage object SHA-256 is invalid.');
  }
  return sha256;
}

/** Compares stored metadata with the immutable identity asserted by a write. */
export function storageObjectMetadataMatches(
  metadata: {
    readonly contentLength: number | string | null;
    readonly contentType: string | null;
    readonly contentSha256: string | null;
  },
  input: PutStorageObjectInput,
): boolean {
  if (!input.immutableIdentity) return false;
  try {
    const parsed = parseStorageObjectMetadata(metadata);
    return parsed.contentLength === input.data.byteLength &&
      parsed.contentType === input.contentType &&
      parsed.contentSha256 === input.immutableIdentity.sha256;
  } catch (_cause: unknown) {
    return false;
  }
}

function parseStorageObjectMetadata(input: {
  readonly contentLength: number | string | null;
  readonly contentType: string | null;
  readonly contentSha256: string | null;
}): Omit<StorageObjectStream, 'body'> {
  const contentLength = typeof input.contentLength === 'string'
    ? (/^\d+$/.test(input.contentLength) ? Number(input.contentLength) : Number.NaN)
    : input.contentLength;
  const contentType = input.contentType?.trim() ?? '';
  const contentSha256 = input.contentSha256?.trim().toLowerCase() ?? null;
  if (
    typeof contentLength !== 'number' ||
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentType.length === 0 ||
    (contentSha256 !== null && !/^[0-9a-f]{64}$/.test(contentSha256))
  ) {
    throw new Error('Storage object is missing required streaming metadata.');
  }
  return { contentLength, contentType, contentSha256 };
}

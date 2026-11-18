import { type Entry, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

/** Supported in-memory projections for an extracted ZIP entry. */
export type ZipArchiveDataType = 'string' | 'uint8array';
const ZIP_ARCHIVE_OPTIONS = { useWebWorkers: false } as const;
const ZIP_MAGIC = [0x50, 0x4b] as const;

/** Return whether bytes start with a ZIP local-file signature. */
export function isZipArchive(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1];
}

/** Resource limits applied while ZIP central-directory entries are read. */
export type ZipArchiveReadLimits = {
  readonly maxCompressedBytes: number;
  readonly maxEntries: number;
  readonly maxTotalUncompressedBytes: number;
};

/** Stable reasons a ZIP archive can exceed its configured read budget. */
export type ZipArchiveLimitCode = 'compressed_size' | 'entry_count' | 'uncompressed_size';

/** Signals that ZIP metadata exceeds a configured resource budget. */
export class ZipArchiveLimitError extends Error {
  readonly _tag = 'ZipArchiveLimitError' as const;

  constructor(
    readonly code: ZipArchiveLimitCode,
    readonly limit: number,
  ) {
    super(`ZIP archive exceeds its ${code.replaceAll('_', ' ')} limit.`);
    this.name = 'ZipArchiveLimitError';
  }
}

/** One file or directory listed in a ZIP archive. */
class ZipArchiveEntry {
  readonly name: string;
  readonly dir: boolean;
  readonly #entry: Entry;
  readonly #reserveExtractedBytes?: (byteLength: number) => void;

  /** Wrap one ZIP reader entry. */
  constructor(entry: Entry, reserveExtractedBytes?: (byteLength: number) => void) {
    this.#entry = entry;
    this.#reserveExtractedBytes = reserveExtractedBytes;
    this.name = entry.filename;
    this.dir = entry.directory;
  }

  /** Extract this entry as text or bytes. */
  async async(type: 'string'): Promise<string>;
  async async(type: 'uint8array'): Promise<Uint8Array>;
  async async(type: ZipArchiveDataType): Promise<string | Uint8Array> {
    if (this.#entry.directory) {
      throw new Error(`Cannot read directory entry ${this.name}`);
    }
    if (!this.#reserveExtractedBytes) {
      const data = await this.#entry.getData(new Uint8ArrayWriter(), ZIP_ARCHIVE_OPTIONS);
      return type === 'string' ? new TextDecoder().decode(data) : data;
    }

    const writer = new BudgetedUint8ArrayWriter(this.#reserveExtractedBytes);
    try {
      const data = await this.#entry.getData(writer, ZIP_ARCHIVE_OPTIONS);
      return type === 'string' ? new TextDecoder().decode(data) : data;
    } catch (cause: unknown) {
      if (writer.failure) throw writer.failure.cause;
      throw cause;
    }
  }

  /** Decompress and validate this entry without retaining its content. */
  async verify(onChunk?: (byteLength: number) => void): Promise<void> {
    if (this.#entry.directory) return;
    await this.#entry.getData(
      new WritableStream<Uint8Array>({
        write(chunk) {
          onChunk?.(chunk.byteLength);
        },
      }),
      ZIP_ARCHIVE_OPTIONS,
    );
  }
}

/** In-memory ZIP reader with normalized path lookup. */
export class ZipArchive {
  readonly files: Record<string, ZipArchiveEntry>;
  readonly #entries: ZipArchiveEntry[];
  readonly #entriesByNormalizedPath: Map<string, ZipArchiveEntry>;
  readonly #limits?: ZipArchiveReadLimits;
  readonly #reader: ZipReader<Uint8Array>;

  private constructor(
    reader: ZipReader<Uint8Array>,
    rawEntries: Entry[],
    limits?: ZipArchiveReadLimits,
  ) {
    this.#reader = reader;
    this.#limits = limits;
    let extractedBytes = 0;
    const reserveExtractedBytes = limits
      ? (byteLength: number): void => {
        extractedBytes += byteLength;
        if (
          !Number.isSafeInteger(extractedBytes) ||
          extractedBytes > limits.maxTotalUncompressedBytes
        ) {
          throw new ZipArchiveLimitError(
            'uncompressed_size',
            limits.maxTotalUncompressedBytes,
          );
        }
      }
      : undefined;
    this.#entries = rawEntries.map((entry) => new ZipArchiveEntry(entry, reserveExtractedBytes));
    const entries = this.#entries;
    this.files = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
    this.#entriesByNormalizedPath = new Map<string, ZipArchiveEntry>();
    for (const entry of entries) {
      const normalized = normalizeArchivePath(entry.name);
      if (!normalized || this.#entriesByNormalizedPath.has(normalized)) continue;
      this.#entriesByNormalizedPath.set(normalized, entry);
    }
  }

  /** Open a ZIP archive and optionally enforce metadata budgets before returning it. */
  static async open(
    bytes: Uint8Array,
    limits?: ZipArchiveReadLimits,
  ): Promise<ZipArchive> {
    if (limits) {
      assertReadLimits(limits);
      if (bytes.byteLength > limits.maxCompressedBytes) {
        throw new ZipArchiveLimitError('compressed_size', limits.maxCompressedBytes);
      }
    }
    const reader = new ZipReader(new Uint8ArrayReader(bytes), ZIP_ARCHIVE_OPTIONS);
    let totalUncompressedBytes = 0;
    try {
      const entries: Entry[] = [];
      for await (const entry of reader.getEntriesGenerator()) {
        if (limits) {
          if (entries.length >= limits.maxEntries) {
            throw new ZipArchiveLimitError('entry_count', limits.maxEntries);
          }
          if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
            throw new Error('ZIP entry has an invalid uncompressed size.');
          }
          totalUncompressedBytes += entry.uncompressedSize;
          if (
            !Number.isSafeInteger(totalUncompressedBytes) ||
            totalUncompressedBytes > limits.maxTotalUncompressedBytes
          ) {
            throw new ZipArchiveLimitError(
              'uncompressed_size',
              limits.maxTotalUncompressedBytes,
            );
          }
        }
        entries.push(entry);
      }
      return new ZipArchive(reader, entries, limits);
    } catch (cause: unknown) {
      try {
        await reader.close();
      } catch {
        // The original open failure owns this error path.
      }
      throw cause;
    }
  }

  /** Find one normalized path or every entry that matches a regular expression. */
  file(path: string): ZipArchiveEntry | null;
  file(pattern: RegExp): ZipArchiveEntry[];
  file(pathOrPattern: string | RegExp): ZipArchiveEntry | ZipArchiveEntry[] | null {
    if (typeof pathOrPattern === 'string') {
      const exact = this.files[pathOrPattern];
      if (exact) return exact;
      const normalized = normalizeArchivePath(pathOrPattern);
      if (!normalized) return null;
      return this.#entriesByNormalizedPath.get(normalized) ?? null;
    }

    return this.#entries.filter((entry) => matchesPattern(entry.name, pathOrPattern));
  }

  /** Release the underlying ZIP reader. */
  async close(): Promise<void> {
    await this.#reader.close();
  }

  /** Verify every file entry sequentially and enforce actual expanded bytes. */
  async verify(): Promise<void> {
    let totalUncompressedBytes = 0;
    for (const entry of this.#entries) {
      let limitFailure: ZipArchiveLimitError | null = null;
      try {
        await entry.verify((byteLength) => {
          totalUncompressedBytes += byteLength;
          if (
            this.#limits &&
            (!Number.isSafeInteger(totalUncompressedBytes) ||
              totalUncompressedBytes > this.#limits.maxTotalUncompressedBytes)
          ) {
            limitFailure = new ZipArchiveLimitError(
              'uncompressed_size',
              this.#limits.maxTotalUncompressedBytes,
            );
            throw limitFailure;
          }
        });
      } catch (cause: unknown) {
        if (limitFailure) throw limitFailure;
        throw cause;
      }
    }
  }
}

/** Open one archive for an operation and always release its reader. */
export async function withZipArchive<T>(
  bytes: Uint8Array,
  limits: ZipArchiveReadLimits | undefined,
  operation: (archive: ZipArchive) => Promise<T>,
): Promise<T> {
  const archive = await ZipArchive.open(bytes, limits);
  let outcome:
    | { readonly _tag: 'success'; readonly value: T }
    | { readonly _tag: 'failure'; readonly cause: unknown };
  try {
    outcome = { _tag: 'success', value: await operation(archive) };
  } catch (cause: unknown) {
    outcome = { _tag: 'failure', cause };
  }

  let closeFailure: { readonly cause: unknown } | null = null;
  try {
    await archive.close();
  } catch (cause: unknown) {
    closeFailure = { cause };
  }

  if (outcome._tag === 'failure') throw outcome.cause;
  if (closeFailure) throw closeFailure.cause;
  return outcome.value;
}

class BudgetedUint8ArrayWriter extends Uint8ArrayWriter {
  readonly #reserveBytes: (byteLength: number) => void;
  failure: { readonly cause: unknown } | null = null;

  constructor(reserveBytes: (byteLength: number) => void) {
    super();
    this.#reserveBytes = reserveBytes;
  }

  override writeUint8Array(chunk: Uint8Array): Promise<void> {
    try {
      this.#reserveBytes(chunk.byteLength);
      return super.writeUint8Array(chunk);
    } catch (cause: unknown) {
      this.failure = { cause };
      return Promise.reject(
        cause instanceof Error ? cause : new Error('ZIP write failed.', { cause }),
      );
    }
  }
}

function assertReadLimits(limits: ZipArchiveReadLimits): void {
  if (!Number.isSafeInteger(limits.maxCompressedBytes) || limits.maxCompressedBytes <= 0) {
    throw new Error('ZIP maxCompressedBytes must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(limits.maxEntries) || limits.maxEntries <= 0) {
    throw new Error('ZIP maxEntries must be a positive safe integer.');
  }
  if (
    !Number.isSafeInteger(limits.maxTotalUncompressedBytes) ||
    limits.maxTotalUncompressedBytes <= 0
  ) {
    throw new Error('ZIP maxTotalUncompressedBytes must be a positive safe integer.');
  }
}

function matchesPattern(value: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function normalizeArchivePath(value: string): string {
  const raw = value.trim().replace(/\\/g, '/');
  if (!raw) return '';
  const stripped = raw.replace(/^\.\//, '');
  const parts: string[] = [];
  for (const segment of stripped.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join('/');
}

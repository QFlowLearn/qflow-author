import {
  formatSourceByteLimit,
  MAX_SOURCE_ARCHIVE_ENTRIES,
  MAX_SOURCE_ARCHIVE_EXPANDED_BYTES,
  MAX_SOURCE_FILE_BYTES,
} from '../source_intake/policy.ts';
import {
  isZipArchive,
  withZipArchive,
  type ZipArchive,
  ZipArchiveLimitError,
  type ZipArchiveReadLimits,
} from '../zip_archive.ts';
import type { ImportSource } from './types.ts';

/** Archive limits for adapters that collect their extracted content in memory. */
const IMPORT_ARCHIVE_READ_LIMITS: ZipArchiveReadLimits = {
  maxCompressedBytes: MAX_SOURCE_FILE_BYTES,
  maxEntries: MAX_SOURCE_ARCHIVE_ENTRIES,
  maxTotalUncompressedBytes: MAX_SOURCE_ARCHIVE_EXPANDED_BYTES,
};

/** Stable reasons a recovery archive can violate the import resource policy. */
export type ImportArchivePolicyCode =
  | 'compressed_size'
  | 'entry_count'
  | 'invalid_archive'
  | 'uncompressed_size';

/** A user-correctable archive rejection raised before any import adapter starts. */
export class ImportArchivePolicyError extends Error {
  readonly _tag = 'ImportArchivePolicyError' as const;

  constructor(readonly code: ImportArchivePolicyCode) {
    super(importArchivePolicyMessage(code));
    this.name = 'ImportArchivePolicyError';
  }
}

/** Enforce the collecting-adapter budget; native QTI uses its bounded stream policy. */
export async function assertImportArchivePolicy(source: ImportSource): Promise<void> {
  if (!isZipArchive(source.bytes)) return;
  try {
    await withImportArchive(source.bytes, (archive) => archive.verify());
  } catch (cause: unknown) {
    if (cause instanceof ZipArchiveLimitError) {
      throw new ImportArchivePolicyError(cause.code);
    }
    throw new ImportArchivePolicyError('invalid_archive');
  }
}

/** Run one import operation with canonical archive limits and deterministic cleanup. */
export function withImportArchive<T>(
  bytes: Uint8Array,
  operation: (archive: ZipArchive) => Promise<T>,
): Promise<T> {
  return withZipArchive(bytes, IMPORT_ARCHIVE_READ_LIMITS, operation);
}

function importArchivePolicyMessage(code: ImportArchivePolicyCode): string {
  switch (code) {
    case 'compressed_size':
      return `ZIP packages must be ${formatSourceByteLimit(MAX_SOURCE_FILE_BYTES)} or smaller.`;
    case 'entry_count':
      return `This ZIP package contains too many files or folders. Keep the package to ${MAX_SOURCE_ARCHIVE_ENTRIES.toLocaleString()} entries or fewer, then upload it again.`;
    case 'invalid_archive':
      return 'QFlowLearn cannot read this ZIP package. Export a new package, then upload it again.';
    case 'uncompressed_size':
      return `This ZIP package contains more than ${
        formatSourceByteLimit(MAX_SOURCE_ARCHIVE_EXPANDED_BYTES)
      } after extraction. Remove large assets, then upload it again.`;
  }
}

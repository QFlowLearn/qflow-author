/** Maximum number of files accepted in one source-intake command. */
export const MAX_SOURCE_FILES = 10;

/**
 * Maximum bytes accepted for any one recovery source.
 *
 * Multipart parsing and canonical byte conversion can retain two copies. This
 * cap leaves the 128 MB Cloudflare isolate room for the app and parser state.
 */
export const MAX_SOURCE_FILE_BYTES = 16 * 1024 * 1024;

/** Maximum aggregate bytes retained by one recovery intake request. */
export const MAX_SOURCE_BATCH_BYTES = 16 * 1024 * 1024;

/** Maximum number of files and directories read from one recovery archive. */
export const MAX_SOURCE_ARCHIVE_ENTRIES = 10_000;

/** Maximum aggregate extracted bytes retained by one recovery parser. */
export const MAX_SOURCE_ARCHIVE_EXPANDED_BYTES = 16 * 1024 * 1024;

/** Maximum multipart framing overhead accepted beyond the source payload. */
export const MAX_SOURCE_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/** Maximum raw bytes consumed from one source-intake request body. */
export const MAX_SOURCE_REQUEST_BYTES = MAX_SOURCE_BATCH_BYTES +
  MAX_SOURCE_MULTIPART_OVERHEAD_BYTES;

/** Maximum bytes accepted for one AI generation source. */
export const MAX_GENERATION_FILE_BYTES = 10 * 1024 * 1024;

/** Maximum characters accepted from the pasted-text input. */
export const MAX_SOURCE_TEXT_CHARS = 12_000;

/** Format one binary byte limit for concise user-facing copy. */
export function formatSourceByteLimit(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  if (!Number.isSafeInteger(megabytes) || megabytes <= 0) {
    throw new Error('Source byte limits must be positive whole megabytes.');
  }
  return `${megabytes} MB`;
}

/** Expanded budget for the sequential native QTI 3 parser. */
export const MAX_NATIVE_QTI_EXPANDED_BYTES = 64 * 1024 * 1024;
/** Maximum individual XML or asset read by the native parser. */
export const MAX_NATIVE_QTI_ENTRY_BYTES = 8 * 1024 * 1024;

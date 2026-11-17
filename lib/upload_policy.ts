import type { MediaKind } from './types/media.ts';

const MEBIBYTE = 1024 * 1024;

/**
 * Largest upload retained by the current in-memory pipeline.
 *
 * Multipart parsing, canonical byte inspection, and S3 request signing can temporarily retain
 * three representations, leaving the 128 MB Worker isolate room for parser and application state.
 */
export const MAX_UPLOAD_MEBIBYTES = 24;

/** Media categories accepted by the authoring upload boundary. */
export type UploadKind = 'image' | 'audio' | 'video' | 'pdf' | 'captions';

/** Canonical metadata derived from an uploaded file's bytes. */
export type InspectedUpload = {
  readonly kind: UploadKind;
  readonly mimeType: string;
};

/** Result of inspecting an upload at the HTTP boundary. */
export type UploadInspectionResult =
  | { readonly _tag: 'valid'; readonly upload: InspectedUpload }
  | {
    readonly _tag: 'invalid';
    readonly code: 'content_unsupported' | 'content_type_mismatch' | 'filename_extension_mismatch';
  };

type UploadPolicy = {
  readonly label: string;
  readonly maxBytes: number;
  readonly maxMebibytes: number;
};

/** Size and display policy for each accepted upload category. */
export const UPLOAD_POLICIES: Readonly<Record<UploadKind, UploadPolicy>> = {
  image: { label: 'Images', maxBytes: 8 * MEBIBYTE, maxMebibytes: 8 },
  captions: { label: 'Caption files', maxBytes: MEBIBYTE, maxMebibytes: 1 },
  pdf: { label: 'PDF documents', maxBytes: 20 * MEBIBYTE, maxMebibytes: 20 },
  audio: {
    label: 'Audio files',
    maxBytes: MAX_UPLOAD_MEBIBYTES * MEBIBYTE,
    maxMebibytes: MAX_UPLOAD_MEBIBYTES,
  },
  video: {
    label: 'Video files',
    maxBytes: MAX_UPLOAD_MEBIBYTES * MEBIBYTE,
    maxMebibytes: MAX_UPLOAD_MEBIBYTES,
  },
};

/** Absolute file-size limit used before upload bytes can be inspected safely. */
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MEBIBYTES * MEBIBYTE;

/** Maximum multipart framing overhead accepted beyond the upload payload. */
const MAX_UPLOAD_MULTIPART_OVERHEAD_BYTES = MEBIBYTE;

/** Maximum raw bytes consumed from one authoring upload request. */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_BYTES +
  MAX_UPLOAD_MULTIPART_OVERHEAD_BYTES;

const MIME_KIND: Readonly<Record<string, UploadKind>> = {
  'text/vtt': 'captions',
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  'image/bmp': 'image',
  'image/avif': 'image',
  'image/x-icon': 'image',
  'image/vnd.microsoft.icon': 'image',
  'audio/aac': 'audio',
  'audio/flac': 'audio',
  'audio/mp4': 'audio',
  'audio/mpeg': 'audio',
  'audio/ogg': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'video/mp4': 'video',
  'video/ogg': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
  'video/x-m4v': 'video',
};

const EXTENSION_KIND: Readonly<Record<string, UploadKind>> = {
  '.vtt': 'captions',
  '.aac': 'audio',
  '.avif': 'image',
  '.bmp': 'image',
  '.flac': 'audio',
  '.gif': 'image',
  '.ico': 'image',
  '.jpeg': 'image',
  '.jpg': 'image',
  '.m4a': 'audio',
  '.m4v': 'video',
  '.mov': 'video',
  '.mp3': 'audio',
  '.mp4': 'video',
  '.oga': 'audio',
  '.ogg': 'audio',
  '.ogv': 'video',
  '.pdf': 'pdf',
  '.png': 'image',
  '.svg': 'image',
  '.wav': 'audio',
  '.webm': 'video',
  '.webp': 'image',
};

/** Return the upload category suggested by a filename or browser MIME value. */
export function classifyUploadHint(name: string, mimeType?: string | null): UploadKind | null {
  const normalizedMime = normalizeMime(mimeType);
  const mimeKind = normalizedMime ? MIME_KIND[normalizedMime] : undefined;
  if (mimeKind) return mimeKind;
  return EXTENSION_KIND[fileExtension(name)] ?? null;
}

/** Return the categories an author may select for one QTI media kind. */
function acceptedUploadKinds(mediaKind: MediaKind): ReadonlySet<UploadKind> {
  if (mediaKind === 'video') return new Set(['video']);
  if (mediaKind === 'audio') return new Set(['audio']);
  return new Set(['image', 'pdf']);
}

export type UploadHintError =
  | { readonly code: 'wrong-kind'; readonly expected: 'image' | 'captions' | MediaKind }
  | { readonly code: 'empty' }
  | { readonly code: 'too-large'; readonly kind: UploadKind; readonly maxMebibytes: number };

export function validateUploadHintStructured(
  input: { readonly name: string; readonly type?: string | null; readonly size: number },
  expected: 'image' | 'captions' | MediaKind,
): UploadHintError | null {
  const kind = classifyUploadHint(input.name, input.type);
  const accepted = expected === 'image' || expected === 'captions'
    ? new Set<UploadKind>([expected])
    : acceptedUploadKinds(expected);
  if (!kind || !accepted.has(kind)) {
    return { code: 'wrong-kind', expected };
  }
  if (input.size === 0) return { code: 'empty' };
  const policy = UPLOAD_POLICIES[kind];
  return input.size > policy.maxBytes
    ? { code: 'too-large', kind, maxMebibytes: policy.maxMebibytes }
    : null;
}

/** Return the native file-picker accept value for one QTI media kind. */
export function uploadAcceptForMediaKind(mediaKind: MediaKind): string {
  if (mediaKind === 'video') return 'video/*';
  if (mediaKind === 'audio') return 'audio/*';
  return 'image/*,application/pdf';
}

/** Return the instructor-facing file label for one QTI media kind. */
export function uploadLabelForMediaKind(mediaKind: MediaKind): string {
  return mediaKind === 'object' ? 'image or PDF' : mediaKind;
}

/** Return concise size guidance for one QTI media kind. */
export function uploadLimitTextForMediaKind(mediaKind: MediaKind): string {
  if (mediaKind === 'object') return 'Images up to 8 MB; PDFs up to 20 MB.';
  return `Maximum file size: ${MAX_UPLOAD_MEBIBYTES} MB.`;
}

/** Validate browser-visible metadata for fast feedback before uploading. */
export function validateUploadHint(
  input: { readonly name: string; readonly type?: string | null; readonly size: number },
  mediaKind: MediaKind,
): string | null {
  const kind = classifyUploadHint(input.name, input.type);
  if (!kind || !acceptedUploadKinds(mediaKind).has(kind)) {
    return mediaKind === 'object'
      ? 'Choose an image or PDF document.'
      : mediaKind === 'audio'
      ? 'Choose an audio file.'
      : 'Choose a video file.';
  }
  if (input.size === 0) return 'Choose a file that is not empty.';
  const policy = UPLOAD_POLICIES[kind];
  if (input.size > policy.maxBytes) {
    return `${policy.label} must be ${policy.maxMebibytes} MB or smaller.`;
  }
  return null;
}

/** Inspect file bytes, reject conflicting metadata, and return canonical upload metadata. */
export function inspectUpload(
  bytes: Uint8Array,
  input: { readonly name: string; readonly claimedType?: string | null },
): UploadInspectionResult {
  const upload = inspectUploadBytes(bytes);
  if (!upload) {
    return {
      _tag: 'invalid',
      code: 'content_unsupported',
    };
  }

  const claimedKind = kindForClaimedMime(input.claimedType);
  if (claimedKind && claimedKind !== upload.kind) {
    return {
      _tag: 'invalid',
      code: 'content_type_mismatch',
    };
  }

  const extensionKind = EXTENSION_KIND[fileExtension(input.name)];
  if (extensionKind && extensionKind !== upload.kind) {
    return {
      _tag: 'invalid',
      code: 'filename_extension_mismatch',
    };
  }

  return { _tag: 'valid', upload };
}

function inspectUploadBytes(bytes: Uint8Array): InspectedUpload | null {
  if (looksLikeWebVtt(bytes)) {
    return { kind: 'captions', mimeType: 'text/vtt' };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mimeType: 'image/png' };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { kind: 'image', mimeType: 'image/jpeg' };
  }
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    return { kind: 'image', mimeType: 'image/gif' };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { kind: 'image', mimeType: 'image/webp' };
  }
  if (ascii(bytes, 0, 2) === 'BM') {
    return { kind: 'image', mimeType: 'image/bmp' };
  }
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) {
    return { kind: 'image', mimeType: 'image/x-icon' };
  }
  if (looksLikeSvg(bytes)) {
    return { kind: 'image', mimeType: 'image/svg+xml' };
  }
  if (ascii(bytes, 0, 5) === '%PDF-') {
    return { kind: 'pdf', mimeType: 'application/pdf' };
  }
  if (ascii(bytes, 0, 4) === 'fLaC') {
    return { kind: 'audio', mimeType: 'audio/flac' };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') {
    return { kind: 'audio', mimeType: 'audio/wav' };
  }
  if (ascii(bytes, 0, 3) === 'ID3' || looksLikeMp3Frame(bytes)) {
    return { kind: 'audio', mimeType: 'audio/mpeg' };
  }
  if (looksLikeAacFrame(bytes)) {
    return { kind: 'audio', mimeType: 'audio/aac' };
  }
  if (ascii(bytes, 0, 4) === 'OggS') {
    const header = ascii(bytes, 0, Math.min(bytes.length, 256)).toLowerCase();
    return header.includes('theora')
      ? { kind: 'video', mimeType: 'video/ogg' }
      : { kind: 'audio', mimeType: 'audio/ogg' };
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: 'video', mimeType: 'video/webm' };
  }
  return inspectIsoBaseMedia(bytes);
}

function inspectIsoBaseMedia(bytes: Uint8Array): InspectedUpload | null {
  if (ascii(bytes, 4, 4) !== 'ftyp') return null;
  const brands = ascii(bytes, 8, Math.min(bytes.length - 8, 40));
  if (brands.includes('avif') || brands.includes('avis')) {
    return { kind: 'image', mimeType: 'image/avif' };
  }
  if (brands.includes('M4A ') || brands.includes('M4B ')) {
    return { kind: 'audio', mimeType: 'audio/mp4' };
  }
  if (brands.includes('qt  ')) {
    return { kind: 'video', mimeType: 'video/quicktime' };
  }
  return { kind: 'video', mimeType: 'video/mp4' };
}

function kindForClaimedMime(value?: string | null): UploadKind | null {
  const mime = normalizeMime(value);
  if (!mime || mime === 'application/octet-stream') return null;
  if (MIME_KIND[mime]) return MIME_KIND[mime];
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

function normalizeMime(value?: string | null): string {
  return value?.split(';', 1)[0].trim().toLowerCase() ?? '';
}

function fileExtension(name: string): string {
  const normalized = name.trim().toLowerCase();
  const dot = normalized.lastIndexOf('.');
  return dot === -1 ? '' : normalized.slice(dot);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || length <= 0 || offset + length > bytes.length) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function looksLikeAacFrame(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
}

function looksLikeMp3Frame(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 &&
    !looksLikeAacFrame(bytes);
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  if (!bytes.length) return false;
  const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)))
    .replace(/^\uFEFF/, '')
    .trimStart()
    .replace(/^<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/^(?:<!--[\s\S]*?-->\s*)+/i, '');
  return /^<svg(?:\s|>)/i.test(prefix);
}

/** Recognize the UTF-8 WebVTT file envelope; cue interpretation belongs to the media player. */
function looksLikeWebVtt(bytes: Uint8Array): boolean {
  const offset = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  if (ascii(bytes, offset, 6) !== 'WEBVTT') return false;
  let headerEnd = offset + 6;
  if (bytes[headerEnd] === 32 || bytes[headerEnd] === 9) {
    while (headerEnd < bytes.length && bytes[headerEnd] !== 13 && bytes[headerEnd] !== 10) {
      headerEnd++;
    }
  }
  const afterHeader = afterWebVttLineEnd(bytes, headerEnd);
  if (afterHeader === null || afterWebVttLineEnd(bytes, afterHeader) === null) return false;
  if (bytes.includes(0)) return false;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    // Keep text allocation bounded before the HTTP handler applies the caption-specific size limit.
    const chunkSize = 64 * 1024;
    for (let start = 0; start < bytes.length; start += chunkSize) {
      const end = Math.min(start + chunkSize, bytes.length);
      decoder.decode(bytes.subarray(start, end), { stream: end < bytes.length });
    }
  } catch (cause: unknown) {
    if (cause instanceof TypeError) return false;
    throw cause;
  }
  return true;
}

function afterWebVttLineEnd(bytes: Uint8Array, offset: number): number | null {
  if (bytes[offset] === 13) return offset + (bytes[offset + 1] === 10 ? 2 : 1);
  return bytes[offset] === 10 ? offset + 1 : null;
}

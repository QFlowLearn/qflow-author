import { eq } from 'drizzle-orm';

import { getEnv } from './config.ts';
import { db } from './db.ts';
import { uploadsTable } from './db/schema.ts';
import { cleanupObjectKeys } from './object_storage_compensation.ts';
import type { ObjectWriteLifecycle, ObjectWriter } from './storage_contract.ts';
import type { RequestContext } from './tenants.ts';
import type { RuntimeSource } from './runtime.ts';

function sanitizeName(name: string): string {
  const segments = name.replaceAll('\\', '/').split('/');
  const trimmed = (segments[segments.length - 1] ?? '').trim();
  const safe = trimmed.replace(/[^A-Za-z0-9_.-]/g, '_');
  return safe || 'upload.bin';
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
};

function detectMime(name: string, provided?: string | null): string {
  const cleaned = provided?.trim();
  if (cleaned) return cleaned;
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot !== -1) {
    const ext = lower.slice(dot);
    if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  }
  return 'application/octet-stream';
}

export type StoredUpload = {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
  url: string;
  createdAt: string;
};

/** Transaction handle accepted by upload persistence operations. */
export type UploadTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type UploadLookupResult =
  | { status: 'ok'; upload: StoredUpload }
  | { status: 'not_found' }
  | { status: 'forbidden' };

/** Signals that an upload object remains after metadata persistence and compensation both failed. */
export class UploadCleanupRequiredError extends Error {
  readonly _tag = 'UploadCleanupRequiredError' as const;

  constructor(
    readonly uploadId: string,
    readonly objectKey: string,
    persistenceCause: unknown,
    readonly cleanupCause: unknown,
  ) {
    super('Upload metadata persistence and object cleanup both failed.', {
      cause: persistenceCause,
    });
    this.name = 'UploadCleanupRequiredError';
  }
}

export async function saveUpload(
  ctx: RequestContext,
  data: Uint8Array,
  {
    name,
    type,
    now,
    storage,
    runtime,
  }: {
    name?: string;
    type?: string | null;
    now?: string;
    storage: ObjectWriteLifecycle;
    runtime?: RuntimeSource;
  },
): Promise<StoredUpload> {
  const upload = await stageUpload(ctx, data, {
    id: crypto.randomUUID(),
    name,
    type,
    now,
    storage,
    runtime,
  });
  try {
    await db.transaction((tx) => insertStagedUploadInTransaction(tx, ctx, upload));
  } catch (cause: unknown) {
    const cleanupFailure = (await cleanupObjectKeys(storage, [upload.path]))[0];
    if (cleanupFailure) {
      throw new UploadCleanupRequiredError(
        upload.id,
        upload.path,
        cause,
        cleanupFailure.cause,
      );
    }
    throw cause;
  }
  return upload;
}

/** Write upload bytes to object storage before entering a database transaction. */
export async function stageUpload(
  ctx: RequestContext,
  data: Uint8Array,
  {
    id,
    name,
    type,
    now,
    storage,
    runtime,
  }: {
    id: string;
    name?: string;
    type?: string | null;
    now?: string;
    storage: ObjectWriter;
    runtime?: RuntimeSource;
  },
): Promise<StoredUpload> {
  const original = name && name.trim() ? name : 'upload.bin';
  const safeName = sanitizeName(original);
  const mime = detectMime(safeName, type);
  const objectKey = uploadObjectKey(ctx.tenantId, id);

  await storage.putObject({
    key: objectKey,
    data,
    contentType: mime,
  });

  const createdAt = now ?? new Date().toISOString();
  const url = publicUrlForUpload(id, runtime);
  return {
    id,
    name: safeName,
    type: mime,
    size: data.byteLength,
    path: objectKey,
    url,
    createdAt,
  };
}

/** Record a staged object as a tenant-owned upload inside the caller's transaction. */
export async function insertStagedUploadInTransaction(
  tx: UploadTransaction,
  ctx: RequestContext,
  upload: StoredUpload,
): Promise<void> {
  await tx.insert(uploadsTable).values({
    id: upload.id,
    tenantId: ctx.tenantId,
    name: upload.name,
    mimeType: upload.type,
    size: upload.size,
    path: upload.path,
    url: upload.url,
    createdAt: new Date(upload.createdAt),
  });
}

export async function getUpload(ctx: RequestContext, id: string): Promise<UploadLookupResult> {
  const rows = await db.select().from(uploadsTable).where(eq(uploadsTable.id, id)).limit(1);
  if (!rows.length) return { status: 'not_found' };
  if (rows[0].tenantId !== ctx.tenantId) return { status: 'forbidden' };
  return { status: 'ok', upload: mapUploadRow(rows[0]) };
}

export function publicUrlForUpload(id: string, runtime?: RuntimeSource): string {
  const base = (getEnv('QFLOW_UPLOAD_BASE', runtime) ?? '/uploads').replace(/\/$/, '') ||
    '/uploads';
  return `${base}/${id}`;
}

export function uploadIdFromUrl(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, 'http://local');
    const match = parsed.pathname.match(/\/uploads\/([a-z0-9\-]+)/i);
    return match ? match[1] : null;
  } catch (_err) {
    const fallback = url.match(/\/uploads\/([a-z0-9\-]+)/i);
    return fallback ? fallback[1] : null;
  }
}

function uploadObjectKey(tenantId: string, uploadId: string): string {
  return `uploads/${tenantId}/${uploadId}`;
}

type UploadRow = typeof uploadsTable.$inferSelect;

function mapUploadRow(row: UploadRow): StoredUpload {
  return {
    id: row.id,
    name: row.name,
    type: row.mimeType,
    size: row.size,
    path: row.path,
    url: row.url,
    createdAt: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
  };
}

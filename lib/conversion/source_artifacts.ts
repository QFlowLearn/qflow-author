import { and, eq } from 'drizzle-orm';

import { db, type QflowDatabase } from '../db.ts';
import { conversionSourceArtifacts, migrationRuns } from '../db/schema.ts';
import { MigrationLeaseLostError } from '../import/migration_jobs.ts';
import type { ImportSource } from '../import/types.ts';
import type { ObjectReader, ObjectWriter } from '../storage_contract.ts';
import type { WorkerContext } from '../tenants.ts';
import { sha256Hex } from '../sha256.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { parseStructuredSourceDocument } from './source_codec.ts';
import type { StructuredSourceDocument } from './source_model.ts';

type SourceArtifactRow = Omit<
  typeof conversionSourceArtifacts.$inferSelect,
  'kind' | 'document'
>;

/** Persisted original source artifact with no normalized document payload. */
export type PersistedOriginalSourceArtifact = SourceArtifactRow & {
  readonly kind: 'original';
  readonly document: null;
};

/** Persisted normalized source artifact with its required structured document. */
export type PersistedNormalizedSourceArtifact = SourceArtifactRow & {
  readonly kind: 'normalized';
  readonly document: StructuredSourceDocument;
};

/** Canonical persisted source artifact variants. */
export type PersistedSourceArtifact =
  | PersistedOriginalSourceArtifact
  | PersistedNormalizedSourceArtifact;

/** Original source staged in object storage before its queued run is created. */
export type StagedOriginalSourceArtifact = {
  readonly id: string;
  readonly runId: string;
  readonly kind: 'original';
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly document: null;
  readonly createdAt: Date;
};

/**
 * Persist original source bytes without creating a database reference.
 *
 * The caller must insert the returned artifact and its run in one transaction.
 */
export async function stageOriginalSource(input: {
  readonly tenantId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly source: ImportSource;
  readonly sha256: string;
  readonly storage: ObjectWriter;
}): Promise<StagedOriginalSourceArtifact> {
  const filename = requireSourceFilename(input.source.filename);
  const mimeType = input.source.mime?.trim() || 'application/octet-stream';
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new Error('Original source hash is invalid.');
  }
  const storageKey = originalSourceStorageKey(
    input.tenantId,
    input.runId,
    input.attemptId,
    input.sha256,
  );
  await input.storage.putObject({
    key: storageKey,
    data: input.source.bytes,
    contentType: mimeType,
    immutableIdentity: { sha256: input.sha256 },
  });
  return {
    id: await uuidV5(input.runId, 'source-artifact:original'),
    runId: input.runId,
    kind: 'original',
    filename,
    mimeType,
    size: input.source.bytes.byteLength,
    sha256: input.sha256,
    storageKey,
    document: null,
    createdAt: new Date(),
  };
}

/** Build the immutable object key owned by one original conversion source artifact. */
export function originalSourceStorageKey(
  tenantId: string,
  runId: string,
  attemptId: string,
  sha256: string,
): string {
  return ['conversion-sources', tenantId, runId, 'original', attemptId, sha256].join('/');
}

export async function persistNormalizedSource(input: {
  ctx: WorkerContext;
  runId: string;
  leaseToken: string;
  source: ImportSource;
  storage: ObjectWriter;
  document: StructuredSourceDocument;
  database?: QflowDatabase;
}): Promise<PersistedNormalizedSourceArtifact> {
  const document = parseStructuredSourceDocument(input.document);
  const filename = requireSourceFilename(input.source.filename);
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  const mimeType = 'application/vnd.qflow.structured-source+json';
  const sha256 = await sha256Hex(bytes);
  const storageKey = sourceStorageKey(
    input.ctx.tenantId,
    input.runId,
    'normalized',
    sha256,
  );
  await input.storage.putObject({
    key: storageKey,
    data: bytes,
    contentType: mimeType,
  });

  const rows = await (input.database ?? db).transaction(async (tx) => {
    const owned = await tx.select({ id: migrationRuns.id })
      .from(migrationRuns)
      .where(and(
        eq(migrationRuns.id, input.runId),
        eq(migrationRuns.tenantId, input.ctx.tenantId),
        eq(migrationRuns.status, 'analyzing'),
        eq(migrationRuns.leaseToken, input.leaseToken),
      ))
      .for('update')
      .limit(1);
    if (!owned.length) throw new MigrationLeaseLostError(input.runId);

    return await tx.insert(conversionSourceArtifacts).values({
      id: await uuidV5(input.runId, 'source-artifact:normalized'),
      runId: input.runId,
      kind: 'normalized',
      filename: `${filename}.normalized.json`,
      mimeType,
      size: bytes.byteLength,
      sha256,
      storageKey,
      document: document as unknown as Record<string, unknown>,
    }).onConflictDoUpdate({
      target: [conversionSourceArtifacts.runId, conversionSourceArtifacts.kind],
      set: {
        filename: `${filename}.normalized.json`,
        mimeType,
        size: bytes.byteLength,
        sha256,
        storageKey,
        document: document as unknown as Record<string, unknown>,
        createdAt: new Date(),
      },
    }).returning();
  });
  const row = rows[0];
  if (!row) throw new Error('Failed to persist normalized source artifact.');
  return { ...row, kind: 'normalized', document };
}

export async function readOriginalSource(input: {
  ctx: WorkerContext;
  runId: string;
  storage: ObjectReader;
  database?: QflowDatabase;
}): Promise<ImportSource> {
  const artifact = await getSourceArtifact(input.ctx, input.runId, 'original', input.database);
  if (!artifact) throw new Error('Conversion run is missing its original source artifact.');
  return {
    filename: artifact.filename,
    mime: artifact.mimeType,
    bytes: await input.storage.readObject(artifact.storageKey),
  };
}

function getSourceArtifact(
  ctx: WorkerContext,
  runId: string,
  kind: 'original',
  database?: QflowDatabase,
): Promise<PersistedOriginalSourceArtifact | null>;
function getSourceArtifact(
  ctx: WorkerContext,
  runId: string,
  kind: 'normalized',
  database?: QflowDatabase,
): Promise<PersistedNormalizedSourceArtifact | null>;
async function getSourceArtifact(
  ctx: WorkerContext,
  runId: string,
  kind: 'original' | 'normalized',
  database: QflowDatabase = db,
): Promise<PersistedSourceArtifact | null> {
  const rows = await database.select({ artifact: conversionSourceArtifacts })
    .from(conversionSourceArtifacts)
    .innerJoin(
      migrationRuns,
      eq(conversionSourceArtifacts.runId, migrationRuns.id),
    )
    .where(and(
      eq(conversionSourceArtifacts.runId, runId),
      eq(conversionSourceArtifacts.kind, kind),
      eq(migrationRuns.tenantId, ctx.tenantId),
    ))
    .limit(1);
  const artifact = rows[0]?.artifact;
  if (!artifact) return null;
  if (artifact.kind === 'original') {
    if (artifact.document !== null) {
      throw new Error('Original source artifact cannot contain a normalized document.');
    }
    return { ...artifact, kind: 'original', document: null };
  }
  if (artifact.kind === 'normalized') {
    return {
      ...artifact,
      kind: 'normalized',
      document: parseStructuredSourceDocument(artifact.document),
    };
  }
  throw new Error(`Invalid conversion source artifact kind: ${artifact.kind}`);
}

function requireSourceFilename(value: string | undefined): string {
  const filename = value?.trim();
  if (!filename) throw new Error('Conversion source filename is required.');
  return filename;
}

function sourceStorageKey(
  tenantId: string,
  runId: string,
  kind: 'original' | 'normalized',
  sha256: string,
): string {
  return ['conversion-sources', tenantId, runId, kind, sha256].join('/');
}

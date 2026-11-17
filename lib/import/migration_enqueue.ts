import { migrationPurposeError } from './migration_destination.ts';
import type { SourceIntakeDestination } from '../source_intake/entry_context.ts';
import {
  authorizeBankIntakeInTransaction,
  canStartBankIntake,
} from '../services/bank_intake_access.ts';
import { and, eq } from 'drizzle-orm';

import {
  originalSourceStorageKey,
  type StagedOriginalSourceArtifact,
  stageOriginalSource,
} from '../conversion/source_artifacts.ts';
import { db } from '../db.ts';
import {
  conversionSourceArtifacts,
  migrationBatches,
  migrationRuns,
  workflowDispatches,
} from '../db/schema.ts';
import { recordAuditEventInTransaction } from '../services/audit_logs.ts';
import { loadQuestionActorSnapshotInTransaction } from '../services/question_provenance.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../assessment_blueprint.ts';
import { sha256Hex } from '../sha256.ts';
import {
  formatSourceByteLimit,
  MAX_GENERATION_FILE_BYTES,
  MAX_SOURCE_BATCH_BYTES,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
} from '../source_intake/policy.ts';
import type { ObjectWriteLifecycle } from '../storage_contract.ts';
import { parseUuid } from '../persistence_parse.ts';
import { type RequestContext, resolveUserId } from '../tenants.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { getMigrationBatch } from './migration_batches.ts';
import { buildEmptyMigrationSummary } from './migration_analysis.ts';
import {
  cleanupUnownedMigrationSourceObjects,
  throwAfterMigrationSourceCleanup,
} from './migration_source_compensation.ts';
import { toMigrationJsonColumn } from './migration_run_store.ts';
import { draftApprovalColumns } from './migration_state.ts';
import type { ConversionPurpose, MigrationBatchRecord } from './migration_types.ts';
import { type ImportAdapterRef, resolveImportAdapter } from './registry.ts';
import type { ImportSource } from './types.ts';

const DEFAULT_MAX_ATTEMPTS = 3;

/** One source and the adapter selected during intake inspection. */
export type MigrationBatchSource = {
  readonly source: ImportSource;
  readonly adapter: ImportAdapterRef;
};

/** Fixed-scope command for creating or replaying a migration batch. */
export type EnqueueMigrationBatchCommand = {
  readonly idempotencyKey: string;
  readonly destination: SourceIntakeDestination;
  readonly purpose: ConversionPurpose;
  readonly sources: readonly MigrationBatchSource[];
};

type RunAdapterIdentity = {
  readonly id: string;
  readonly version: string;
  readonly label: string;
};

type PreparedMigrationSource = {
  readonly runId: string;
  readonly dispatchId: string;
  readonly position: number;
  readonly source: ImportSource;
  readonly filename: string;
  readonly mime: string | null;
  readonly size: number;
  readonly sha256: string;
  readonly adapter: RunAdapterIdentity;
};

/** Signals reuse of one idempotency key for a different migration command. */
export class MigrationBatchConflictError extends Error {
  constructor() {
    super('This submission key already belongs to a different migration batch.');
    this.name = 'MigrationBatchConflictError';
  }
}

/** Signals an invalid migration batch command before any durable write begins. */
export class MigrationBatchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationBatchInputError';
  }
}

/**
 * Create or replay one fixed-scope batch after every original source is durable.
 *
 * A failed object write creates no queued run. Replaying the same command reuses
 * the same batch, run, artifact, and object identities.
 */
export async function enqueueMigrationBatch(
  ctx: RequestContext,
  command: EnqueueMigrationBatchCommand,
  options: { readonly storage: ObjectWriteLifecycle },
): Promise<MigrationBatchRecord> {
  const idempotencyKey = parseIdempotencyKey(command.idempotencyKey);
  assertBatchShape(command);
  const purposeError = migrationPurposeError(command.destination, command.purpose);
  if (purposeError) throw new MigrationBatchInputError(purposeError);

  const batchId = await uuidV5(
    idempotencyKey,
    `migration-batch:${ctx.tenantId}`,
  );
  const prepared: PreparedMigrationSource[] = [];
  let totalBytes = 0;
  for (const [index, entry] of command.sources.entries()) {
    const filename = entry.source.filename?.trim();
    if (!filename) {
      throw new MigrationBatchInputError('Conversion source filename is required.');
    }
    const size = entry.source.bytes.byteLength;
    assertSourceSize(command.purpose, filename, size);
    totalBytes += size;
    if (totalBytes > MAX_SOURCE_BATCH_BYTES) {
      throw new MigrationBatchInputError(
        `The files in one recovery batch must total ${
          formatSourceByteLimit(MAX_SOURCE_BATCH_BYTES)
        } or less.`,
      );
    }
    const sha256 = await sha256Hex(entry.source.bytes);
    const position = index + 1;
    prepared.push({
      runId: await uuidV5(batchId, `migration-run:${position}:${sha256}`),
      dispatchId: crypto.randomUUID(),
      position,
      source: entry.source,
      filename,
      mime: entry.source.mime?.trim() || null,
      size,
      sha256,
      adapter: resolveRunAdapter(command.purpose, entry.adapter),
    });
  }

  const createdBy = resolveUserId(ctx);
  const requestFingerprint = await sha256Hex(new TextEncoder().encode(JSON.stringify({
    tenantId: ctx.tenantId,
    createdBy,
    purpose: command.purpose,
    destination: command.destination,
    sources: prepared.map((entry) => ({
      position: entry.position,
      filename: entry.filename,
      mime: entry.mime,
      size: entry.size,
      sha256: entry.sha256,
      adapter: entry.adapter,
    })),
  })));

  if (command.destination._tag === 'WorkspaceBank') {
    const { collectionId } = command.destination;
    if (collectionId !== null) parseUuid(collectionId, 'Invalid collection ID.');
    if (!await canStartBankIntake(ctx, collectionId, db)) {
      throw new MigrationBatchInputError('Bank intake destination is unavailable.');
    }
  }
  const replay = await getBatchByIdempotencyKey(ctx, idempotencyKey);
  if (replay) return assertBatchReplay(replay, command, requestFingerprint);

  const attemptId = crypto.randomUUID();
  const staged: StagedOriginalSourceArtifact[] = [];
  const stagedObjectKeys: string[] = [];
  try {
    for (const entry of prepared) {
      stagedObjectKeys.push(
        originalSourceStorageKey(ctx.tenantId, entry.runId, attemptId, entry.sha256),
      );
      staged.push(
        await stageOriginalSource({
          tenantId: ctx.tenantId,
          runId: entry.runId,
          attemptId,
          source: entry.source,
          sha256: entry.sha256,
          storage: options.storage,
        }),
      );
    }
  } catch (cause: unknown) {
    await throwAfterMigrationSourceCleanup({
      storage: options.storage,
      idempotencyKey,
      objectKeys: stagedObjectKeys,
      cause,
    });
  }

  let inserted = false;
  try {
    inserted = await db.transaction(async (tx) => {
      if (
        command.destination._tag === 'WorkspaceBank' &&
        !await authorizeBankIntakeInTransaction(tx, ctx, command.destination.collectionId)
      ) {
        throw new MigrationBatchInputError('Bank intake destination is unavailable.');
      }
      const createdBySnapshot = await loadQuestionActorSnapshotInTransaction(tx, createdBy);
      const insertedBatch = await tx.insert(migrationBatches).values({
        id: batchId,
        tenantId: ctx.tenantId,
        createdBy,
        createdBySnapshot: toMigrationJsonColumn(createdBySnapshot),
        purpose: command.purpose,
        idempotencyKey,
        requestFingerprint,
        sourceCount: prepared.length,
      }).onConflictDoNothing().returning({ id: migrationBatches.id });
      if (!insertedBatch.length) return false;

      const now = new Date();
      await tx.insert(migrationRuns).values(prepared.map((entry) => ({
        id: entry.runId,
        batchId,
        batchPosition: entry.position,
        tenantId: ctx.tenantId,
        sourceFilename: entry.filename,
        sourceMime: entry.mime,
        sourceSize: entry.size,
        adapterId: entry.adapter.id,
        adapterLabel: entry.adapter.label,
        adapterVersion: entry.adapter.version,
        status: 'queued',
        parts: [],
        organizationGroups: [],
        summary: toMigrationJsonColumn(buildEmptyMigrationSummary()),
        destination: command.destination._tag,
        collectionId: command.destination._tag === 'WorkspaceBank'
          ? command.destination.collectionId
          : null,
        blueprint: command.destination._tag === 'Assessment'
          ? UNSPECIFIED_ASSESSMENT_BLUEPRINT
          : null,
        attempts: 0,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        leaseToken: null,
        lastError: null,
        startedAt: null,
        completedAt: null,
        ...draftApprovalColumns(),
        assessmentId: null,
        committedAt: null,
        createdAt: now,
        updatedAt: now,
      })));
      await tx.insert(workflowDispatches).values(prepared.map((entry) => ({
        id: entry.dispatchId,
        kind: 'source_migration',
        jobId: entry.runId,
        tenantId: ctx.tenantId,
        state: 'pending',
        workflowStatus: null,
        attempts: 0,
        lastErrorCode: null,
        startedAt: null,
        completedAt: null,
        lastCheckedAt: null,
        createdAt: now,
        updatedAt: now,
      })));
      await tx.insert(conversionSourceArtifacts).values(staged);
      await recordAuditEventInTransaction(tx, {
        tenantId: ctx.tenantId,
        actorUserId: createdBy,
        action: 'migration_batch_created',
        metadata: {
          batchId,
          purpose: command.purpose,
          sourceCount: prepared.length,
        },
      });
      for (const entry of prepared) {
        await recordAuditEventInTransaction(tx, {
          tenantId: ctx.tenantId,
          actorUserId: createdBy,
          action: 'migration_queued',
          metadata: {
            batchId,
            runId: entry.runId,
            sourceFilename: entry.filename,
            sourceSize: entry.size,
            purpose: command.purpose,
          },
        });
      }
      return true;
    });
  } catch (cause: unknown) {
    await throwAfterMigrationSourceCleanup({
      storage: options.storage,
      idempotencyKey,
      objectKeys: stagedObjectKeys,
      cause,
    });
  }

  if (!inserted) {
    await cleanupUnownedMigrationSourceObjects({
      storage: options.storage,
      idempotencyKey,
      objectKeys: stagedObjectKeys,
      operationCause: null,
    });
  }

  const batch = await getBatchByIdempotencyKey(ctx, idempotencyKey);
  if (!batch) {
    throw new Error('Migration batch was not persisted after source preservation.');
  }
  return assertBatchReplay(batch, command, requestFingerprint);
}

async function getBatchByIdempotencyKey(
  ctx: RequestContext,
  idempotencyKey: string,
): Promise<MigrationBatchRecord | null> {
  const rows = await db.select({ id: migrationBatches.id })
    .from(migrationBatches)
    .where(and(
      eq(migrationBatches.tenantId, ctx.tenantId),
      eq(migrationBatches.idempotencyKey, idempotencyKey),
    ))
    .limit(1);
  const row = rows[0];
  return row ? await getMigrationBatch(ctx, row.id) : null;
}

function assertBatchShape(command: EnqueueMigrationBatchCommand): void {
  if (!command.sources.length || command.sources.length > MAX_SOURCE_FILES) {
    throw new MigrationBatchInputError(
      `A migration batch must contain between 1 and ${MAX_SOURCE_FILES} sources.`,
    );
  }
  if (command.purpose === 'generate_new' && command.sources.length !== 1) {
    throw new MigrationBatchInputError('Generate from source requires exactly one source.');
  }
}

function assertSourceSize(
  purpose: ConversionPurpose,
  filename: string,
  size: number,
): void {
  if (size < 1) {
    throw new MigrationBatchInputError(`${filename} must contain data.`);
  }
  const maximum = purpose === 'generate_new' ? MAX_GENERATION_FILE_BYTES : MAX_SOURCE_FILE_BYTES;
  if (size > maximum) {
    throw new MigrationBatchInputError(
      `${filename} exceeds the ${formatSourceByteLimit(maximum)} source limit.`,
    );
  }
}

function assertBatchReplay(
  batch: MigrationBatchRecord,
  command: EnqueueMigrationBatchCommand,
  requestFingerprint: string,
): MigrationBatchRecord {
  if (
    batch.requestFingerprint !== requestFingerprint ||
    batch.purpose !== command.purpose ||
    batch.sourceCount !== command.sources.length ||
    batch.runs.length !== command.sources.length
  ) {
    throw new MigrationBatchConflictError();
  }
  return batch;
}

function resolveRunAdapter(
  purpose: ConversionPurpose,
  selected: ImportAdapterRef,
): RunAdapterIdentity {
  if (purpose === 'recover_existing') {
    const adapter = resolveImportAdapter(selected);
    return { id: adapter.id, version: adapter.version, label: adapter.label };
  }
  return { ...selected, label: selected.id };
}

function parseIdempotencyKey(value: unknown): string {
  try {
    return parseUuid(value, 'A valid submission key is required.');
  } catch {
    throw new MigrationBatchInputError('A valid submission key is required.');
  }
}

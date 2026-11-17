import {
  prepareAnalysisRows,
  type PreparedAsset,
  type PreparedItem,
} from './migration_preparation.ts';
import { processNativeQtiAnalysis } from './migration_qti_stream.ts';
import { parseMigrationDestination } from './migration_destination.ts';
import { and, eq } from 'drizzle-orm';

import { buildPackageIndexDocument } from '../conversion/extract_package_source.ts';
import {
  extractStructuredSource,
  isStructuredSourceExtractable,
} from '../conversion/source_extraction.ts';
import { persistNormalizedSource, readOriginalSource } from '../conversion/source_artifacts.ts';
import type { StructuredSourceDocument } from '../conversion/source_model.ts';
import { db, type QflowDatabase } from '../db.ts';
import { migrationAssets, migrationItems, migrationRuns } from '../db/schema.ts';
import { recordAuditEventInTransaction } from '../services/audit_logs.ts';
import { sha256Hex } from '../sha256.ts';
import type { ObjectReadWriter } from '../storage_contract.ts';
import type { WorkerContext } from '../tenants.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { buildMigrationAnalysis, emptyMigrationCounts } from './migration_analysis.ts';
import {
  migrationLeaseLost,
  type MigrationProcessingFailure,
  type MigrationProcessingResult,
  permanentMigrationFailure,
  retryableMigrationFailure,
  unexpectedMigrationFailure,
} from './migration_failures.ts';
import {
  type ClaimedMigrationRun,
  contextForClaim,
  MigrationLeaseLostError,
} from './migration_jobs.ts';
import { toMigrationJsonColumn } from './migration_run_store.ts';
import { draftApprovalColumns } from './migration_state.ts';
import {
  type ImportDetection,
  inspectSelectedImportAdapter,
  resolvePinnedImportAdapterRef,
} from './registry.ts';
import type { ImportSource } from './types.ts';

/** Small completion receipt; the review projection is read separately by callers. */
export type MigrationAnalysisCompletion = { readonly runId: string };

type ProcessingOptions = {
  readonly storage: ObjectReadWriter;
  readonly database?: QflowDatabase;
  readonly signal?: AbortSignal;
};

type OwnedRunRow = typeof migrationRuns.$inferSelect;

// Keep SQL construction and the PostgreSQL bind count independent of package size.
// The transaction still publishes the complete analysis atomically.
const ANALYSIS_INSERT_BATCH_SIZE = 100;

/**
 * Analyze one lease-owned migration run and publish its review projection.
 *
 * Expected source, dependency, and ownership failures are returned as values.
 */
export async function processClaimedMigrationRun(
  job: ClaimedMigrationRun,
  options: ProcessingOptions,
): Promise<MigrationProcessingResult<MigrationAnalysisCompletion>> {
  const database = options.database ?? db;
  try {
    options.signal?.throwIfAborted();
    const rowResult = await runStep(
      () => loadOwnedRunRow(database, job),
      (cause) => retryableMigrationFailure('persistence_unavailable', cause),
    );
    if (rowResult._tag === 'Failure') return rowResult;
    if (!rowResult.value) return failure(migrationLeaseLost(new MigrationLeaseLostError(job.id)));

    const ctx = contextForClaim(job);
    const sourceResult = await runStep(
      async () => {
        options.signal?.throwIfAborted();
        const source = await readOriginalSource({
          ctx,
          runId: job.id,
          storage: options.storage,
          database,
        });
        options.signal?.throwIfAborted();
        return source;
      },
      (cause) => retryableMigrationFailure('source_read_unavailable', cause),
    );
    if (sourceResult._tag === 'Failure') return sourceResult;

    if (job.purpose === 'generate_new') {
      return await processGeneratePath(database, job, ctx, sourceResult.value, options);
    }
    return await processRecoverPath(
      database,
      job,
      ctx,
      rowResult.value,
      sourceResult.value,
      options,
    );
  } catch (cause: unknown) {
    if (cause instanceof MigrationLeaseLostError) {
      return failure(migrationLeaseLost(cause));
    }
    return failure(unexpectedMigrationFailure(cause));
  }
}

async function processGeneratePath(
  database: QflowDatabase,
  job: ClaimedMigrationRun,
  ctx: WorkerContext,
  source: ImportSource,
  options: ProcessingOptions,
): Promise<MigrationProcessingResult<MigrationAnalysisCompletion>> {
  const documentResult = await runStep(
    async () => {
      options.signal?.throwIfAborted();
      const document = await extractStructuredSource({
        filename: source.filename ?? '',
        mimeType: source.mime,
        bytes: source.bytes,
      });
      options.signal?.throwIfAborted();
      return document;
    },
    (cause) => permanentMigrationFailure('source_parse_invalid', cause),
  );
  if (documentResult._tag === 'Failure') return documentResult;

  const persistResult = await persistNormalizedDocument(
    database,
    job,
    ctx,
    source,
    documentResult.value,
    options,
  );
  if (persistResult._tag === 'Failure') return persistResult;

  const saveResult = await runStep(
    () => saveGenerationSource(database, job, source, documentResult.value),
    classifyPersistenceFailure(),
  );
  if (saveResult._tag === 'Failure') return saveResult;

  return await loadCompletedRun(database, ctx, job.id);
}

async function processRecoverPath(
  database: QflowDatabase,
  job: ClaimedMigrationRun,
  ctx: WorkerContext,
  row: OwnedRunRow,
  source: ImportSource,
  options: ProcessingOptions,
): Promise<MigrationProcessingResult<MigrationAnalysisCompletion>> {
  if (row.adapterId === 'qti3') {
    const result = await runStep(
      () => processNativeQtiAnalysis({ database, job, ctx, row, source, ...options }),
      (cause) =>
        cause instanceof MigrationLeaseLostError
          ? migrationLeaseLost(cause)
          : retryableMigrationFailure('persistence_unavailable', cause),
    );
    if (result._tag === 'Failure') return result;
    return await loadCompletedRun(database, ctx, job.id);
  }
  const parseResult = await runStep(
    async () => {
      const detection = await inspectSelectedImportAdapter(
        source,
        resolvePinnedImportAdapterRef(row.adapterId, row.adapterVersion),
      );
      const parsed = await detection.adapter.parse(source, detection.sniff.hint);
      return { detection, parsed };
    },
    (cause) => permanentMigrationFailure('source_parse_invalid', cause),
  );
  if (parseResult._tag === 'Failure') return parseResult;
  const { detection, parsed } = parseResult.value;
  if (!parsed.items.length) {
    return failure(permanentMigrationFailure('source_contains_no_items', null));
  }

  const preparationResult = await runStep(
    async () => {
      options.signal?.throwIfAborted();
      const analysis = buildMigrationAnalysis(
        parsed,
        detection,
        parseMigrationDestination(row),
      );
      const document = await resolveRecoveryNormalizedDocument({
        source,
        parsedTitle: parsed.title || source.filename || 'Recovered assessment',
        normalizedSource: parsed.normalizedSource,
        entries: analysis.items.map((item) => ({
          href: item.sourceHref,
          title: item.title,
          identifier: item.sourceIdentifier,
        })),
      });
      return { analysis, document };
    },
    (cause) => permanentMigrationFailure('source_evidence_invalid', cause),
  );
  if (preparationResult._tag === 'Failure') return preparationResult;
  const { analysis, document } = preparationResult.value;

  const persistResult = await persistNormalizedDocument(
    database,
    job,
    ctx,
    source,
    document,
    options,
  );
  if (persistResult._tag === 'Failure') return persistResult;

  const rowsResult = await runStep(
    async () =>
      prepareAnalysisRows({
        job,
        sourceName: row.sourceFilename,
        parsed,
        analysis,
        document,
        sourceArtifact: {
          id: await uuidV5(job.id, 'source-artifact:original'),
          filename: row.sourceFilename,
          mimeType: source.mime?.trim() || 'application/octet-stream',
          size: source.bytes.byteLength,
          sha256: await sha256Hex(source.bytes),
        },
        normalized: {
          id: persistResult.value.id,
          sha256: persistResult.value.sha256,
        },
      }),
    (cause) => permanentMigrationFailure('source_evidence_invalid', cause),
  );
  if (rowsResult._tag === 'Failure') return rowsResult;

  const saveResult = await runStep(
    () =>
      saveAnalysis(database, {
        job,
        source,
        detection,
        analysis,
        assets: rowsResult.value.assets,
        items: rowsResult.value.items,
      }),
    classifyPersistenceFailure(),
  );
  if (saveResult._tag === 'Failure') return saveResult;

  return await loadCompletedRun(database, ctx, job.id);
}

async function persistNormalizedDocument(
  database: QflowDatabase,
  job: ClaimedMigrationRun,
  ctx: WorkerContext,
  source: ImportSource,
  document: StructuredSourceDocument,
  options: ProcessingOptions,
): Promise<MigrationProcessingResult<{ readonly id: string; readonly sha256: string }>> {
  return await runStep(
    async () => {
      options.signal?.throwIfAborted();
      const normalized = await persistNormalizedSource({
        ctx,
        runId: job.id,
        leaseToken: job.leaseToken,
        source,
        storage: options.storage,
        document,
        database,
      });
      options.signal?.throwIfAborted();
      return normalized;
    },
    (cause) => retryableMigrationFailure('source_write_unavailable', cause),
  );
}

async function loadCompletedRun(
  database: QflowDatabase,
  ctx: WorkerContext,
  runId: string,
): Promise<MigrationProcessingResult<MigrationAnalysisCompletion>> {
  const runResult = await runStep(
    async () => {
      const [run] = await database.select({ id: migrationRuns.id, status: migrationRuns.status })
        .from(migrationRuns).where(
          and(eq(migrationRuns.id, runId), eq(migrationRuns.tenantId, ctx.tenantId)),
        ).limit(1);
      return run && (run.status === 'analyzed' || run.status === 'committed')
        ? { runId: run.id }
        : null;
    },
    (cause) => retryableMigrationFailure('persistence_unavailable', cause),
  );
  if (runResult._tag === 'Failure') return runResult;
  if (!runResult.value) {
    return failure(retryableMigrationFailure('persistence_unavailable', null));
  }
  return { _tag: 'Success', value: runResult.value };
}

async function loadOwnedRunRow(
  database: QflowDatabase,
  job: ClaimedMigrationRun,
): Promise<OwnedRunRow | null> {
  const rows = await database.select({ run: migrationRuns }).from(migrationRuns)
    .where(and(
      eq(migrationRuns.id, job.id),
      eq(migrationRuns.tenantId, job.tenantId),
      eq(migrationRuns.status, 'analyzing'),
      eq(migrationRuns.leaseToken, job.leaseToken),
    ))
    .limit(1);
  return rows[0]?.run ?? null;
}

function classifyPersistenceFailure() {
  return (cause: unknown): MigrationProcessingFailure =>
    cause instanceof MigrationLeaseLostError
      ? migrationLeaseLost(cause)
      : retryableMigrationFailure('persistence_unavailable', cause);
}

async function saveGenerationSource(
  database: QflowDatabase,
  job: ClaimedMigrationRun,
  source: ImportSource,
  document: StructuredSourceDocument,
): Promise<void> {
  const now = new Date();
  const uncertaintyCount = document.uncertainties.length;
  await database.transaction(async (tx) => {
    const completed = await tx.update(migrationRuns).set({
      status: 'analyzed',
      parts: [],
      organizationGroups: [],
      summary: toMigrationJsonColumn({
        title: source.filename,
        counts: {
          ...emptyMigrationCounts(),
          warnings: uncertaintyCount,
        },
        warningCounts: uncertaintyCount ? { EXTRACTION_UNCERTAINTY: uncertaintyCount } : {},
        itemTypeCounts: {},
      }),
      leaseToken: null,
      lastError: null,
      startedAt: null,
      completedAt: now,
      ...draftApprovalColumns(),
      updatedAt: now,
    }).where(ownedAnalyzingRun(job)).returning({ id: migrationRuns.id });
    if (!completed.length) throw new MigrationLeaseLostError(job.id);

    await recordAuditEventInTransaction(tx, {
      tenantId: job.tenantId,
      actorUserId: job.userId,
      action: 'generation_source_prepared',
      metadata: {
        batchId: job.batchId,
        runId: job.id,
        sourceFilename: source.filename,
        uncertainties: uncertaintyCount,
      },
    });
  });
}

async function saveAnalysis(database: QflowDatabase, input: {
  readonly job: ClaimedMigrationRun;
  readonly source: ImportSource;
  readonly detection: ImportDetection;
  readonly analysis: ReturnType<typeof buildMigrationAnalysis>;
  readonly assets: readonly PreparedAsset[];
  readonly items: readonly PreparedItem[];
}): Promise<void> {
  const now = new Date();
  await database.transaction(async (tx) => {
    const owned = await tx.select({ id: migrationRuns.id })
      .from(migrationRuns)
      .where(and(
        eq(migrationRuns.id, input.job.id),
        eq(migrationRuns.tenantId, input.job.tenantId),
        eq(migrationRuns.status, 'analyzing'),
        eq(migrationRuns.leaseToken, input.job.leaseToken),
      ))
      .for('update')
      .limit(1);
    if (!owned.length) throw new MigrationLeaseLostError(input.job.id);

    await tx.delete(migrationItems).where(eq(migrationItems.runId, input.job.id));
    await tx.delete(migrationAssets).where(eq(migrationAssets.runId, input.job.id));
    for (let offset = 0; offset < input.assets.length; offset += ANALYSIS_INSERT_BATCH_SIZE) {
      await tx.insert(migrationAssets).values(
        input.assets.slice(offset, offset + ANALYSIS_INSERT_BATCH_SIZE),
      );
    }
    for (let offset = 0; offset < input.items.length; offset += ANALYSIS_INSERT_BATCH_SIZE) {
      await tx.insert(migrationItems).values(
        input.items.slice(offset, offset + ANALYSIS_INSERT_BATCH_SIZE),
      );
    }

    const completed = await tx.update(migrationRuns).set({
      status: 'analyzed',
      parts: input.analysis.parts,
      organizationGroups: input.analysis.organizationGroups,
      summary: toMigrationJsonColumn(input.analysis.summary),
      leaseToken: null,
      lastError: null,
      startedAt: null,
      completedAt: now,
      ...draftApprovalColumns(),
      updatedAt: now,
    }).where(ownedAnalyzingRun(input.job)).returning({ id: migrationRuns.id });
    if (!completed.length) throw new MigrationLeaseLostError(input.job.id);

    await recordAuditEventInTransaction(tx, {
      tenantId: input.job.tenantId,
      actorUserId: input.job.userId,
      action: 'migration_analyzed',
      metadata: {
        batchId: input.job.batchId,
        runId: input.job.id,
        sourceFilename: input.source.filename,
        adapterId: input.detection.adapter.id,
        items: input.analysis.summary.counts.items,
        warnings: input.analysis.summary.counts.warnings,
      },
    });
  });
}

function ownedAnalyzingRun(job: ClaimedMigrationRun) {
  return and(
    eq(migrationRuns.id, job.id),
    eq(migrationRuns.tenantId, job.tenantId),
    eq(migrationRuns.status, 'analyzing'),
    eq(migrationRuns.leaseToken, job.leaseToken),
  );
}

async function runStep<T>(
  operation: () => Promise<T>,
  classify: (cause: unknown) => MigrationProcessingFailure,
): Promise<MigrationProcessingResult<T>> {
  try {
    return { _tag: 'Success', value: await operation() };
  } catch (cause: unknown) {
    return failure(classify(cause));
  }
}

function failure<T>(failureValue: MigrationProcessingFailure): MigrationProcessingResult<T> {
  return { _tag: 'Failure', failure: failureValue };
}

async function resolveRecoveryNormalizedDocument(input: {
  source: ImportSource;
  parsedTitle: string;
  normalizedSource?: StructuredSourceDocument;
  entries: Array<{ href: string; title: string; identifier?: string }>;
}): Promise<StructuredSourceDocument> {
  if (input.normalizedSource) return input.normalizedSource;
  const filename = input.source.filename?.trim();
  if (!filename) throw new Error('Conversion source filename is required.');
  if (
    isStructuredSourceExtractable({
      filename,
      mimeType: input.source.mime,
    })
  ) {
    return await extractStructuredSource({
      filename,
      mimeType: input.source.mime,
      bytes: input.source.bytes,
    });
  }
  return buildPackageIndexDocument({
    title: input.parsedTitle,
    entries: input.entries,
  });
}

import { and, count, eq, inArray } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { migrationAssets, migrationItems, migrationRuns } from '../db/schema.ts';
import { buildPackageIndexDocument } from '../conversion/extract_package_source.ts';
import { persistNormalizedSource } from '../conversion/source_artifacts.ts';
import { sha256Hex } from '../sha256.ts';
import type { ObjectReadWriter } from '../storage_contract.ts';
import type { WorkerContext } from '../tenants.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { recordAuditEventInTransaction } from '../services/audit_logs.ts';
import {
  MAX_NATIVE_QTI_ENTRY_BYTES,
  MAX_SOURCE_ARCHIVE_EXPANDED_BYTES,
} from '../source_intake/policy.ts';
import {
  openQtiPackage,
  type QtiPackageImportEvent,
  streamQtiPackageImport,
} from './adapters/qti3/parse_package.ts';
import { buildMigrationAnalysis } from './migration_analysis.ts';
import { parseMigrationDestination } from './migration_destination.ts';
import { type ClaimedMigrationRun, MigrationLeaseLostError } from './migration_jobs.ts';
import {
  prepareAnalysisRows,
  type PreparedAsset,
  type PreparedItem,
} from './migration_preparation.ts';
import { toMigrationJsonColumn } from './migration_run_store.ts';
import { draftApprovalColumns } from './migration_state.ts';
import { inspectSelectedImportAdapter, resolvePinnedImportAdapterRef } from './registry.ts';
import type { ImportedItem, ImportSource, ImportWarning } from './types.ts';

const BATCH_SIZE = 100;
const BATCH_XML_BYTES = 2 * 1024 * 1024;
type SummaryEvent = Extract<QtiPackageImportEvent, { kind: 'summary' }>;

/**
 * Validate the immutable package, then replay its sequential projections into small,
 * lease-guarded transactions. Deterministic row identities make retries idempotent.
 * Provisional rows are never exposed as a completed review before final validation.
 */
export async function processNativeQtiAnalysis(input: {
  readonly database: QflowDatabase;
  readonly job: ClaimedMigrationRun;
  readonly ctx: WorkerContext;
  readonly row: typeof migrationRuns.$inferSelect;
  readonly source: ImportSource;
  readonly storage: ObjectReadWriter;
  readonly signal?: AbortSignal;
}): Promise<void> {
  const { database, job, source, row } = input;
  const detection = await inspectSelectedImportAdapter(
    source,
    resolvePinnedImportAdapterRef(row.adapterId, row.adapterVersion),
  );
  const archive = await openQtiPackage(source.bytes);
  const entries: Array<{ href: string; title: string; identifier: string }> = [];
  let completed: SummaryEvent | undefined;
  // Retain only the evidence index; item XML and draft models die on each iteration.
  for await (const event of streamQtiPackageImport(archive)) {
    input.signal?.throwIfAborted();
    if (event.kind === 'summary') completed = event;
    else {entries.push({
        href: event.item.href,
        title: event.item.title,
        identifier: event.item.identifier,
      });}
  }
  if (!completed || !entries.length) {
    throw new Error('QTI package contains no valid question inventory.');
  }
  const document = buildPackageIndexDocument({
    title: completed.summary.title || source.filename || 'Recovered assessment',
    entries,
  });
  const normalized = await persistNormalizedSource({
    ...input,
    runId: job.id,
    leaseToken: job.leaseToken,
    document,
  });
  const sourceArtifact = {
    id: await uuidV5(job.id, 'source-artifact:original'),
    filename: row.sourceFilename,
    mimeType: source.mime?.trim() || 'application/octet-stream',
    size: source.bytes.byteLength,
    sha256: await sha256Hex(source.bytes),
  };
  const destination = parseMigrationDestination(row);
  const packageResult = {
    title: completed.summary.title,
    parts: completed.parts,
    organizationGroups: completed.organizationGroups,
    items: [],
    assets: [],
    warnings: [...completed.warnings],
  };
  const aggregate = buildMigrationAnalysis(packageResult, detection, destination, entries.length);
  const assets: PreparedAsset[] = [];
  let assetBytes = 0;
  for (const asset of completed.summary.assets) {
    input.signal?.throwIfAborted();
    const data = await archive.readEntry(asset.href, MAX_NATIVE_QTI_ENTRY_BYTES);
    assetBytes += data.length;
    if (assetBytes > MAX_SOURCE_ARCHIVE_EXPANDED_BYTES) {
      throw new Error('Package assets exceed the 16 MB asset budget.');
    }
    const prepared = await prepareAnalysisRows({
      job,
      sourceName: row.sourceFilename,
      parsed: {
        ...packageResult,
        assets: [{
          path: asset.href,
          name: asset.href.split('/').pop() || asset.href,
          mime: asset.mediaType,
          data,
        }],
      },
      analysis: { ...aggregate, items: [] },
      document,
      sourceArtifact,
      normalized,
    });
    // Identity must be independent of batching, including repeated filenames.
    const preparedAsset = {
      ...prepared.assets[0],
      id: await uuidV5(job.id, `migration-asset:${asset.href}`),
    };
    await checkpoint([], [preparedAsset]);
    assets.push({ ...preparedAsset, dataBase64: '' });
  }
  aggregate.summary.counts.assets = assets.length;
  let batch: ImportedItem[] = [];
  let batchXmlBytes = 0;
  let warnings: ImportWarning[] = [];
  let position = 0;
  const flush = async () => {
    if (!batch.length) return;
    input.signal?.throwIfAborted();
    const analysis = buildMigrationAnalysis(
      {
        ...packageResult,
        items: batch,
        warnings: [
          ...completed!.warnings.filter((warning) => entries.length === 1 || warning.path),
          ...warnings,
        ],
      },
      detection,
      destination,
      entries.length,
    );
    for (const item of analysis.items) item.position = ++position;
    const prepared = await prepareAnalysisRows({
      job,
      sourceName: row.sourceFilename,
      parsed: { ...packageResult, items: batch },
      analysis,
      document,
      sourceArtifact,
      normalized,
      preparedAssets: assets,
    });
    await checkpoint(prepared.items, []);
    for (const key of ['items', 'ready', 'reviewNeeded', 'blocked', 'warnings'] as const) {
      aggregate.summary.counts[key] += analysis.summary.counts[key];
    }
    for (const [type, value] of Object.entries(analysis.summary.itemTypeCounts)) {
      aggregate.summary.itemTypeCounts[type] = (aggregate.summary.itemTypeCounts[type] ?? 0) +
        value;
    }
    for (
      const code of Object.keys(analysis.summary.warningCounts) as Array<
        keyof typeof analysis.summary.warningCounts
      >
    ) {
      aggregate.summary.warningCounts[code] = (aggregate.summary.warningCounts[code] ?? 0) +
        (analysis.summary.warningCounts[code] ?? 0);
    }
    batch = [];
    batchXmlBytes = 0;
    warnings = [];
  };
  for await (const event of streamQtiPackageImport(archive)) {
    input.signal?.throwIfAborted();
    if (event.kind === 'item') {
      const itemBytes = new TextEncoder().encode(event.item.xml).byteLength;
      if (batch.length && batchXmlBytes + itemBytes > BATCH_XML_BYTES) await flush();
      batchXmlBytes += itemBytes;
      batch.push(event.item);
      warnings.push(...event.warnings);
      if (batch.length === BATCH_SIZE) await flush();
    }
  }
  await flush();
  if (position !== entries.length) throw new Error('QTI replay changed its question inventory.');
  await database.transaction(async (tx) => {
    await guard(tx);
    const [persisted] = await tx.select({ total: count() }).from(migrationItems).where(
      eq(migrationItems.runId, job.id),
    );
    if (persisted.total !== entries.length) {
      throw new Error('QTI checkpoint count does not match the validated inventory.');
    }
    await tx.update(migrationRuns).set({
      status: 'analyzed',
      parts: aggregate.parts,
      organizationGroups: aggregate.organizationGroups,
      summary: toMigrationJsonColumn(aggregate.summary),
      leaseToken: null,
      lastError: null,
      startedAt: null,
      completedAt: new Date(),
      updatedAt: new Date(),
      ...draftApprovalColumns(),
    }).where(owned());
    await recordAuditEventInTransaction(tx, {
      tenantId: job.tenantId,
      actorUserId: job.userId,
      action: 'migration_analyzed',
      metadata: {
        batchId: job.batchId,
        runId: job.id,
        sourceFilename: source.filename,
        adapterId: detection.adapter.id,
        items: position,
        warnings: aggregate.summary.counts.warnings,
      },
    });
  });

  function owned() {
    return and(
      eq(migrationRuns.id, job.id),
      eq(migrationRuns.tenantId, job.tenantId),
      eq(migrationRuns.status, 'analyzing'),
      eq(migrationRuns.leaseToken, job.leaseToken),
    );
  }
  async function guard(tx: Parameters<Parameters<QflowDatabase['transaction']>[0]>[0]) {
    const rows = await tx.select({ id: migrationRuns.id }).from(migrationRuns).where(owned()).for(
      'update',
    ).limit(1);
    if (!rows.length) throw new MigrationLeaseLostError(job.id);
  }
  async function checkpoint(items: PreparedItem[], assetRows: PreparedAsset[]) {
    input.signal?.throwIfAborted();
    await database.transaction(async (tx) => {
      await guard(tx);
      if (assetRows.length) {
        await tx.insert(migrationAssets).values(assetRows).onConflictDoNothing();
      }
      if (items.length) {
        await tx.insert(migrationItems).values(items).onConflictDoNothing();
        const persisted = await tx.select({
          id: migrationItems.id,
          contentHash: migrationItems.contentHash,
          contextHash: migrationItems.contextHash,
        }).from(migrationItems).where(inArray(migrationItems.id, items.map((item) => item.id)));
        const expected = new Map(items.map((item) => [item.id, item]));
        if (
          persisted.length !== items.length ||
          persisted.some((item) =>
            item.contentHash !== expected.get(item.id)?.contentHash ||
            item.contextHash !== expected.get(item.id)?.contextHash
          )
        ) throw new Error('Persisted QTI checkpoint changed between attempts.');
      }
    });
  }
}

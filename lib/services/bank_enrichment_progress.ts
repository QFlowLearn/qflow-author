import { and, count, eq } from 'drizzle-orm';
import type { DbReadConnection } from '../db.ts';
import { enrichmentRunItems } from '../db/bank_enrichment_job_schema.ts';
import { enrichmentSnapshots } from '../db/bank_enrichment_schema.ts';

/** Mutually exclusive outcomes account for every captured question, including pending work. */
export type EnrichmentOutcomeCounts = {
  readonly pending: number;
  readonly classified: number;
  readonly unassigned: number;
  readonly protected: number;
  readonly outdated: number;
  readonly failed: number;
  readonly cancelled: number;
};
/** Counts are computed from persisted items, never from an approximate batch counter. */
export type EnrichmentRunProgress = {
  readonly total: number;
  readonly completed: number;
  readonly counts: EnrichmentOutcomeCounts;
};

/** Fail closed when the persisted run no longer reconciles with its immutable scope. */
export async function readEnrichmentRunProgress(
  database: DbReadConnection,
  tenantId: string,
  runId: string,
  snapshotId: string,
): Promise<EnrichmentRunProgress> {
  const [snapshot] = await database.select({ total: enrichmentSnapshots.itemCount }).from(
    enrichmentSnapshots,
  ).where(and(eq(enrichmentSnapshots.id, snapshotId), eq(enrichmentSnapshots.tenantId, tenantId)));
  if (!snapshot) throw new Error('Enrichment scope is missing.');
  const rows = await database.select({ state: enrichmentRunItems.state, count: count() }).from(
    enrichmentRunItems,
  ).where(and(eq(enrichmentRunItems.runId, runId), eq(enrichmentRunItems.tenantId, tenantId)))
    .groupBy(enrichmentRunItems.state);
  const counts = {
    pending: 0,
    classified: 0,
    unassigned: 0,
    protected: 0,
    outdated: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    const state = row.state;
    if (
      state !== 'pending' && state !== 'classified' && state !== 'unassigned' &&
      state !== 'protected' &&
      state !== 'outdated' && state !== 'failed' && state !== 'cancelled'
    ) {
      throw new Error('Invalid enrichment outcome.');
    }
    if (!Number.isSafeInteger(row.count) || row.count < 0) {
      throw new Error('Invalid enrichment count.');
    }
    counts[state] = row.count;
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total !== snapshot.total) throw new Error('Enrichment outcomes do not reconcile with scope.');
  return { total, completed: total - counts.pending, counts };
}

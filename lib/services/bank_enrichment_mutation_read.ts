import { uuidV5 } from '../uuid_v5.ts';
import { parseEnrichmentDefinition } from './bank_enrichment_contract.ts';
import { and, eq, sql } from 'drizzle-orm';
import type { DbReadConnection } from '../db.ts';
import { enrichmentRunItems, enrichmentRuns } from '../db/bank_enrichment_job_schema.ts';
import { enrichmentSchemeVersions, enrichmentSnapshots } from '../db/bank_enrichment_schema.ts';
import type { RequestContext } from '../tenants.ts';
import type { EnrichmentJobRecord } from './bank_enrichment_job_view.ts';
import { parsePrepareEnrichmentRun } from './bank_enrichment_run_contract.ts';
import { readEnrichmentRunProgress } from './bank_enrichment_progress.ts';

/** Read actual written and skipped counts inside the caller's authorized transaction. */
export async function readEnrichmentMutationJob(
  database: DbReadConnection,
  ctx: RequestContext,
  id: string,
  kind: 'correct' | 'undo',
): Promise<Extract<EnrichmentJobRecord, { kind: 'correct' | 'undo' }>> {
  const [record] = await database.select({ run: enrichmentRuns, snapshot: enrichmentSnapshots })
    .from(enrichmentRuns)
    .innerJoin(
      enrichmentSnapshots,
      and(
        eq(enrichmentSnapshots.id, enrichmentRuns.snapshotId),
        eq(enrichmentSnapshots.tenantId, enrichmentRuns.tenantId),
      ),
    )
    .where(and(eq(enrichmentRuns.id, id), eq(enrichmentRuns.tenantId, ctx.tenantId)));
  if (!record || record.run.kind !== kind) throw new Error('Mutation task is missing its record.');
  const { run, snapshot } = record;
  const state = run.state;
  const command = parsePrepareEnrichmentRun({
    snapshotId: run.snapshotId,
    versionId: run.versionId,
    dimensions: run.dimensions,
    replacement: run.replacement,
  });
  if (
    !command ||
    (state !== 'queued' && state !== 'running' && state !== 'completed' &&
      state !== 'completed_with_issues' && state !== 'failed' && state !== 'cancelled')
  ) {
    throw new Error('Invalid enrichment mutation lifecycle.');
  }
  const progress = await readEnrichmentRunProgress(database, ctx.tenantId, id, run.snapshotId);
  if (
    (state === 'completed' && progress.counts.classified !== progress.total) ||
    (['completed', 'completed_with_issues', 'failed', 'cancelled'].includes(state) &&
      progress.counts.pending !== 0)
  ) {
    throw new Error('Unreconciled enrichment mutation.');
  }
  const written = sql`COALESCE(jsonb_array_length(${enrichmentRunItems.detail} -> 'written'), 0)`;
  const [changes] = await database.select({
    questions: sql<number>`count(*) FILTER (WHERE ${written} > 0)`.mapWith(Number),
    dimensions: sql<number>`COALESCE(sum(${written}), 0)`.mapWith(Number),
    laterEdits: sql<
      number
    >`count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_each_text(${enrichmentRunItems.detail} -> 'protected') p WHERE p.value = 'changed_since_start'))`
      .mapWith(Number),
    noChanges: sql<
      number
    >`count(*) FILTER (WHERE ${written} = 0 AND ${enrichmentRunItems.state} = 'classified')`
      .mapWith(Number),
  }).from(enrichmentRunItems).where(
    and(eq(enrichmentRunItems.runId, id), eq(enrichmentRunItems.tenantId, ctx.tenantId)),
  );
  if (
    Object.values(changes).some((n) => !Number.isSafeInteger(n) || n < 0) ||
    changes.questions > progress.completed || changes.dimensions > changes.questions * 3
  ) {
    throw new Error('Invalid enrichment mutation change counts.');
  }
  const [teaching] = await database.select().from(enrichmentSchemeVersions).where(and(
    eq(enrichmentSchemeVersions.id, await uuidV5(id, 'correction-teaching')),
    eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
  ));
  const teachingDefinition = teaching ? parseEnrichmentDefinition(teaching.definition) : null;
  if (teaching && !teachingDefinition) throw new Error('Invalid teaching result.');
  return {
    id,
    kind,
    state,
    snapshotId: snapshot.id,
    scopeCount: snapshot.itemCount,
    capturedAt: snapshot.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    schemeId: run.schemeId,
    sourceRunId: run.sourceRunId,
    command,
    progress,
    changes,
    teachingExampleCount: teachingDefinition ? teachingDefinition.examples.length : null,
    errorCode: run.result !== null && typeof run.result === 'object' && 'code' in run.result &&
        typeof run.result.code === 'string'
      ? run.result.code
      : null,
  };
}

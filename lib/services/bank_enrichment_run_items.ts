import { and, count, eq, sql } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { enrichmentSnapshotItems } from '../db/bank_enrichment_schema.ts';
import { enrichmentRunItems } from '../db/bank_enrichment_job_schema.ts';

/** Freeze expected change tokens in SQL; undo captures only writes already made by its source run. */
export async function captureEnrichmentRunItems(tx: QflowDatabaseTransaction, input: {
  readonly tenantId: string;
  readonly schemeId: string;
  readonly runId: string;
  readonly snapshotId: string;
  readonly itemCount: number;
  readonly tokens: { readonly kind: 'current' } | {
    readonly kind: 'source_run';
    readonly runId: string;
  };
}): Promise<void> {
  const tokens = input.tokens.kind === 'current'
    ? sql`SELECT jsonb_object_agg(a.dimension, a.change_id) FROM bank_enrichment_assignments a WHERE a.tenant_id = ${input.tenantId} AND a.scheme_id = ${input.schemeId} AND a.question_id = ${enrichmentSnapshotItems.questionId}`
    : sql`SELECT jsonb_object_agg(c.dimension, c.id) FROM bank_enrichment_changes c WHERE c.tenant_id = ${input.tenantId} AND c.scheme_id = ${input.schemeId} AND c.operation_id = ${input.tokens.runId} AND c.question_id = ${enrichmentSnapshotItems.questionId}`;
  await tx.insert(enrichmentRunItems).select(
    tx.select({
      runId: sql<string>`${input.runId}::uuid`.as('run_id'),
      tenantId: enrichmentSnapshotItems.tenantId,
      schemeId: sql<string>`${input.schemeId}::uuid`.as('scheme_id'),
      questionId: enrichmentSnapshotItems.questionId,
      revisionId: enrichmentSnapshotItems.revisionId,
      baseline:
        sql`'{"subject":null,"topic":null,"difficulty":null}'::jsonb || COALESCE((${tokens}), '{}'::jsonb)`
          .as('baseline'),
      state: sql<string>`'pending'`.as('state'),
      detail: sql`NULL::jsonb`.as('detail'),
    }).from(enrichmentSnapshotItems).where(
      and(
        eq(enrichmentSnapshotItems.snapshotId, input.snapshotId),
        eq(enrichmentSnapshotItems.tenantId, input.tenantId),
      ),
    ),
  );
  const [row] = await tx.select({ value: count() }).from(enrichmentRunItems).where(
    and(eq(enrichmentRunItems.runId, input.runId), eq(enrichmentRunItems.tenantId, input.tenantId)),
  );
  if (row.value !== input.itemCount) throw new Error('Enrichment run scope count mismatch.');
}

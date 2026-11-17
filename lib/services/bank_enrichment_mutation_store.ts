import { and, eq } from 'drizzle-orm';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import { enrichmentRuns } from '../db/bank_enrichment_job_schema.ts';
import { enrichmentSchemeVersions, enrichmentSnapshots } from '../db/bank_enrichment_schema.ts';
import { enrichmentTasks } from '../db/bank_enrichment_task_schema.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentResult,
  parseEnrichmentDefinition,
} from './bank_enrichment_contract.ts';
import { parseEnrichmentCorrection } from './bank_enrichment_change_contract.ts';
import type { EnrichmentJobFailure } from './bank_enrichment_job_contract.ts';
import { jobStorageFailure } from './bank_enrichment_jobs.ts';
import { captureEnrichmentRunItems } from './bank_enrichment_run_items.ts';
import { parsePrepareEnrichmentRun } from './bank_enrichment_run_contract.ts';
import type { PreparedEnrichmentRun } from './bank_enrichment_run_store.ts';

/** Human operations freeze their inputs and tokens before dispatch, without an AI usage record. */
export class BankEnrichmentMutations {
  constructor(private readonly database: QflowDatabase, private readonly now: () => Date) {}

  /** Repeated operation IDs replay an identical correction and never refresh its baseline. */
  async correct(
    ctx: RequestContext,
    id: string,
    input: unknown,
  ): Promise<EnrichmentResult<PreparedEnrichmentRun, EnrichmentJobFailure>> {
    if (
      !isCanonicalUuid(id) || typeof input !== 'object' || input === null ||
      !('versionId' in input) || typeof input.versionId !== 'string' ||
      !isCanonicalUuid(input.versionId)
    ) return { ok: false, code: 'invalid_input' };
    const versionId = input.versionId;
    try {
      return await this.database.transaction(
        async (tx): Promise<EnrichmentResult<PreparedEnrichmentRun, EnrichmentJobFailure>> => {
          if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
            return { ok: false, code: 'forbidden' };
          }
          const [version] = await tx.select().from(enrichmentSchemeVersions).where(
            and(
              eq(enrichmentSchemeVersions.id, versionId),
              eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
            ),
          );
          if (!version) return { ok: false, code: 'not_found' };
          const definition = parseEnrichmentDefinition(version.definition);
          if (!definition) throw new Error('Invalid correction vocabulary.');
          const command = parseEnrichmentCorrection(input, definition);
          if (!command) return { ok: false, code: 'invalid_input' };
          const [snapshot] = await tx.select().from(enrichmentSnapshots).where(
            and(
              eq(enrichmentSnapshots.id, command.snapshotId),
              eq(enrichmentSnapshots.tenantId, ctx.tenantId),
            ),
          );
          if (!snapshot) return { ok: false, code: 'not_found' };
          if (snapshot.itemCount < 1) return { ok: false, code: 'invalid_input' };
          const operation = {
            snapshotId: snapshot.id,
            schemeId: version.schemeId,
            versionId: version.id,
            kind: 'correct',
            dimensions: ENRICHMENT_DIMENSIONS.filter((d) => command.values[d] !== null),
            replacement: 'replace_captured',
            configuration: { kind: 'correct', values: command.values },
            sourceRunId: null,
          } as const;
          const existing = await replayMutation(tx, ctx, id, operation, snapshot.itemCount);
          if (existing) return existing;
          const now = this.now();
          await tx.insert(enrichmentRuns).values({
            ...operation,
            id,
            tenantId: ctx.tenantId,
            state: 'prepared',
            createdBy: ctx.userId,
            createdAt: now,
            updatedAt: now,
          });
          await captureEnrichmentRunItems(tx, {
            tenantId: ctx.tenantId,
            schemeId: version.schemeId,
            runId: id,
            snapshotId: snapshot.id,
            itemCount: snapshot.itemCount,
            tokens: { kind: 'current' },
          });
          return { ok: true, value: { id, itemCount: snapshot.itemCount } };
        },
      );
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }

  /** Undo captures source-write identities now; a later resume of that source cannot expand its targets. */
  async undo(
    ctx: RequestContext,
    id: string,
    sourceRunId: string,
  ): Promise<EnrichmentResult<PreparedEnrichmentRun, EnrichmentJobFailure>> {
    if (!isCanonicalUuid(id) || !isCanonicalUuid(sourceRunId) || id === sourceRunId) {
      return { ok: false, code: 'invalid_input' };
    }
    try {
      return await this.database.transaction(
        async (tx): Promise<EnrichmentResult<PreparedEnrichmentRun, EnrichmentJobFailure>> => {
          if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
            return { ok: false, code: 'forbidden' };
          }
          const [source] = await tx.select().from(enrichmentRuns).where(
            and(eq(enrichmentRuns.id, sourceRunId), eq(enrichmentRuns.tenantId, ctx.tenantId)),
          ).for('update');
          if (!source) return { ok: false, code: 'not_found' };
          if (source.kind !== 'classify' && source.kind !== 'correct') {
            return { ok: false, code: 'invalid_transition' };
          }
          const command = parsePrepareEnrichmentRun({
            snapshotId: source.snapshotId,
            versionId: source.versionId,
            dimensions: source.dimensions,
            replacement: source.replacement,
          });
          if (!command) throw new Error('Invalid undo source input.');
          const [snapshot] = await tx.select().from(enrichmentSnapshots).where(
            and(
              eq(enrichmentSnapshots.id, source.snapshotId),
              eq(enrichmentSnapshots.tenantId, ctx.tenantId),
            ),
          );
          if (!snapshot || snapshot.itemCount < 1) throw new Error('Invalid undo source scope.');
          const operation = {
            snapshotId: snapshot.id,
            schemeId: source.schemeId,
            versionId: source.versionId,
            kind: 'undo',
            dimensions: command.dimensions,
            replacement: 'replace_captured',
            configuration: { kind: 'undo' },
            sourceRunId,
          } as const;
          const existing = await replayMutation(tx, ctx, id, operation, snapshot.itemCount);
          if (existing) return existing;
          if (
            !['completed', 'completed_with_issues', 'failed', 'cancelled'].includes(source.state)
          ) {
            return { ok: false, code: 'invalid_transition' };
          }
          const now = this.now();
          await tx.insert(enrichmentRuns).values({
            ...operation,
            id,
            tenantId: ctx.tenantId,
            state: 'prepared',
            createdBy: ctx.userId,
            createdAt: now,
            updatedAt: now,
          });
          await captureEnrichmentRunItems(tx, {
            tenantId: ctx.tenantId,
            schemeId: source.schemeId,
            runId: id,
            snapshotId: snapshot.id,
            itemCount: snapshot.itemCount,
            tokens: { kind: 'source_run', runId: sourceRunId },
          });
          return { ok: true, value: { id, itemCount: snapshot.itemCount } };
        },
      );
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }
}

type MutationIdentity = Pick<
  typeof enrichmentRuns.$inferInsert,
  | 'snapshotId'
  | 'schemeId'
  | 'versionId'
  | 'kind'
  | 'dimensions'
  | 'replacement'
  | 'configuration'
  | 'sourceRunId'
>;
async function replayMutation(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  id: string,
  operation: MutationIdentity,
  itemCount: number,
): Promise<EnrichmentResult<PreparedEnrichmentRun, EnrichmentJobFailure> | null> {
  const [existing] = await tx.select().from(enrichmentRuns).where(eq(enrichmentRuns.id, id));
  if (existing) {
    const stored: MutationIdentity = {
      snapshotId: existing.snapshotId,
      schemeId: existing.schemeId,
      versionId: existing.versionId,
      kind: existing.kind,
      dimensions: existing.dimensions,
      replacement: existing.replacement,
      configuration: existing.configuration,
      sourceRunId: existing.sourceRunId,
    };
    if (
      existing.tenantId !== ctx.tenantId || existing.createdBy !== ctx.userId ||
      canonicalJsonStringify(stored) !== canonicalJsonStringify(operation)
    ) return { ok: false, code: 'operation_conflict' };
    return { ok: true, value: { id, itemCount } };
  }
  const [task] = await tx.select({ id: enrichmentTasks.id }).from(enrichmentTasks).where(
    eq(enrichmentTasks.id, id),
  );
  return task ? { ok: false, code: 'operation_conflict' } : null;
}

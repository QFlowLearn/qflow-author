import { captureEnrichmentRunItems } from './bank_enrichment_run_items.ts';
import { and, count, eq } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { enrichmentSchemeVersions, enrichmentSnapshots } from '../db/bank_enrichment_schema.ts';
import { enrichmentRunItems, enrichmentRuns } from '../db/bank_enrichment_job_schema.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { safeErrorSummary } from '../error_summary.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import { type EnrichmentResult, parseEnrichmentDefinition } from './bank_enrichment_contract.ts';
import { parsePrepareEnrichmentRun } from './bank_enrichment_run_contract.ts';

/** Receipt for a complete frozen run, before provider configuration and durable dispatch. */
export type PreparedEnrichmentRun = { readonly id: string; readonly itemCount: number };
type PrepareFailure =
  | 'invalid_input'
  | 'forbidden'
  | 'not_found'
  | 'operation_conflict'
  | 'storage_failed';

/** Capture per-question revision and change tokens atomically with the run's exact policy. */
export class BankEnrichmentRunStore {
  constructor(private readonly database: QflowDatabase, private readonly now: () => Date) {}

  /** Retrying the same ID never refreshes the snapshot or captures later human edits. */
  async prepare(
    ctx: RequestContext,
    id: string,
    input: unknown,
  ): Promise<EnrichmentResult<PreparedEnrichmentRun, PrepareFailure>> {
    const command = parsePrepareEnrichmentRun(input);
    if (!command || !isCanonicalUuid(id)) return { ok: false, code: 'invalid_input' };
    try {
      return await this.database.transaction(
        async (tx): Promise<EnrichmentResult<PreparedEnrichmentRun, PrepareFailure>> => {
          if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
            return { ok: false, code: 'forbidden' };
          }
          const existing = await tx.select().from(enrichmentRuns).where(eq(enrichmentRuns.id, id));
          if (existing[0]) {
            const row = existing[0];
            const recorded = parsePrepareEnrichmentRun({
              snapshotId: row.snapshotId,
              versionId: row.versionId,
              dimensions: row.dimensions,
              replacement: row.replacement,
            });
            if (!recorded) throw new Error('Invalid persisted enrichment run input.');
            if (
              row.tenantId !== ctx.tenantId || row.createdBy !== ctx.userId ||
              row.kind !== 'classify' ||
              canonicalJsonStringify(recorded) !== canonicalJsonStringify(command)
            ) return { ok: false, code: 'operation_conflict' };
            const counts = await tx.select({ value: count() }).from(enrichmentRunItems).where(
              eq(enrichmentRunItems.runId, id),
            );
            return { ok: true, value: { id, itemCount: counts[0].value } };
          }
          const snapshots = await tx.select().from(enrichmentSnapshots).where(
            and(
              eq(enrichmentSnapshots.id, command.snapshotId),
              eq(enrichmentSnapshots.tenantId, ctx.tenantId),
            ),
          );
          const versions = await tx.select().from(enrichmentSchemeVersions).where(
            and(
              eq(enrichmentSchemeVersions.id, command.versionId),
              eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
            ),
          );
          const snapshot = snapshots[0];
          const version = versions[0];
          if (!snapshot || !version) return { ok: false, code: 'not_found' };
          if (snapshot.itemCount < 1 || !parseEnrichmentDefinition(version.definition)) {
            throw new Error('Invalid persisted enrichment run source.');
          }
          const definition = parseEnrichmentDefinition(version.definition);
          if (command.dimensions.includes('difficulty') && definition?.difficulty.length === 0) {
            return { ok: false, code: 'invalid_input' } as const;
          }
          const createdAt = this.now();
          await tx.insert(enrichmentRuns).values({
            id,
            tenantId: ctx.tenantId,
            snapshotId: command.snapshotId,
            schemeId: version.schemeId,
            versionId: command.versionId,
            kind: 'classify',
            state: 'prepared',
            dimensions: command.dimensions,
            replacement: command.replacement,
            createdBy: ctx.userId,
            createdAt,
            updatedAt: createdAt,
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
      console.error('Enrichment run preparation failed', {
        runId: id,
        error: safeErrorSummary(cause),
      });
      return { ok: false, code: 'storage_failed' };
    }
  }
}

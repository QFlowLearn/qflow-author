import { and, eq, sql } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { enrichmentSnapshots } from '../db/bank_enrichment_schema.ts';
import { safeErrorSummary } from '../error_summary.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { canReadEnrichment } from './bank_enrichment_access.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import {
  type EnrichmentInputFailure,
  type EnrichmentQuestion,
  prepareEnrichmentQuestion,
} from './bank_enrichment_input.ts';

/** Actual sample counts remain distinct from the complete frozen scope. */
export type EnrichmentSample = {
  readonly snapshotId: string;
  readonly scopeCount: number;
  readonly seed: string;
  readonly selectedCount: number;
  readonly questions: readonly EnrichmentQuestion[];
  readonly excluded: readonly {
    readonly questionId: string;
    readonly revisionId: string;
    readonly reason: EnrichmentInputFailure;
  }[];
};

/** Read a reproducible, stratified sample from all snapshot items without changing the bank. */
export class BankEnrichmentSampler {
  constructor(private readonly database: QflowDatabase) {}

  /** Round-robin source/type/length strata before seeded ordering within each stratum. */
  async sample(
    ctx: RequestContext,
    snapshotId: string,
    seed: string,
  ): Promise<
    EnrichmentResult<
      EnrichmentSample,
      'invalid_input' | 'forbidden' | 'not_found' | 'storage_failed'
    >
  > {
    if (!isCanonicalUuid(snapshotId) || !isCanonicalUuid(seed)) {
      return { ok: false, code: 'invalid_input' };
    }
    try {
      return await this.database.transaction(async (tx) => {
        if (!await canReadEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const [snapshot] = await tx.select({ count: enrichmentSnapshots.itemCount }).from(
          enrichmentSnapshots,
        ).where(and(
          eq(enrichmentSnapshots.id, snapshotId),
          eq(enrichmentSnapshots.tenantId, ctx.tenantId),
        ));
        if (!snapshot) return { ok: false, code: 'not_found' } as const;
        const rows = await tx.execute(sql`
          WITH candidates AS (
            SELECT s.question_id, s.revision_id, r.body,
              COALESCE(origin.provenance #>> '{origin,artifact,sha256}', origin.provenance #>> '{origin,_tag}', 'unknown') AS source,
              r.body->>'type' AS kind,
              CASE WHEN octet_length(r.body::text) < 2048 THEN 0
                WHEN octet_length(r.body::text) < 4096 THEN 1 ELSE 2 END AS size_bucket
            FROM bank_enrichment_snapshot_items s
            JOIN question_revisions r ON r.id = s.revision_id AND r.question_id = s.question_id AND r.tenant_id = s.tenant_id
            JOIN question_revisions origin ON origin.question_id = s.question_id AND origin.tenant_id = s.tenant_id AND origin.revision = 1
            WHERE s.snapshot_id = ${snapshotId} AND s.tenant_id = ${ctx.tenantId}
          ), ranked AS (
            SELECT *, row_number() OVER (PARTITION BY source, kind, size_bucket ORDER BY md5(${seed} || revision_id::text), question_id) AS ordinal
            FROM candidates
          )
          SELECT question_id, revision_id, body FROM ranked
          ORDER BY ordinal, md5(${seed} || source || COALESCE(kind, '') || size_bucket::text), question_id LIMIT 100
        `);
        const questions: EnrichmentQuestion[] = [];
        const excluded: EnrichmentSample['excluded'][number][] = [];
        let bytes = 0;
        for (const row of rows) {
          if (typeof row.question_id !== 'string' || typeof row.revision_id !== 'string') {
            throw new Error('Invalid stored sample reference.');
          }
          const parsed = prepareEnrichmentQuestion(row.question_id, row.revision_id, row.body);
          if (!parsed.ok) {
            excluded.push({
              questionId: row.question_id,
              revisionId: row.revision_id,
              reason: parsed.code,
            });
            continue;
          }
          const size = new TextEncoder().encode(JSON.stringify(parsed.value)).length;
          if (bytes + size > 122_880) {
            excluded.push({
              questionId: row.question_id,
              revisionId: row.revision_id,
              reason: 'input_too_large',
            });
            continue;
          }
          bytes += size;
          questions.push(parsed.value);
        }
        return {
          ok: true,
          value: {
            snapshotId,
            scopeCount: snapshot.count,
            seed,
            selectedCount: rows.length,
            questions,
            excluded,
          },
        } as const;
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    } catch (cause: unknown) {
      console.error('Enrichment sample read failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' };
    }
  }
}

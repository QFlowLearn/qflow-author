import {
  enrichmentScopeRecord,
  type EnrichmentSnapshot,
  type EnrichmentSnapshotFailure,
  parseEnrichmentScope,
  parseEnrichmentSnapshotScope,
} from './bank_enrichment_scope_contract.ts';
export { parseEnrichmentScope } from './bank_enrichment_scope_contract.ts';
export type { EnrichmentScope, EnrichmentSnapshot } from './bank_enrichment_scope_contract.ts';
import { validBankEnrichmentFilter } from './bank_enrichment_filter_access.ts';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { QflowDatabase } from '../db.ts';
import { enrichmentSnapshotItems, enrichmentSnapshots } from '../db/bank_enrichment_schema.ts';
import { questionReviewRequests, questionRevisions, questions } from '../db/question_schema.ts';
import { users } from '../db/principal_schema.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { safeErrorSummary } from '../error_summary.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { authorizeEnrichment, canReadEnrichment } from './bank_enrichment_access.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import { parseQuestionBankQuery } from './question_bank_query.ts';
import { questionBankConditions } from './question_bank_scope.ts';

/** Capture matching input references in SQL, never by fetching bank pages into the browser. */
export class BankEnrichmentScopes {
  constructor(private readonly database: QflowDatabase, private readonly now: () => Date) {}

  /** Count the full matching bank before creating any snapshot or provider work. */
  async inspect(
    ctx: RequestContext,
    input: unknown,
  ): Promise<EnrichmentResult<number, EnrichmentSnapshotFailure>> {
    const scope = parseEnrichmentScope(input);
    if (!scope) return { ok: false, code: 'invalid_input' };
    try {
      return await this.database.transaction(async (tx) => {
        if (!await canReadEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        if (
          scope._tag === 'Filtered' &&
          !await validBankEnrichmentFilter(tx, ctx.tenantId, scope.query.enrichment)
        ) {
          return { ok: false, code: 'invalid_input' } as const;
        }
        const latest = alias(questionRevisions, 'enrichment_count_latest'),
          first = alias(questionRevisions, 'enrichment_count_first');
        const query = scope._tag === 'Filtered'
          ? scope.query
          : parseQuestionBankQuery(new URLSearchParams());
        const conditions = questionBankConditions(ctx, query, latest, first);
        if (scope._tag === 'Selected') {
          conditions.push(inArray(questions.id, [...scope.questionIds]));
        }
        const [row] = await tx.select({ total: count() }).from(questions)
          .innerJoin(latest, eq(latest.id, questions.latestRevisionId))
          .innerJoin(first, and(eq(first.questionId, questions.id), eq(first.revision, 1)))
          .innerJoin(users, eq(users.id, questions.ownerUserId))
          .leftJoin(
            questionReviewRequests,
            and(
              eq(questionReviewRequests.revisionId, latest.id),
              eq(questionReviewRequests.tenantId, ctx.tenantId),
            ),
          )
          .where(and(...conditions));
        if (scope._tag === 'Selected' && row.total !== scope.questionIds.length) {
          return { ok: false, code: 'invalid_selection' } as const;
        }
        return { ok: true, value: row.total } as const;
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    } catch (cause: unknown) {
      console.error('Enrichment scope count failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' };
    }
  }

  /** Idempotent capture; invalid explicit selections leave no partial snapshot behind. */
  async capture(
    ctx: RequestContext,
    id: string,
    input: unknown,
  ): Promise<EnrichmentResult<EnrichmentSnapshot, EnrichmentSnapshotFailure>> {
    const scope = parseEnrichmentScope(input);
    if (!isCanonicalUuid(id) || !scope) return { ok: false, code: 'invalid_input' };
    const storedScope = enrichmentScopeRecord(scope);
    try {
      return await this.database.transaction(
        async (tx): Promise<EnrichmentResult<EnrichmentSnapshot, EnrichmentSnapshotFailure>> => {
          if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
            return { ok: false, code: 'forbidden' };
          }
          if (
            scope._tag === 'Filtered' &&
            !await validBankEnrichmentFilter(tx, ctx.tenantId, scope.query.enrichment)
          ) {
            return { ok: false, code: 'invalid_input' };
          }
          const existing = await tx.select().from(enrichmentSnapshots).where(
            eq(enrichmentSnapshots.id, id),
          );
          if (existing[0]) {
            const row = existing[0];
            if (row.tenantId !== ctx.tenantId || row.createdBy !== ctx.userId) {
              return { ok: false, code: 'operation_conflict' };
            }
            const value = parseSnapshot(row);
            return canonicalJsonStringify(enrichmentScopeRecord(value.scope)) ===
                canonicalJsonStringify(storedScope)
              ? { ok: true, value }
              : { ok: false, code: 'operation_conflict' };
          }
          const createdAt = this.now();
          await tx.insert(enrichmentSnapshots).values({
            id,
            tenantId: ctx.tenantId,
            scope: storedScope,
            itemCount: 0,
            createdBy: ctx.userId,
            createdAt,
          });
          const latest = alias(questionRevisions, 'enrichment_scope_latest');
          const first = alias(questionRevisions, 'enrichment_scope_first');
          const query = scope._tag === 'Filtered'
            ? scope.query
            : parseQuestionBankQuery(new URLSearchParams());
          const conditions = questionBankConditions(ctx, query, latest, first);
          if (scope._tag === 'Selected') {
            conditions.push(inArray(questions.id, [...scope.questionIds]));
          }
          const selection = tx.select({
            snapshotId: sql<string>`${id}::uuid`.as('snapshot_id'),
            tenantId: questions.tenantId,
            questionId: questions.id,
            revisionId: latest.id,
          }).from(questions)
            .innerJoin(latest, eq(latest.id, questions.latestRevisionId))
            .innerJoin(first, and(eq(first.questionId, questions.id), eq(first.revision, 1)))
            .innerJoin(users, eq(users.id, questions.ownerUserId))
            .leftJoin(
              questionReviewRequests,
              and(
                eq(questionReviewRequests.revisionId, latest.id),
                eq(questionReviewRequests.tenantId, ctx.tenantId),
              ),
            )
            .where(and(...conditions));
          await tx.insert(enrichmentSnapshotItems).select(selection);
          const counts = await tx.select({ value: count() }).from(enrichmentSnapshotItems).where(
            eq(enrichmentSnapshotItems.snapshotId, id),
          );
          const itemCount = counts[0]?.value ?? 0;
          if (
            itemCount === 0 || (scope._tag === 'Selected' && itemCount !== scope.questionIds.length)
          ) {
            await tx.delete(enrichmentSnapshotItems).where(
              eq(enrichmentSnapshotItems.snapshotId, id),
            );
            await tx.delete(enrichmentSnapshots).where(eq(enrichmentSnapshots.id, id));
            return {
              ok: false,
              code: scope._tag === 'Selected' ? 'invalid_selection' : 'empty_scope',
            };
          }
          await tx.update(enrichmentSnapshots).set({ itemCount }).where(
            eq(enrichmentSnapshots.id, id),
          );
          return { ok: true, value: { id, itemCount, scope, createdAt: createdAt.toISOString() } };
        },
      );
    } catch (cause: unknown) {
      console.error('Enrichment scope capture failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' };
    }
  }

  /** Retrieve a workspace-owned snapshot after navigation or process restart. */
  async get(
    ctx: RequestContext,
    id: string,
  ): Promise<
    EnrichmentResult<
      EnrichmentSnapshot,
      'invalid_input' | 'forbidden' | 'not_found' | 'storage_failed'
    >
  > {
    if (!isCanonicalUuid(id)) return { ok: false, code: 'invalid_input' };
    try {
      return await this.database.transaction(async (tx) => {
        if (!await canReadEnrichment(tx, ctx, 'view_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const rows = await tx.select().from(enrichmentSnapshots)
          .where(
            and(eq(enrichmentSnapshots.id, id), eq(enrichmentSnapshots.tenantId, ctx.tenantId)),
          );
        return rows[0]
          ? { ok: true, value: parseSnapshot(rows[0]) } as const
          : { ok: false, code: 'not_found' } as const;
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    } catch (cause: unknown) {
      console.error('Enrichment scope read failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' };
    }
  }
}

function parseSnapshot(row: typeof enrichmentSnapshots.$inferSelect): EnrichmentSnapshot {
  const scope = parseEnrichmentSnapshotScope(row.scope);
  if (
    !scope || !isCanonicalUuid(row.id) || !Number.isInteger(row.itemCount) || row.itemCount < 1 ||
    !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())
  ) {
    throw new Error('Invalid persisted enrichment snapshot.');
  }
  return { id: row.id, itemCount: row.itemCount, scope, createdAt: row.createdAt.toISOString() };
}

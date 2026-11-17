import { and, count, eq, sql } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import {
  enrichmentSchemeVersions,
  enrichmentSnapshotItems,
  enrichmentSnapshots,
} from '../db/bank_enrichment_schema.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { sha256Hex } from '../sha256.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import {
  type EnrichmentResult,
  parseEnrichmentDefinition,
  validEnrichmentReplacementMap,
} from './bank_enrichment_contract.ts';
import { enrichmentRemovedValues } from './bank_enrichment_affected_policy.ts';
import { enrichmentAffectedSql } from './bank_enrichment_affected_sql.ts';
import { jobStorageFailure } from './bank_enrichment_jobs.ts';
import {
  type EnrichmentAffectedScope,
  enrichmentScopeRecord,
  type EnrichmentSnapshot,
  type EnrichmentSnapshotFailure,
  parseEnrichmentSnapshotScope,
} from './bank_enrichment_scope_contract.ts';

/** Capture an affected subset in SQL without refreshing its source revisions or paging through the bank. */
export class BankEnrichmentAffectedScopes {
  constructor(private readonly database: QflowDatabase, private readonly now: () => Date) {}

  /** A repeated snapshot ID preserves the first captured references and exact edited-definition identity. */
  async capture(
    ctx: RequestContext,
    id: string,
    sourceSnapshotId: string,
    baseVersionId: string,
    input: unknown,
  ): Promise<EnrichmentResult<EnrichmentSnapshot, EnrichmentSnapshotFailure | 'not_found'>> {
    const definition = parseEnrichmentDefinition(input);
    if (
      ![id, sourceSnapshotId, baseVersionId].every(isCanonicalUuid) || id === sourceSnapshotId ||
      !definition
    ) return { ok: false, code: 'invalid_input' };
    const definitionHash = await sha256Hex(
      new TextEncoder().encode(canonicalJsonStringify(definition)),
    );
    try {
      return await this.database.transaction(
        async (
          tx,
        ): Promise<
          EnrichmentResult<EnrichmentSnapshot, EnrichmentSnapshotFailure | 'not_found'>
        > => {
          if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
            return { ok: false, code: 'forbidden' };
          }
          const [base] = await tx.select().from(enrichmentSchemeVersions).where(
            and(
              eq(enrichmentSchemeVersions.id, baseVersionId),
              eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
            ),
          );
          const [source] = await tx.select().from(enrichmentSnapshots).where(
            and(
              eq(enrichmentSnapshots.id, sourceSnapshotId),
              eq(enrichmentSnapshots.tenantId, ctx.tenantId),
            ),
          );
          if (!base || !source) {
            return { ok: false, code: 'not_found' };
          }
          const baseDefinition = parseEnrichmentDefinition(base.definition),
            sourceScope = parseEnrichmentSnapshotScope(source.scope);
          if (!baseDefinition || !sourceScope || source.itemCount < 1) {
            throw new Error('Invalid affected enrichment source.');
          }
          const rootSnapshotId = sourceScope._tag === 'Affected'
            ? sourceScope.sourceSnapshotId
            : source.id;
          const [root] = await tx.select().from(enrichmentSnapshots).where(
            and(
              eq(enrichmentSnapshots.id, rootSnapshotId),
              eq(enrichmentSnapshots.tenantId, ctx.tenantId),
            ),
          );
          const rootScope = root && parseEnrichmentSnapshotScope(root.scope);
          if (!root || !rootScope || rootScope._tag === 'Affected' || root.itemCount < 1) {
            throw new Error('Invalid root enrichment selection.');
          }
          if (!validEnrichmentReplacementMap(baseDefinition, definition)) {
            return { ok: false, code: 'invalid_input' };
          }
          const removedValues = enrichmentRemovedValues(baseDefinition, definition);
          if (!removedValues) return { ok: false, code: 'empty_scope' };
          const scope: EnrichmentAffectedScope = {
            _tag: 'Affected',
            sourceSnapshotId: rootSnapshotId,
            baseVersionId,
            definitionHash,
            removedValues,
            sourceScope: rootScope,
          };
          const record = enrichmentScopeRecord(scope);
          const [existing] = await tx.select().from(enrichmentSnapshots).where(
            eq(enrichmentSnapshots.id, id),
          );
          if (existing) {
            if (
              existing.tenantId !== ctx.tenantId || existing.createdBy !== ctx.userId ||
              canonicalJsonStringify(existing.scope) !== canonicalJsonStringify(record)
            ) return { ok: false, code: 'operation_conflict' };
            if (existing.itemCount < 1) {
              throw new Error('Affected enrichment snapshot is not sealed.');
            }
            return {
              ok: true,
              value: {
                id,
                scope,
                itemCount: existing.itemCount,
                createdAt: existing.createdAt.toISOString(),
              },
            };
          }
          const createdAt = this.now();
          await tx.insert(enrichmentSnapshots).values({
            id,
            tenantId: ctx.tenantId,
            scope: record,
            itemCount: 0,
            createdBy: ctx.userId,
            createdAt,
          });
          await tx.insert(enrichmentSnapshotItems).select(
            tx.select({
              snapshotId: sql<string>`${id}::uuid`.as('snapshot_id'),
              tenantId: enrichmentSnapshotItems.tenantId,
              questionId: enrichmentSnapshotItems.questionId,
              revisionId: enrichmentSnapshotItems.revisionId,
            }).from(enrichmentSnapshotItems).where(and(
              eq(enrichmentSnapshotItems.snapshotId, rootSnapshotId),
              eq(enrichmentSnapshotItems.tenantId, ctx.tenantId),
              enrichmentAffectedSql(ctx.tenantId, base.schemeId, base.version, removedValues),
            )),
          );
          const [total] = await tx.select({ value: count() }).from(enrichmentSnapshotItems).where(
            eq(enrichmentSnapshotItems.snapshotId, id),
          );
          if (!total.value) {
            await tx.delete(enrichmentSnapshots).where(eq(enrichmentSnapshots.id, id));
            return { ok: false, code: 'empty_scope' };
          }
          await tx.update(enrichmentSnapshots).set({ itemCount: total.value }).where(
            eq(enrichmentSnapshots.id, id),
          );
          return {
            ok: true,
            value: { id, scope, itemCount: total.value, createdAt: createdAt.toISOString() },
          };
        },
      );
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }
}

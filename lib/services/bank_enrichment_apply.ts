import { loadCurrentEnrichmentChanges } from './bank_enrichment_changes.ts';
import { and, eq, inArray } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { enrichmentBatches, enrichmentRunItems } from '../db/bank_enrichment_job_schema.ts';
import { enrichmentAssignments, enrichmentChanges } from '../db/bank_enrichment_schema.ts';
import { questions } from '../db/question_schema.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { ENRICHMENT_DIMENSIONS, type EnrichmentResult } from './bank_enrichment_contract.ts';
import { planEnrichmentWrites } from './bank_enrichment_apply_policy.ts';
import { parseClassificationOutput } from './bank_enrichment_classifier.ts';
import {
  type EnrichmentBatchProgress,
  type EnrichmentJobFailure,
  parseEnrichmentBaseline,
} from './bank_enrichment_job_contract.ts';
import {
  completedCount,
  type EnrichmentClaim,
  lockEnrichmentClaim,
  releaseEnrichmentStep,
} from './bank_enrichment_worker_store.ts';
import { loadEnrichmentSources } from './bank_enrichment_sources.ts';
import { jobStorageFailure } from './bank_enrichment_jobs.ts';

/** Apply a recorded batch under its lease and compare current tokens immediately before writing. */
export async function applyEnrichmentBatch(
  database: QflowDatabase,
  claim: Extract<EnrichmentClaim, { kind: 'classify' }>,
  sequence: number,
  now: Date,
): Promise<EnrichmentResult<EnrichmentBatchProgress, EnrichmentJobFailure>> {
  try {
    return await database.transaction(async (tx) => {
      if (!await lockEnrichmentClaim(tx, claim, now)) {
        return { ok: false, code: 'lease_lost' } as const;
      }
      const [batch] = await tx.select().from(enrichmentBatches).where(
        and(eq(enrichmentBatches.runId, claim.id), eq(enrichmentBatches.sequence, sequence)),
      ).for('update');
      if (!batch) return { ok: false, code: 'not_found' } as const;
      if (batch.state === 'applied') {
        await releaseEnrichmentStep(tx, claim, now);
        return {
          ok: true,
          value: { state: 'more', completed: await completedCount(tx, claim.id) },
        } as const;
      }
      if (batch.state !== 'received') return { ok: false, code: 'invalid_transition' } as const;
      const ids = parseEnrichmentBatchIds(batch.questionIds);
      if (!ids) throw new Error('Invalid persisted batch question IDs.');
      const items = await tx.select().from(enrichmentRunItems).where(
        and(eq(enrichmentRunItems.runId, claim.id), inArray(enrichmentRunItems.questionId, ids)),
      ).orderBy(enrichmentRunItems.questionId);
      if (items.length !== ids.length) throw new Error('Batch scope references are missing.');
      const sources = await loadEnrichmentSources(tx, claim.ctx.tenantId, items);
      const supported = sources.flatMap((source) =>
        source.content.ok ? [source.content.value] : []
      );
      const classifications = parseClassificationOutput(
        JSON.stringify({ items: batch.response }),
        claim.definition,
        supported,
      );
      if (!classifications) {
        throw new Error('Persisted enrichment batch failed classification validation.');
      }
      const latest = await tx.select({ id: questions.id, revisionId: questions.latestRevisionId })
        .from(questions).where(
          and(eq(questions.tenantId, claim.ctx.tenantId), inArray(questions.id, ids)),
        ).orderBy(questions.id).for('update');
      const currentRows = await loadCurrentEnrichmentChanges(
        tx,
        claim.ctx.tenantId,
        claim.run.schemeId,
        ids,
      );
      const changes: typeof enrichmentChanges.$inferInsert[] = [];
      const assignments: typeof enrichmentAssignments.$inferInsert[] = [];
      for (const item of items) {
        if (item.state !== 'pending') continue;
        const setOutcome = async (state: string, detail: unknown) => {
          await tx.update(enrichmentRunItems).set({ state, detail }).where(
            and(
              eq(enrichmentRunItems.runId, claim.id),
              eq(enrichmentRunItems.questionId, item.questionId),
            ),
          );
        };
        if (latest.find((q) => q.id === item.questionId)?.revisionId !== item.revisionId) {
          await setOutcome('outdated', { code: 'source_revision_changed' });
          continue;
        }
        const source = sources.find((s) => s.questionId === item.questionId);
        if (!source) throw new Error('Enrichment source projection is missing.');
        if (!source.content.ok) {
          await setOutcome('unassigned', {
            code: source.content.code,
            reason: 'unsupported_content',
          });
          continue;
        }
        const classification = classifications.find((q) => q.questionId === item.questionId);
        const baseline = parseEnrichmentBaseline(item.baseline);
        if (!classification || !baseline) {
          throw new Error('Invalid persisted enrichment application input.');
        }
        const current = currentRows.get(item.questionId);
        if (!current) throw new Error('Missing current enrichment values.');
        const plan = planEnrichmentWrites({
          baseline,
          current,
          classification: classification.classification,
          definition: claim.definition,
          dimensions: claim.command.dimensions,
          replacement: claim.command.replacement,
        });
        for (const dimension of ENRICHMENT_DIMENSIONS) {
          const value = plan.writes[dimension];
          if (!value) continue;
          const id = await uuidV5(claim.id, `classification:${item.questionId}:${dimension}`);
          changes.push({
            id,
            tenantId: claim.ctx.tenantId,
            schemeId: claim.run.schemeId,
            versionId: claim.run.versionId,
            questionId: item.questionId,
            revisionId: item.revisionId,
            dimension,
            value,
            origin: 'ai',
            operationId: claim.id,
            previousChangeId: current[dimension]?.changeId ?? null,
            createdBy: claim.ctx.userId,
            createdAt: now,
          });
          assignments.push({
            tenantId: claim.ctx.tenantId,
            schemeId: claim.run.schemeId,
            questionId: item.questionId,
            dimension,
            changeId: id,
          });
        }
        const protectedDimensions = Object.keys(plan.protected);
        const unassigned = claim.command.dimensions.some((dimension) =>
          classification.classification[dimension].state === 'unassigned'
        );
        await setOutcome(
          protectedDimensions.length ? 'protected' : unassigned ? 'unassigned' : 'classified',
          {
            protected: plan.protected,
            written: Object.keys(plan.writes),
            rationale: classification.rationale,
          },
        );
      }
      if (changes.length) {
        await tx.insert(enrichmentChanges).values(changes);
        for (const assignment of assignments) {
          await tx.insert(enrichmentAssignments).values(assignment).onConflictDoUpdate({
            target: [
              enrichmentAssignments.tenantId,
              enrichmentAssignments.schemeId,
              enrichmentAssignments.questionId,
              enrichmentAssignments.dimension,
            ],
            set: { changeId: assignment.changeId },
          });
        }
      }
      await tx.update(enrichmentBatches).set({ state: 'applied', updatedAt: now }).where(
        and(eq(enrichmentBatches.runId, claim.id), eq(enrichmentBatches.sequence, sequence)),
      );
      await releaseEnrichmentStep(tx, claim, now);
      return {
        ok: true,
        value: { state: 'more', completed: await completedCount(tx, claim.id) },
      } as const;
    });
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
}

/** Bounded stored selection parser shared by processing and application. */
export function parseEnrichmentBatchIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 20) return null;
  const ids: string[] = [];
  for (const id of value) {
    if (
      typeof id !== 'string' || !isCanonicalUuid(id)
    ) return null;
    ids.push(id);
  }
  return new Set(ids).size === ids.length ? ids : null;
}

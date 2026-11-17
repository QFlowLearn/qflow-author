import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import {
  enrichmentBatches,
  enrichmentRunItems,
  enrichmentRuns,
} from '../db/bank_enrichment_job_schema.ts';
import { questionRevisions } from '../db/question_schema.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import type { EnrichmentClassifiedQuestion } from './bank_enrichment_classifier.ts';
import {
  completedCount,
  type EnrichmentClaim,
  lockEnrichmentClaim,
  releaseEnrichmentStep,
} from './bank_enrichment_worker_store.ts';
import type {
  EnrichmentBatchProgress,
  EnrichmentJobFailure,
} from './bank_enrichment_job_contract.ts';
import { jobStorageFailure } from './bank_enrichment_jobs.ts';
import { readEnrichmentRunProgress } from './bank_enrichment_progress.ts';

/** Batch identities and receipts remain fixed even when their provider attempt changes. */
export type EnrichmentBatch = typeof enrichmentBatches.$inferSelect;

/** Create or recover the next bounded batch without repeating previously applied questions. */
export async function nextEnrichmentBatch(
  database: QflowDatabase,
  claim: Extract<EnrichmentClaim, { kind: 'classify' }>,
  now: Date,
): Promise<EnrichmentResult<EnrichmentBatch | EnrichmentBatchProgress, EnrichmentJobFailure>> {
  try {
    return await database.transaction(async (tx) => {
      if (!await lockEnrichmentClaim(tx, claim, now)) {
        return { ok: false, code: 'lease_lost' } as const;
      }
      const [existing] = await tx.select().from(enrichmentBatches).where(
        and(
          eq(enrichmentBatches.runId, claim.id),
          inArray(enrichmentBatches.state, ['reserved', 'received']),
        ),
      ).orderBy(asc(enrichmentBatches.sequence)).limit(1);
      if (existing) return { ok: true, value: existing } as const;
      const candidates = await tx.select({
        questionId: enrichmentRunItems.questionId,
        bytes: sql<number>`octet_length(${questionRevisions.body}::text)`.mapWith(Number),
      })
        .from(enrichmentRunItems).innerJoin(
          questionRevisions,
          eq(questionRevisions.id, enrichmentRunItems.revisionId),
        ).where(
          and(eq(enrichmentRunItems.runId, claim.id), eq(enrichmentRunItems.state, 'pending')),
        ).orderBy(enrichmentRunItems.questionId).limit(20);
      if (!candidates.length) {
        const progress = await readEnrichmentRunProgress(
          tx,
          claim.ctx.tenantId,
          claim.id,
          claim.snapshotId,
        );
        if (progress.counts.pending !== 0) {
          throw new Error('Enrichment pending sources are missing.');
        }
        const issues = progress.counts.classified !== progress.total;
        await tx.update(enrichmentRuns).set({
          state: issues ? 'completed_with_issues' : 'completed',
          result: { counts: progress.counts },
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: now,
        }).where(eq(enrichmentRuns.id, claim.id));
        return {
          ok: true,
          value: { state: 'completed', completed: progress.completed },
        } as const;
      }
      const ids: string[] = [];
      let bytes = 0;
      for (const candidate of candidates) {
        const size = Math.min(candidate.bytes, 16384);
        if (ids.length && bytes + size > 80_000) break;
        ids.push(candidate.questionId);
        bytes += size;
      }
      const [sequence] = await tx.select({
        value: sql<number>`COALESCE(max(${enrichmentBatches.sequence}), -1) + 1`.mapWith(Number),
      }).from(enrichmentBatches).where(eq(enrichmentBatches.runId, claim.id));
      const [batch] = await tx.insert(enrichmentBatches).values({
        runId: claim.id,
        tenantId: claim.ctx.tenantId,
        schemeId: claim.run.schemeId,
        sequence: sequence.value,
        state: 'reserved',
        questionIds: ids,
        attempts: 0,
        inputTokens: 0,
        outputTokens: 0,
        createdAt: now,
        updatedAt: now,
      }).returning();
      return { ok: true, value: batch } as const;
    });
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
}

/** Reserve a new application attempt only when no earlier receipt can be recovered. */
export async function beginEnrichmentAttempt(
  database: QflowDatabase,
  claim: EnrichmentClaim,
  batch: EnrichmentBatch,
  attemptId: string,
  now: Date,
): Promise<EnrichmentResult<string, EnrichmentJobFailure>> {
  try {
    return await database.transaction(async (tx) => {
      if (!await lockEnrichmentClaim(tx, claim, now)) {
        return { ok: false, code: 'lease_lost' } as const;
      }
      const [current] = await tx.select().from(enrichmentBatches).where(
        and(eq(enrichmentBatches.runId, claim.id), eq(enrichmentBatches.sequence, batch.sequence)),
      ).for('update');
      if (current.attemptId) return { ok: true, value: current.attemptId } as const;
      if (current.retriesRemaining < 1 || current.state !== 'reserved') {
        return { ok: false, code: 'invalid_transition' } as const;
      }
      await tx.update(enrichmentBatches).set({
        attemptId,
        attempts: current.attempts + 1,
        retriesRemaining: current.retriesRemaining - 1,
        updatedAt: now,
      }).where(
        and(eq(enrichmentBatches.runId, claim.id), eq(enrichmentBatches.sequence, batch.sequence)),
      );
      return { ok: true, value: attemptId } as const;
    });
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
}

/** Store a validated response before the assignment transaction, including zero supported items. */
export async function checkpointEnrichmentBatch(
  database: QflowDatabase,
  claim: EnrichmentClaim,
  batch: EnrichmentBatch,
  items: readonly EnrichmentClassifiedQuestion[],
  usage: { inputTokens: number; outputTokens: number },
  now: Date,
): Promise<EnrichmentResult<void, EnrichmentJobFailure>> {
  try {
    return await database.transaction(async (tx) => {
      if (!await lockEnrichmentClaim(tx, claim, now)) {
        return { ok: false, code: 'lease_lost' } as const;
      }
      await tx.update(enrichmentBatches).set({
        state: 'received',
        response: items,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        errorCode: null,
        updatedAt: now,
      }).where(
        and(
          eq(enrichmentBatches.runId, claim.id),
          eq(enrichmentBatches.sequence, batch.sequence),
          eq(enrichmentBatches.state, 'reserved'),
        ),
      );
      return { ok: true, value: undefined } as const;
    });
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
}

/** One retry policy consumes persisted attempts; exhausted batches retain explicit failure outcomes. */
export async function failEnrichmentBatch(
  database: QflowDatabase,
  claim: EnrichmentClaim,
  batch: EnrichmentBatch,
  questionIds: readonly string[],
  code: string,
  retryable: boolean,
  now: Date,
): Promise<EnrichmentResult<EnrichmentBatchProgress, EnrichmentJobFailure>> {
  try {
    return await database.transaction(async (tx) => {
      if (!await lockEnrichmentClaim(tx, claim, now)) {
        return { ok: false, code: 'lease_lost' } as const;
      }
      const [current] = await tx.select().from(enrichmentBatches).where(
        and(eq(enrichmentBatches.runId, claim.id), eq(enrichmentBatches.sequence, batch.sequence)),
      ).for('update');
      const retry = retryable && current.retriesRemaining > 0;
      await tx.update(enrichmentBatches).set({
        state: retry ? 'reserved' : 'failed',
        attemptId: null,
        errorCode: code,
        updatedAt: now,
      }).where(
        and(eq(enrichmentBatches.runId, claim.id), eq(enrichmentBatches.sequence, batch.sequence)),
      );
      if (!retry) {
        await tx.update(enrichmentRunItems).set({ state: 'failed', detail: { code } }).where(
          and(
            eq(enrichmentRunItems.runId, claim.id),
            inArray(enrichmentRunItems.questionId, [...questionIds]),
            eq(enrichmentRunItems.state, 'pending'),
          ),
        );
      }
      await releaseEnrichmentStep(tx, claim, now);
      return {
        ok: true,
        value: { state: retry ? 'retry' : 'more', completed: await completedCount(tx, claim.id) },
      } as const;
    });
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
}

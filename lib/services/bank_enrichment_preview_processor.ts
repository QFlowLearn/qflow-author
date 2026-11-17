import { and, eq } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { enrichmentPreviews } from '../db/bank_enrichment_task_schema.ts';
import { enrichmentCostMicros } from '../ai/bank_enrichment_config.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import {
  type BankEnrichmentAnalysis,
  estimateEnrichmentRunMicros,
} from './bank_enrichment_analysis.ts';
import {
  type EnrichmentBatchProgress,
  type EnrichmentJobFailure,
  parseEnrichmentPreviewInput,
} from './bank_enrichment_job_contract.ts';
import {
  type EnrichmentClaim,
  failEnrichmentClaim,
  lockEnrichmentClaim,
  releaseEnrichmentStep,
} from './bank_enrichment_worker_store.ts';
import { BankEnrichmentSampler } from './bank_enrichment_sample.ts';
import {
  parseStoredEnrichmentProposal,
  parseStoredEnrichmentSample,
} from './bank_enrichment_preview_codec.ts';
import { loadEnrichmentSources } from './bank_enrichment_sources.ts';
import { jobStorageFailure } from './bank_enrichment_jobs.ts';

/** Preview work advances through proposal and measured classification without assigning tags. */
export async function processEnrichmentPreview(
  database: QflowDatabase,
  claim: Extract<EnrichmentClaim, { kind: 'preview' }>,
  analysis: BankEnrichmentAnalysis,
  now: () => Date,
  newId: () => string,
): Promise<EnrichmentResult<EnrichmentBatchProgress, EnrichmentJobFailure>> {
  const command = parseEnrichmentPreviewInput({
    seed: claim.preview.seed,
    baseVersionId: claim.preview.baseVersionId,
    audience: claim.preview.audience,
    definition: claim.preview.definition,
  });
  if (!command) return await failEnrichmentClaim(database, claim, 'invalid_stored_input', now());
  let sample = claim.preview.sample === null
    ? null
    : parseStoredEnrichmentSample(claim.preview.sample);
  if (claim.preview.sample !== null && !sample) {
    return await failEnrichmentClaim(database, claim, 'invalid_stored_sample', now());
  }
  if (!sample) {
    const sampled = await new BankEnrichmentSampler(database).sample(
      claim.ctx,
      claim.snapshotId,
      command.seed,
    );
    if (!sampled.ok) return await failEnrichmentClaim(database, claim, sampled.code, now());
    sample = sampled.value;
    try {
      const saved = await database.transaction(async (tx) => {
        if (!await lockEnrichmentClaim(tx, claim, now())) return false;
        await tx.update(enrichmentPreviews).set({ sample, updatedAt: now() }).where(
          eq(enrichmentPreviews.id, claim.id),
        );
        return true;
      });
      if (!saved) return { ok: false, code: 'lease_lost' };
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }
  if (!sample.questions.length) {
    return await failEnrichmentClaim(database, claim, 'unsupported_content', now());
  }
  const attempt = await beginPreviewAttempt(database, claim, newId(), now());
  if (!attempt.ok) return attempt;
  const signal = AbortSignal.timeout(90_000);
  if (claim.preview.phase === 'propose') {
    const proposal = await analysis.propose(
      claim.ctx,
      claim.id,
      attempt.value,
      command.audience,
      sample.questions,
      { signal },
    );
    if (!proposal.ok) return await failPreviewAttempt(database, claim, proposal.code, now());
    try {
      return await database.transaction(async (tx) => {
        if (!await lockEnrichmentClaim(tx, claim, now())) {
          return { ok: false, code: 'lease_lost' } as const;
        }
        await tx.update(enrichmentPreviews).set({
          proposal: proposal.value.result,
          phase: 'measure',
          attemptId: null,
          retriesRemaining: 3,
          updatedAt: now(),
        }).where(eq(enrichmentPreviews.id, claim.id));
        await releaseEnrichmentStep(tx, claim, now());
        return { ok: true, value: { state: 'more', completed: 0 } } as const;
      });
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }
  if (claim.preview.phase !== 'measure') {
    return await failEnrichmentClaim(database, claim, 'invalid_stored_phase', now());
  }
  const definition = command.definition ??
    parseStoredEnrichmentProposal(claim.preview.proposal, sample)?.definition;
  if (!definition) {
    return await failEnrichmentClaim(database, claim, 'invalid_stored_proposal', now());
  }
  const examples = await loadEnrichmentSources(database, claim.ctx.tenantId, definition.examples);
  if (examples.some((example) => !example.content.ok)) {
    return await failEnrichmentClaim(database, claim, 'unsupported_example', now());
  }
  const exampleQuestions = examples.flatMap((example) =>
    example.content.ok ? [example.content.value] : []
  );
  const measuredQuestions = sample.questions.slice(0, 20);
  const measured = await analysis.classify(
    claim.ctx,
    claim.id,
    attempt.value,
    definition,
    measuredQuestions,
    { signal, examples: exampleQuestions },
  );
  if (!measured.ok) return await failPreviewAttempt(database, claim, measured.code, now());
  const measuredCostMicros = enrichmentCostMicros(
    claim.configuration,
    measured.value.usage.inputTokens,
    measured.value.usage.outputTokens,
  );
  const estimatedRunMicros = estimateEnrichmentRunMicros(
    measuredCostMicros,
    measuredQuestions.length,
    sample.scopeCount,
  );
  if (estimatedRunMicros === null) {
    return await failEnrichmentClaim(database, claim, 'invalid_estimate', now());
  }
  const result = {
    definition,
    examples: measured.value.result.slice(0, 10),
    measuredQuestionCount: measuredQuestions.length,
    measuredCostMicros,
    estimatedRunMicros,
    elapsedMs: Math.max(0, now().getTime() - claim.preview.createdAt.getTime()),
  };
  try {
    return await database.transaction(async (tx) => {
      if (!await lockEnrichmentClaim(tx, claim, now())) {
        return { ok: false, code: 'lease_lost' } as const;
      }
      await tx.update(enrichmentPreviews).set({
        state: 'completed',
        result,
        errorCode: null,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now(),
      }).where(eq(enrichmentPreviews.id, claim.id));
      return { ok: true, value: { state: 'completed', completed: 0 } } as const;
    });
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
}

async function beginPreviewAttempt(
  database: QflowDatabase,
  claim: Extract<EnrichmentClaim, { kind: 'preview' }>,
  attemptId: string,
  now: Date,
): Promise<EnrichmentResult<string, EnrichmentJobFailure>> {
  try {
    return await database.transaction(async (tx) => {
      if (!await lockEnrichmentClaim(tx, claim, now)) {
        return { ok: false, code: 'lease_lost' } as const;
      }
      const [preview] = await tx.select().from(enrichmentPreviews).where(
        eq(enrichmentPreviews.id, claim.id),
      );
      if (preview.attemptId) return { ok: true, value: preview.attemptId } as const;
      if (preview.retriesRemaining < 1) return { ok: false, code: 'invalid_transition' } as const;
      await tx.update(enrichmentPreviews).set({
        attemptId,
        attempts: preview.attempts + 1,
        retriesRemaining: preview.retriesRemaining - 1,
        updatedAt: now,
      }).where(eq(enrichmentPreviews.id, claim.id));
      return { ok: true, value: attemptId } as const;
    });
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
}
async function failPreviewAttempt(
  database: QflowDatabase,
  claim: EnrichmentClaim,
  code: string,
  now: Date,
): Promise<EnrichmentResult<EnrichmentBatchProgress, EnrichmentJobFailure>> {
  try {
    return await database.transaction(async (tx) => {
      if (!await lockEnrichmentClaim(tx, claim, now)) {
        return { ok: false, code: 'lease_lost' } as const;
      }
      const [preview] = await tx.select().from(enrichmentPreviews).where(
        eq(enrichmentPreviews.id, claim.id),
      );
      const retry =
        ['provider_failed', 'in_flight', 'aborted', 'invalid_response', 'request_changed'].includes(
          code,
        ) &&
        preview.retriesRemaining > 0;
      await tx.update(enrichmentPreviews).set({
        state: retry ? 'running' : 'failed',
        attemptId: null,
        errorCode: code,
        leaseToken: retry ? claim.token : null,
        leaseExpiresAt: retry ? now : null,
        updatedAt: now,
      }).where(
        and(eq(enrichmentPreviews.id, claim.id), eq(enrichmentPreviews.leaseToken, claim.token)),
      );
      return { ok: true, value: { state: retry ? 'retry' : 'failed', completed: 0 } } as const;
    });
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
}

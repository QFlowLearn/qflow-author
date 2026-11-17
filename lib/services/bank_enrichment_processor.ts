import { enrichmentTasks } from '../db/bank_enrichment_task_schema.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { processEnrichmentMutation } from './bank_enrichment_mutation_processor.ts';
import { and, eq, inArray } from 'drizzle-orm';
import type { EnrichmentAIConfig } from '../ai/bank_enrichment_config.ts';
import type { EnrichmentAIProvider } from '../ai/bank_enrichment_provider.ts';
import type { QflowDatabase } from '../db.ts';
import { enrichmentRunItems } from '../db/bank_enrichment_job_schema.ts';
import type { QflowWorkflowInvocation } from '../workflows/job_workflows.ts';
import { BankEnrichmentAnalysis } from './bank_enrichment_analysis.ts';
import { applyEnrichmentBatch, parseEnrichmentBatchIds } from './bank_enrichment_apply.ts';
import {
  beginEnrichmentAttempt,
  checkpointEnrichmentBatch,
  failEnrichmentBatch,
  nextEnrichmentBatch,
} from './bank_enrichment_batch_store.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import type {
  EnrichmentBatchProgress,
  EnrichmentJobFailure,
} from './bank_enrichment_job_contract.ts';
import { jobStorageFailure } from './bank_enrichment_jobs.ts';
import { processEnrichmentPreview } from './bank_enrichment_preview_processor.ts';
import { loadEnrichmentSources } from './bank_enrichment_sources.ts';
import { BankEnrichmentUsage } from './bank_enrichment_usage.ts';
import {
  claimEnrichmentStep,
  failEnrichmentClaim,
  lockEnrichmentClaim,
} from './bank_enrichment_worker_store.ts';

/** Capabilities are created inside each durable step, never reused across a runtime hop. */
export type EnrichmentWorkerServices = {
  readonly database: QflowDatabase;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly provider: (config: EnrichmentAIConfig) => EnrichmentAIProvider;
};

/** Process one bounded step, recovering receipts before considering a fresh provider request. */
export async function processEnrichmentStep(
  params: QflowWorkflowInvocation,
  services: EnrichmentWorkerServices,
): Promise<EnrichmentResult<EnrichmentBatchProgress, EnrichmentJobFailure>> {
  const { database, now, newId } = services;
  if (![params.jobId, params.workflowExecutionId].every(isCanonicalUuid)) {
    return { ok: false, code: 'invalid_input' };
  }
  try {
    const [task] = await database.select({ kind: enrichmentTasks.kind }).from(enrichmentTasks)
      .where(eq(enrichmentTasks.id, params.jobId));
    if (!task) return { ok: false, code: 'not_found' };
    if (task.kind === 'correct' || task.kind === 'undo') {
      return await processEnrichmentMutation(database, params, now(), newId());
    }
    if (task.kind !== 'classify' && task.kind !== 'preview') {
      throw new Error('Invalid enrichment task kind.');
    }
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
  const claimed = await claimEnrichmentStep(
    database,
    now(),
    params.jobId,
    params.workflowExecutionId,
    newId(),
  );
  if (!claimed.ok) return claimed;
  if (claimed.value.kind === 'progress') return { ok: true, value: claimed.value.progress };
  const claim = claimed.value.claim;
  const analysis = new BankEnrichmentAnalysis(
    new BankEnrichmentUsage(database, now, {
      authorizeDispatch: (tx) => lockEnrichmentClaim(tx, claim, now()),
    }),
    services.provider,
  );
  try {
    if (claim.kind === 'preview') {
      return await processEnrichmentPreview(database, claim, analysis, now, newId);
    }
    const next = await nextEnrichmentBatch(database, claim, now());
    if (!next.ok) return next;
    if (!('sequence' in next.value)) return { ok: true, value: next.value };
    const batch = next.value;
    if (batch.state === 'received') {
      return await applyEnrichmentBatch(database, claim, batch.sequence, now());
    }
    const ids = parseEnrichmentBatchIds(batch.questionIds);
    if (!ids) return await failEnrichmentClaim(database, claim, 'invalid_batch', now());
    const refs = await database.select({
      questionId: enrichmentRunItems.questionId,
      revisionId: enrichmentRunItems.revisionId,
    }).from(enrichmentRunItems).where(
      and(eq(enrichmentRunItems.runId, claim.id), inArray(enrichmentRunItems.questionId, ids)),
    ).orderBy(enrichmentRunItems.questionId);
    if (refs.length !== ids.length) {
      return await failEnrichmentClaim(database, claim, 'missing_batch_sources', now());
    }
    const sources = await loadEnrichmentSources(database, claim.ctx.tenantId, refs);
    const questions = sources.flatMap((source) => source.content.ok ? [source.content.value] : []);
    if (!questions.length) {
      const saved = await checkpointEnrichmentBatch(database, claim, batch, [], {
        inputTokens: 0,
        outputTokens: 0,
      }, now());
      return saved.ok ? await applyEnrichmentBatch(database, claim, batch.sequence, now()) : saved;
    }
    const examples = await loadEnrichmentSources(
      database,
      claim.ctx.tenantId,
      claim.definition.examples,
    );
    if (examples.some((source) => !source.content.ok)) {
      return await failEnrichmentClaim(database, claim, 'unsupported_example', now());
    }
    const exampleQuestions = examples.flatMap((source) =>
      source.content.ok ? [source.content.value] : []
    );
    const attempt = await beginEnrichmentAttempt(database, claim, batch, newId(), now());
    if (!attempt.ok) return attempt;
    const classified = await analysis.classify(
      claim.ctx,
      claim.id,
      attempt.value,
      claim.definition,
      questions,
      { signal: AbortSignal.timeout(90_000), examples: exampleQuestions },
    );
    if (!classified.ok) {
      if (classified.code === 'budget_exceeded') {
        return await failEnrichmentClaim(database, claim, 'budget_exceeded', now());
      }
      if (classified.code === 'storage_failed') return { ok: false, code: 'storage_failed' };
      return await failEnrichmentBatch(
        database,
        claim,
        batch,
        ids,
        classified.code,
        ['provider_failed', 'in_flight', 'aborted', 'invalid_response', 'request_changed'].includes(
          classified.code,
        ),
        now(),
      );
    }
    const saved = await checkpointEnrichmentBatch(
      database,
      claim,
      batch,
      classified.value.result,
      classified.value.usage,
      now(),
    );
    return saved.ok ? await applyEnrichmentBatch(database, claim, batch.sequence, now()) : saved;
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
}

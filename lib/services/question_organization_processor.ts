import { recordOrganizationNotice } from './question_organization_notices.ts';
import { processOrganizationUndoStep } from './question_organization_undo.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { organizationItems, organizationRuns } from '../db/question_organization_schema.ts';
import { questionRevisions } from '../db/question_schema.ts';
import { mapConcurrentBounded } from '../bounded_concurrency.ts';
import { planClefOrganizationBatches } from '../ai/clef_organization_provider.ts';
import type { QflowWorkflowInvocation } from '../workflows/job_workflows.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import type {
  EnrichmentBatchProgress,
  EnrichmentJobFailure,
} from './bank_enrichment_job_contract.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import { loadOrganizationRun, type OrganizationRun } from './question_organization_read.ts';
import { prepareEnrichmentQuestion } from './bank_enrichment_input.ts';
import { loadEnrichmentSources } from './bank_enrichment_sources.ts';
import { claimOrganizationBatch } from './question_organization_claim.ts';
import { checkpointOrganizationBatch } from './question_organization_checkpoint.ts';
import type {
  ClaimedItem,
  ItemOutcome,
  OrganizationWorkerServices,
  PreparedWork,
} from './question_organization_work.ts';
export type { OrganizationWorkerServices } from './question_organization_work.ts';

/** Process twenty questions at most. Every transaction ends before any model request starts. */
export async function processOrganizationStep(
  params: QflowWorkflowInvocation,
  services: OrganizationWorkerServices,
): Promise<EnrichmentResult<EnrichmentBatchProgress, EnrichmentJobFailure>> {
  const { database, now } = services;
  try {
    const context = await loadOrganizationRun(database, params.jobId, params.workflowExecutionId, {
      kind: 'execution_actor',
    });
    if (!context) return { ok: false, code: 'not_found' };
    if (context.run.state === 'undoing') {
      return await processOrganizationUndoStep(context, database, now());
    }
    if (context.run.state !== 'queued') {
      return {
        ok: true,
        value: {
          state: ['completed', 'undone'].includes(context.run.state) ? 'completed' : 'failed',
          completed: await completedCount(database, context.run.id),
        },
      };
    }
    const authorized = await database.transaction((tx) =>
      authorizeEnrichment(tx, context.ctx, 'manage_content')
    );
    if (!authorized) return { ok: false, code: 'forbidden' };
    const candidates = await database.select({ id: organizationItems.questionId }).from(
      organizationItems,
    ).where(
      and(
        eq(organizationItems.runId, context.run.id),
        inArray(organizationItems.state, ['pending', 'processing', 'received']),
        or(isNull(organizationItems.leaseExpiresAt), lte(organizationItems.leaseExpiresAt, now())),
      ),
    ).orderBy(organizationItems.questionId).limit(20);
    if (!candidates.length) return await finishStep(context, services, false);
    const started = performance.now();
    const claims = await claimOrganizationBatch(context, candidates.map((c) => c.id), services);
    const prepared = await prepareBatch(context, claims, database);
    const preparedAt = performance.now();
    let checkpoint: Promise<void> = Promise.resolve();
    let checkpointMs = 0, providerMs = 0, requestCount = 0;
    const save = (results: readonly { claim: ClaimedItem; outcome: ItemOutcome }[]) => {
      const write = checkpoint.then(async () => {
        const start = performance.now();
        await checkpointOrganizationBatch(context, results, services);
        checkpointMs += performance.now() - start;
      });
      // Each caller observes its own failure; a failed application must not discard
      // the receipts of other requests that have already been paid for.
      checkpoint = write.catch(() => {});
      return write;
    };
    const ready = prepared.flatMap(({ claim, work }) =>
      work.kind === 'inference' ? [] : [{ claim, outcome: work }]
    );
    if (ready.length) await save(ready);
    const inference = prepared.flatMap(({ claim, work }) =>
      work.kind === 'inference' ? [{ claim, work }] : []
    );
    if (inference.length) {
      if (context.policy.classifier.kind !== 'clef') {
        throw new Error('Source-only organization attempted inference.');
      }
      const config = context.policy.classifier.config;
      const teaching = inference[0].work.teaching;
      const batches = planClefOrganizationBatches(
        inference.map((i) => i.work.question),
        context.definition,
        teaching,
      );
      // All request waves share a deadline shorter than the item lease and Workflow step.
      const signal = AbortSignal.timeout(90_000);
      const settled = await mapConcurrentBounded(batches, { concurrency: 4 }, async (batch) => {
        try {
          const start = performance.now();
          const result = await services.provider(config)(batch, context.definition, teaching, {
            signal,
          });
          providerMs += performance.now() - start;
          requestCount++;
          const results = batch.map((question): { claim: ClaimedItem; outcome: ItemOutcome } => {
            const claim = inference.find((i) =>
              i.claim.item.questionId === question.questionId
            )!.claim;
            if (!result.ok) return { claim, outcome: { kind: 'failure', code: result.code } };
            const decision = result.value.find((r) => r.questionId === question.questionId);
            if (!decision) throw new Error('Validated Clef batch omitted a question.');
            return {
              claim,
              outcome: {
                kind: 'decision',
                value: { kind: 'clef', receipt: decision.receipt },
                chargedMicros: decision.chargedMicros,
              },
            };
          });
          // Save each completed request immediately; a slower sibling cannot hold its receipts in memory.
          await save(results);
          return { ok: true } as const;
        } catch (cause) {
          return { ok: false, cause } as const;
        }
      });
      // Finish every owned request before reporting a storage failure to the Workflow.
      const failed = settled.find((result) => !result.ok);
      if (failed && !failed.ok) throw failed.cause;
    }
    const result = await finishStep(context, services, true);
    console.info('Organization step timing', {
      runId: context.run.id,
      questions: claims.length,
      requests: requestCount,
      prepareMs: Math.round(preparedAt - started),
      providerMs: Math.round(providerMs),
      checkpointMs: Math.round(checkpointMs),
      totalMs: Math.round(performance.now() - started),
    });
    return result;
  } catch (cause) {
    console.error('Question organization persistence failed', safeErrorSummary(cause));
    return { ok: false, code: 'storage_failed' };
  }
}

async function finishStep(
  context: OrganizationRun,
  services: OrganizationWorkerServices,
  hadCandidates: boolean,
) {
  const { database } = services;
  return await database.transaction(async (tx) => {
    const [run] = await tx.select().from(organizationRuns).where(
      eq(organizationRuns.id, context.run.id),
    ).for('update');
    const [counts] = await tx.select({
      pending: sql<
        number
      >`count(*) FILTER (WHERE ${organizationItems.state} IN ('pending','processing','received'))`
        .mapWith(Number),
      failed: sql<
        number
      >`count(*) FILTER (WHERE ${organizationItems.state} IN ('failed','cancelled'))`.mapWith(
        Number,
      ),
      total: sql<number>`count(*)`.mapWith(Number),
    }).from(organizationItems).where(eq(organizationItems.runId, run.id));
    if (run.executionId !== context.run.executionId) {
      return { ok: false, code: 'not_found' } as const;
    }
    if (run.state !== 'queued') {
      return {
        ok: true,
        value: {
          state: run.state === 'completed' ? 'completed' : 'failed',
          completed: counts.total - counts.pending,
        },
      } as const;
    }
    if (counts.pending === 0) {
      await tx.update(organizationRuns).set({ state: counts.failed ? 'failed' : 'completed' })
        .where(eq(organizationRuns.id, run.id));
      await recordOrganizationNotice(tx, run);
    }
    return {
      ok: true,
      value: {
        state: counts.pending
          ? hadCandidates ? 'more' : 'busy'
          : counts.failed
          ? 'failed'
          : 'completed',
        completed: counts.total - counts.pending,
      },
    } as const;
  });
}

function fixedWork(claim: ClaimedItem): ItemOutcome | null {
  if (claim.item.state === 'received') return { kind: 'received' };
  if (claim.decision !== null) return { kind: 'decision', value: claim.decision, chargedMicros: 0 };
  return null;
}
async function prepareBatch(
  context: OrganizationRun,
  claims: readonly ClaimedItem[],
  database: QflowDatabase,
): Promise<readonly { claim: ClaimedItem; work: PreparedWork }[]> {
  const pending = claims.filter((c) => fixedWork(c) === null);
  if (!pending.length) return claims.map((claim) => ({ claim, work: fixedWork(claim)! }));
  const revisions = await database.select().from(questionRevisions).where(
    and(
      eq(questionRevisions.tenantId, context.ctx.tenantId),
      inArray(
        questionRevisions.id,
        pending.map((c) => c.item.revisionId),
      ),
    ),
  );
  const topicExamples = context.definition.examples.filter((e) =>
    e.classification.topic?.state === 'assigned' && e.classification.topic.valueIds.length === 1
  );
  const examples = await loadEnrichmentSources(
    database,
    context.ctx.tenantId,
    topicExamples,
  );
  const teaching = examples.flatMap((source) => {
    const example = context.definition.examples.find((e) =>
      e.questionId === source.questionId && e.revisionId === source.revisionId
    );
    return source.content.ok && example?.classification.topic?.state === 'assigned' &&
        example.classification.topic.valueIds.length === 1
      ? [{ question: source.content.value, topicId: example.classification.topic.valueIds[0] }]
      : [];
  });
  if (teaching.length !== topicExamples.length) {
    return claims.map((claim): { claim: ClaimedItem; work: PreparedWork } => ({
      claim,
      work: fixedWork(claim) ?? { kind: 'failure', code: 'unsupported_example' },
    }));
  }

  return claims.map((claim) => {
    const fixed = fixedWork(claim);
    if (fixed) return { claim, work: fixed };
    const revision = revisions.find((r) => r.id === claim.item.revisionId);
    const prepared = revision &&
      prepareEnrichmentQuestion(claim.item.questionId, revision.id, revision.body);
    return {
      claim,
      work: prepared?.ok
        ? { kind: 'inference', question: prepared.value, teaching }
        : { kind: 'decision', value: { kind: 'unsupported' }, chargedMicros: 0 },
    };
  });
}

async function completedCount(database: QflowDatabase, runId: string): Promise<number> {
  const [row] = await database.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(
    organizationItems,
  ).where(
    and(
      eq(organizationItems.runId, runId),
      sql`${organizationItems.state} NOT IN ('pending','processing','received')`,
    ),
  );
  return row.count;
}

import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  enrichmentBatches,
  enrichmentRunItems,
  enrichmentRuns,
} from '../lib/db/bank_enrichment_job_schema.ts';
import { enrichmentAssignments, enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import { enrichmentPreviews } from '../lib/db/bank_enrichment_task_schema.ts';
import { workflowDispatches } from '../lib/db/workflow_canvas_schema.ts';
import { questionRevisions, questions } from '../lib/db/question_schema.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import { BankEnrichmentRunStore } from '../lib/services/bank_enrichment_run_store.ts';
import { processEnrichmentStep } from '../lib/services/bank_enrichment_processor.ts';
import {
  claimEnrichmentStep,
  lockEnrichmentClaim,
} from '../lib/services/bank_enrichment_worker_store.ts';
import { BankEnrichmentJobRead } from '../lib/services/bank_enrichment_job_read.ts';
import { classificationRequest } from '../lib/services/bank_enrichment_classifier.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import {
  checkpointEnrichmentBatch,
  nextEnrichmentBatch,
} from '../lib/services/bank_enrichment_batch_store.ts';
import { applyEnrichmentBatch } from '../lib/services/bank_enrichment_apply.ts';
import { loadEnrichmentSources } from '../lib/services/bank_enrichment_sources.ts';
import { BankEnrichmentAnalysis } from '../lib/services/bank_enrichment_analysis.ts';
import { BankEnrichmentUsage } from '../lib/services/bank_enrichment_usage.ts';
import {
  parseStoredEnrichmentPreviewResult,
  parseStoredEnrichmentSample,
} from '../lib/services/bank_enrichment_preview_codec.ts';
import type { EnrichmentAIReceipt } from '../lib/ai/bank_enrichment_provider.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import {
  enrichmentConfigFixture,
  enrichmentProviderFixture,
} from './helpers/enrichment_provider_fixture.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';

import {
  enrichmentTestNow as now,
  enrichmentWorkerFixture as services,
  finishEnrichmentRunFixture as finish,
  prepareEnrichmentRunFixture as prepare,
} from './helpers/enrichment_workflow_fixture.ts';

testCase(
  'durable batches reconcile the full scope, protect later same-value edits, and preserve source data',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepare(ctx, 41);
        if (
          !((await run.jobs.queueRun(ctx, run.runId, run.executionId, enrichmentConfigFixture)).ok)
        ) {
          expect.unreachable(
            'Expected (await run.jobs.queueRun(ctx, run.runId, run.executionId, enrichmentConfigFixture)).ok',
          );
        }
        expect(
          (await db.select().from(workflowDispatches).where(
            eq(workflowDispatches.jobId, run.runId),
          ))
            .length,
        ).toStrictEqual(1);
        const before = await db.select().from(questionRevisions).where(
          eq(questionRevisions.tenantId, ctx.tenantId),
        );
        const item = before[0], manualId = crypto.randomUUID();
        await db.insert(enrichmentChanges).values({
          id: manualId,
          tenantId: ctx.tenantId,
          schemeId: run.schemeId,
          versionId: run.versionId,
          questionId: item.questionId,
          revisionId: item.id,
          dimension: 'difficulty',
          value: { state: 'assigned', valueIds: ['easy'] },
          origin: 'human',
          operationId: crypto.randomUUID(),
          createdBy: ctx.userId,
          createdAt: now(),
        });
        await db.insert(enrichmentAssignments).values({
          tenantId: ctx.tenantId,
          schemeId: run.schemeId,
          questionId: item.questionId,
          dimension: 'difficulty',
          changeId: manualId,
        });
        expect((await finish(run.params)).completed).toStrictEqual(41);
        const [stored] = await db.select().from(enrichmentRuns).where(
          eq(enrichmentRuns.id, run.runId),
        );
        expect(stored.state).toStrictEqual('completed_with_issues');
        const items = await db.select().from(enrichmentRunItems).where(
          eq(enrichmentRunItems.runId, run.runId),
        );
        expect(items.filter((i) => i.state === 'classified').length).toStrictEqual(40);
        expect(items.filter((i) => i.state === 'protected').length).toStrictEqual(1);
        const assignments = await db.select().from(enrichmentAssignments).where(
          eq(enrichmentAssignments.schemeId, run.schemeId),
        );
        expect(assignments.length).toStrictEqual(123);
        if (!(assignments.some((a) => a.changeId === manualId))) {
          expect.unreachable('Expected assignments.some((a) => a.changeId === manualId)');
        }
        expect(
          await db.select().from(questionRevisions).where(
            eq(questionRevisions.tenantId, ctx.tenantId),
          ),
        ).toStrictEqual(before);
        const replay = await finish(run.params, {
          ...services,
          provider: () => {
            throw new Error('Completed run must not dispatch.');
          },
        });
        expect(replay.completed).toStrictEqual(41);
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'a checkpoint survives worker interruption and the expired lease cannot write',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepare(ctx, 3);
        const claimedAt = new Date();
        const acquired = await claimEnrichmentStep(
          db,
          claimedAt,
          run.runId,
          run.executionId,
          crypto.randomUUID(),
        );
        if (
          !(acquired.ok && acquired.value.kind === 'claimed' &&
            acquired.value.claim.kind === 'classify')
        ) {
          expect.unreachable(
            "Expected acquired.ok && acquired.value.kind === 'claimed' && acquired.value.claim.kind === 'classif",
          );
        }
        const claim = acquired.value.claim;
        const batch = await nextEnrichmentBatch(db, claim, claimedAt);
        if (!(batch.ok && 'sequence' in batch.value)) {
          expect.unreachable("Expected batch.ok && 'sequence' in batch.value");
        }
        const refs = await db.select().from(enrichmentRunItems).where(
          eq(enrichmentRunItems.runId, run.runId),
        );
        const sources = await loadEnrichmentSources(db, ctx.tenantId, refs);
        const sourceQuestions = sources.flatMap((s) => s.content.ok ? [s.content.value] : []);
        const analysis = new BankEnrichmentAnalysis(
          new BankEnrichmentUsage(db, now),
          () => enrichmentProviderFixture,
        );
        const response = await analysis.classify(
          ctx,
          run.runId,
          crypto.randomUUID(),
          enrichmentDefinitionFixture(),
          sourceQuestions,
        );
        if (!(response.ok)) expect.unreachable('Expected response.ok');
        if (
          !((await checkpointEnrichmentBatch(
            db,
            claim,
            batch.value,
            response.value.result,
            response.value.usage,
            claimedAt,
          )).ok)
        ) {
          expect.unreachable(
            'Expected (await checkpointEnrichmentBatch( db, claim, batch.value, response.value.result, response.',
          );
        }
        const later = new Date(claimedAt.getTime() + 181_000);
        const recovered = await finish(run.params, {
          ...services,
          now: () => later,
          provider: () => {
            throw new Error('A recorded batch must replay without another provider call.');
          },
        });
        expect(recovered.completed).toStrictEqual(3);
        expect(await applyEnrichmentBatch(db, claim, batch.value.sequence, later)).toStrictEqual({
          ok: false,
          code: 'lease_lost',
        });
        expect(
          (await db.select().from(enrichmentChanges).where(
            eq(enrichmentChanges.operationId, run.runId),
          )).length,
        ).toStrictEqual(9);
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase('cancellation fences an in-flight result and resume reuses its receipt', async () => {
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      const run = await prepare(ctx, 2);
      const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      const pending = processEnrichmentStep(run.params, {
        ...services,
        provider: () => async (request) => {
          started.resolve();
          await release.promise;
          return await enrichmentProviderFixture(request);
        },
      });
      await Promise.race([
        started.promise,
        pending.then((result) => {
          throw new Error(`Worker stopped before dispatch: ${JSON.stringify(result)}`);
        }),
      ]);
      if (!((await run.jobs.cancel(ctx, run.runId)).ok)) {
        expect.unreachable('Expected (await run.jobs.cancel(ctx, run.runId)).ok');
      }
      release.resolve();
      expect(await pending).toStrictEqual({ ok: false, code: 'lease_lost' });
      expect(
        (await db.select().from(enrichmentAssignments).where(
          eq(enrichmentAssignments.tenantId, ctx.tenantId),
        )).length,
      ).toStrictEqual(0);
      const executionId = crypto.randomUUID();
      if (!((await run.jobs.resume(ctx, run.runId, executionId)).ok)) {
        expect.unreachable('Expected (await run.jobs.resume(ctx, run.runId, executionId)).ok');
      }
      expect(
        (await finish(
          { jobId: run.runId, workflowExecutionId: executionId },
          {
            ...services,
            provider: () => {
              throw new Error('Resume must reuse the stored provider receipt.');
            },
          },
        )).completed,
      ).toStrictEqual(2);
      const summary = await new BankEnrichmentUsage(db, now).summary(ctx, run.runId);
      if (!(summary.ok)) expect.unreachable('Expected summary.ok');
      expect(summary.value.attempts).toStrictEqual(1);
      expect((await finish(run.params)).state).toStrictEqual('cancelled');
    });
  } finally {
    await shutdownDb();
  }
});

testCase(
  'budget exhaustion stops dispatch and reconciles every remaining question as failed',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepare(ctx, 25, { ...enrichmentConfigFixture, runBudgetMicros: 1 });
        expect(
          (await finish(run.params, {
            ...services,
            provider: () => {
              throw new Error('Over-budget work must not dispatch.');
            },
          })).state,
        ).toStrictEqual('failed');
        const items = await db.select().from(enrichmentRunItems).where(
          eq(enrichmentRunItems.runId, run.runId),
        );
        expect(items.length).toStrictEqual(25);
        if (!(items.every((i) => i.state === 'failed'))) {
          expect.unreachable("Expected items.every((i) => i.state === 'failed')");
        }
        const summary = await new BankEnrichmentUsage(db, now).summary(ctx, run.runId);
        if (!(summary.ok)) expect.unreachable('Expected summary.ok');
        expect(summary.value.attempts).toStrictEqual(0);
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'three provider failures require explicit retry; preview completes without assigning questions',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepare(ctx, 4);
        const failedReceipt: EnrichmentAIReceipt = {
          ok: false,
          code: 'provider_failed',
          usage: null,
        };
        await finish(run.params, {
          ...services,
          provider: () => () => Promise.resolve(failedReceipt),
        });
        const [batch] = await db.select().from(enrichmentBatches).where(
          eq(enrichmentBatches.runId, run.runId),
        );
        expect(batch.attempts).toStrictEqual(3);
        expect(batch.state).toStrictEqual('failed');
        const executionId = crypto.randomUUID();
        if (!((await run.jobs.resume(ctx, run.runId, executionId)).ok)) {
          expect.unreachable('Expected (await run.jobs.resume(ctx, run.runId, executionId)).ok');
        }
        await finish({ jobId: run.runId, workflowExecutionId: executionId });
        const before = await db.select().from(enrichmentAssignments).where(
          eq(enrichmentAssignments.tenantId, ctx.tenantId),
        );
        const previewId = crypto.randomUUID(), previewExecutionId = crypto.randomUUID();
        if (
          !((await run.jobs.queuePreview(ctx, previewId, run.snapshotId, previewExecutionId, {
            baseVersionId: null,
            seed: crypto.randomUUID(),
            audience: 'Grade 6 science',
            definition: null,
          }, enrichmentConfigFixture)).ok)
        ) {
          expect.unreachable(
            'Expected (await run.jobs.queuePreview(ctx, previewId, run.snapshotId, previewExecutionId, { baseVer',
          );
        }
        const previewParams = { jobId: previewId, workflowExecutionId: previewExecutionId };
        const failedWorker = {
          ...services,
          provider: () => () => Promise.resolve(failedReceipt),
        };
        const firstAttempt = await processEnrichmentStep(previewParams, failedWorker);
        if (!(firstAttempt.ok && firstAttempt.value.state === 'retry')) {
          expect.unreachable("Expected firstAttempt.ok && firstAttempt.value.state === 'retry'");
        }
        const reader = new BankEnrichmentJobRead(db, now);
        const retrying = await reader.get(ctx, previewId);
        if (!(retrying.ok && retrying.value.state === 'running')) {
          expect.unreachable("Expected retrying.ok && retrying.value.state === 'running'");
        }
        expect(retrying.value.errorCode).toStrictEqual(null);
        await finish(previewParams, failedWorker);
        const failed = await reader.get(ctx, previewId);
        if (!(failed.ok && failed.value.state === 'failed')) {
          expect.unreachable("Expected failed.ok && failed.value.state === 'failed'");
        }
        expect(failed.value.errorCode).toStrictEqual('provider_failed');
        if (!((await run.jobs.cancel(ctx, previewId)).ok)) {
          expect.unreachable('Expected (await run.jobs.cancel(ctx, previewId)).ok');
        }
        const cancelled = await reader.get(ctx, previewId);
        if (!(cancelled.ok && cancelled.value.state === 'cancelled')) {
          expect.unreachable("Expected cancelled.ok && cancelled.value.state === 'cancelled'");
        }
        expect(cancelled.value.errorCode).toStrictEqual(null);
        const resumedExecutionId = crypto.randomUUID();
        if (!((await run.jobs.resume(ctx, previewId, resumedExecutionId)).ok)) {
          expect.unreachable(
            'Expected (await run.jobs.resume(ctx, previewId, resumedExecutionId)).ok',
          );
        }
        await finish({ jobId: previewId, workflowExecutionId: resumedExecutionId });
        const [preview] = await db.select().from(enrichmentPreviews).where(
          eq(enrichmentPreviews.id, previewId),
        );
        expect(preview.state).toStrictEqual('completed');
        const sample = parseStoredEnrichmentSample(preview.sample);
        if (!sample) expect.unreachable('Expected sample');
        const result = parseStoredEnrichmentPreviewResult(preview.result, sample);
        if (!result) expect.unreachable('Expected result');
        expect(result.examples.length).toStrictEqual(4);
        expect(result.definition.examples).toStrictEqual([]);
        if (!(result.estimatedRunMicros > 0)) {
          expect.unreachable('Expected result.estimatedRunMicros > 0');
        }
        expect(
          await db.select().from(enrichmentAssignments).where(
            eq(enrichmentAssignments.tenantId, ctx.tenantId),
          ),
        ).toStrictEqual(before);
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'stale revisions and unsupported content reconcile as issues without overwriting source data',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepare(ctx, 2);
        const [source] = await db.select().from(questionRevisions).where(
          eq(questionRevisions.tenantId, ctx.tenantId),
        );
        if (
          !(typeof source.body === 'object' && source.body !== null && !Array.isArray(source.body))
        ) {
          expect.unreachable(
            "Expected typeof source.body === 'object' && source.body !== null && !Array.isArray(source.body)",
          );
        }
        await saveQuestionRevisionFixture(ctx, {
          questionId: source.questionId,
          title: 'Edited after the scope was captured',
          body: { ...source.body, title: 'Edited after the scope was captured' },
          tags: ['source-science'],
          qtiXml: source.qtiXml,
          provenance: { _tag: 'Revision', operation: 'revised', expectedParentRevision: 1 },
          draftState: 'published',
        });
        await finish(run.params);
        const read = new BankEnrichmentJobRead(db, now);
        const view = await read.get(ctx, run.runId);
        if (!(view.ok && view.value.kind === 'classify')) {
          expect.unreachable("Expected view.ok && view.value.kind === 'classify'");
        }
        expect(view.value.state).toStrictEqual('completed_with_issues');
        expect(view.value.progress.counts.outdated).toStrictEqual(1);
        expect(view.value.progress.counts.classified).toStrictEqual(1);
        expect(view.value.progress.completed).toStrictEqual(2);
        expect(
          (await db.select().from(enrichmentAssignments).where(
            eq(enrichmentAssignments.questionId, source.questionId),
          )).length,
        ).toStrictEqual(0);
        expect(await read.get({ ...ctx, tenantId: crypto.randomUUID() }, run.runId)).toStrictEqual({
          ok: false,
          code: 'forbidden',
        });

        // Capture a real media question, which the text-only classifier must explicitly skip.
        const [current] = await db.select().from(questions).where(
          eq(questions.id, source.questionId),
        );
        const revisionId = current.latestRevisionId;
        if (!revisionId) expect.unreachable('Expected revisionId');
        await saveQuestionRevisionFixture(ctx, {
          questionId: source.questionId,
          title: 'Media question',
          body: {
            type: 'single_select',
            title: 'Media question',
            promptHtml: '<p>Identify this cell.</p><img src="cell.png" alt="cell"/>',
            choices: [{ id: 'a', text: 'Nucleus' }, { id: 'b', text: 'Membrane' }],
            correctId: 'a',
          },
          tags: [],
          qtiXml: source.qtiXml,
          provenance: { _tag: 'Revision', operation: 'revised', expectedParentRevision: 2 },
          draftState: 'published',
        });
        const snapshotId = crypto.randomUUID(),
          id = crypto.randomUUID(),
          executionId = crypto.randomUUID();
        if (
          !((await new BankEnrichmentScopes(db, now).capture(ctx, snapshotId, {
            _tag: 'Selected',
            questionIds: [source.questionId],
          })).ok)
        ) {
          expect.unreachable(
            "Expected (await new BankEnrichmentScopes(db, now).capture(ctx, snapshotId, { _tag: 'Selected', ques",
          );
        }
        if (
          !((await new BankEnrichmentRunStore(db, now).prepare(ctx, id, {
            snapshotId,
            versionId: run.versionId,
            dimensions: ['subject', 'topic', 'difficulty'],
            replacement: 'preserve_manual',
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await new BankEnrichmentRunStore(db, now).prepare(ctx, id, { snapshotId, versionId: run.v',
          );
        }
        if (!((await run.jobs.queueRun(ctx, id, executionId, enrichmentConfigFixture)).ok)) {
          expect.unreachable(
            'Expected (await run.jobs.queueRun(ctx, id, executionId, enrichmentConfigFixture)).ok',
          );
        }
        await finish(
          { jobId: id, workflowExecutionId: executionId },
          {
            ...services,
            provider: () => {
              throw new Error('Unsupported content must not call AI.');
            },
          },
        );
        const media = await read.get(ctx, id);
        if (!(media.ok && media.value.kind === 'classify')) {
          expect.unreachable("Expected media.ok && media.value.kind === 'classify'");
        }
        expect(media.value.progress.counts.unassigned).toStrictEqual(1);
        expect(media.value.usage.attempts).toStrictEqual(0);
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'one active run owns a scheme and cancellation also fences new provider dispatch',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepare(ctx, 1);
        const id = crypto.randomUUID(), executionId = crypto.randomUUID();
        if (
          !((await new BankEnrichmentRunStore(db, now).prepare(ctx, id, {
            snapshotId: run.snapshotId,
            versionId: run.versionId,
            dimensions: ['subject', 'topic', 'difficulty'],
            replacement: 'preserve_manual',
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await new BankEnrichmentRunStore(db, now).prepare(ctx, id, { snapshotId: run.snapshotId, ',
          );
        }
        expect(await run.jobs.queueRun(ctx, id, executionId, enrichmentConfigFixture))
          .toStrictEqual({
            ok: false,
            code: 'active_run',
          });
        const acquired = await claimEnrichmentStep(
          db,
          now(),
          run.runId,
          run.executionId,
          crypto.randomUUID(),
        );
        if (
          !(acquired.ok && acquired.value.kind === 'claimed' &&
            acquired.value.claim.kind === 'classify')
        ) {
          expect.unreachable(
            "Expected acquired.ok && acquired.value.kind === 'claimed' && acquired.value.claim.kind === 'classif",
          );
        }
        const claim = acquired.value.claim;
        const refs = await db.select().from(enrichmentRunItems).where(
          eq(enrichmentRunItems.runId, run.runId),
        );
        const source = await loadEnrichmentSources(db, ctx.tenantId, refs);
        const request = classificationRequest(
          claim.definition,
          source.flatMap((s) => s.content.ok ? [s.content.value] : []),
        );
        if (!request) expect.unreachable('Expected request');
        if (!((await run.jobs.cancel(ctx, run.runId)).ok)) {
          expect.unreachable('Expected (await run.jobs.cancel(ctx, run.runId)).ok');
        }
        const usage = new BankEnrichmentUsage(db, now, {
          authorizeDispatch: (tx) => lockEnrichmentClaim(tx, claim, now()),
        });
        expect(
          await usage.execute(ctx, run.runId, crypto.randomUUID(), request, () => {
            throw new Error('Cancelled work must not dispatch.');
          }),
        ).toStrictEqual({ ok: false, code: 'aborted' });
        const cancelled = await new BankEnrichmentJobRead(db, now).get(ctx, run.runId);
        if (!(cancelled.ok && cancelled.value.kind === 'classify')) {
          expect.unreachable("Expected cancelled.ok && cancelled.value.kind === 'classify'");
        }
        expect(cancelled.value.progress.counts.cancelled).toStrictEqual(1);
        expect(cancelled.value.usage.attempts).toStrictEqual(0);
        if (!((await run.jobs.queueRun(ctx, id, executionId, enrichmentConfigFixture)).ok)) {
          expect.unreachable(
            'Expected (await run.jobs.queueRun(ctx, id, executionId, enrichmentConfigFixture)).ok',
          );
        }
        await finish({ jobId: id, workflowExecutionId: executionId });
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'preview survives cancellation and persisted batch receipts cannot be rewritten',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepare(ctx, 2);
        await finish(run.params);
        await expect(
          Promise.resolve().then(async () => {
            await db.update(enrichmentBatches).set({ response: [] }).where(
              eq(enrichmentBatches.runId, run.runId),
            );
          }),
        ).rejects.toBeInstanceOf(Error);
        await expect(
          Promise.resolve().then(async () => {
            await db.update(enrichmentBatches).set({ questionIds: [] }).where(
              eq(enrichmentBatches.runId, run.runId),
            );
          }),
        ).rejects.toBeInstanceOf(Error);
        const id = crypto.randomUUID(), executionId = crypto.randomUUID();
        const command = {
          baseVersionId: null,
          seed: crypto.randomUUID(),
          audience: 'Grade 6 science',
          definition: null,
        };
        const foreignDefinition = {
          ...enrichmentDefinitionFixture(),
          examples: [{
            questionId: crypto.randomUUID(),
            revisionId: crypto.randomUUID(),
            classification: {
              subject: { state: 'assigned', valueIds: ['life'] },
              topic: { state: 'assigned', valueIds: ['cells'] },
              difficulty: { state: 'assigned', valueIds: ['easy'] },
            },
          }],
        };
        expect(
          await run.jobs.queuePreview(
            ctx,
            crypto.randomUUID(),
            run.snapshotId,
            crypto.randomUUID(),
            {
              ...command,
              definition: foreignDefinition,
            },
            enrichmentConfigFixture,
          ),
        ).toStrictEqual({ ok: false, code: 'invalid_input' });
        if (
          !((await run.jobs.queuePreview(
            ctx,
            id,
            run.snapshotId,
            executionId,
            command,
            enrichmentConfigFixture,
          )).ok)
        ) {
          expect.unreachable(
            'Expected (await run.jobs.queuePreview( ctx, id, run.snapshotId, executionId, command, enrichmentCon',
          );
        }
        if (
          !((await run.jobs.queuePreview(
            ctx,
            id,
            run.snapshotId,
            executionId,
            command,
            enrichmentConfigFixture,
          )).ok)
        ) {
          expect.unreachable(
            'Expected (await run.jobs.queuePreview( ctx, id, run.snapshotId, executionId, command, enrichmentCon',
          );
        }
        expect(
          await run.jobs.queuePreview(ctx, id, run.snapshotId, executionId, {
            ...command,
            audience: 'Grade 8',
          }, enrichmentConfigFixture),
        ).toStrictEqual({ ok: false, code: 'operation_conflict' });
        const proposal = await processEnrichmentStep(
          { jobId: id, workflowExecutionId: executionId },
          services,
        );
        if (!(proposal.ok && proposal.value.state === 'more')) {
          expect.unreachable("Expected proposal.ok && proposal.value.state === 'more'");
        }
        if (!((await run.jobs.cancel(ctx, id)).ok)) {
          expect.unreachable('Expected (await run.jobs.cancel(ctx, id)).ok');
        }
        const resumed = crypto.randomUUID();
        if (!((await run.jobs.resume(ctx, id, resumed)).ok)) {
          expect.unreachable('Expected (await run.jobs.resume(ctx, id, resumed)).ok');
        }
        await finish({ jobId: id, workflowExecutionId: resumed });
        const view = await new BankEnrichmentJobRead(db, now).get(ctx, id);
        if (!(view.ok && view.value.kind === 'preview' && view.value.result)) {
          expect.unreachable(
            "Expected view.ok && view.value.kind === 'preview' && view.value.result",
          );
        }
        expect(view.value.result.examples.length).toStrictEqual(2);
        expect(view.value.usage.attempts).toStrictEqual(2);
        expect(view.value.state).toStrictEqual('completed');
        expect(
          (await db.select().from(enrichmentChanges).where(eq(enrichmentChanges.operationId, id)))
            .length,
        ).toStrictEqual(0);
      });
    } finally {
      await shutdownDb();
    }
  },
);

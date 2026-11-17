import { env } from 'cloudflare:workers';
import { introspectWorkflowInstance } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { dispatchWorkflowOutbox } from '../deploy/cloudflare/workflows.entry.ts';
import { getDb } from '../lib/db.ts';
import {
  enrichmentBatches,
  enrichmentRunItems,
  enrichmentRuns,
} from '../lib/db/bank_enrichment_job_schema.ts';
import { enrichmentAssignments, enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import { questionRevisions, workflowDispatches } from '../lib/db/schema.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { BankEnrichmentRunStore } from '../lib/services/bank_enrichment_run_store.ts';
import { BankEnrichmentJobs } from '../lib/services/bank_enrichment_jobs.ts';
import { BankEnrichmentMutations } from '../lib/services/bank_enrichment_mutation_store.ts';
import { BankEnrichmentJobRead } from '../lib/services/bank_enrichment_job_read.ts';
import { processEnrichmentStep } from '../lib/services/bank_enrichment_processor.ts';
import { claimEnrichmentStep } from '../lib/services/bank_enrichment_worker_store.ts';
import {
  beginEnrichmentAttempt,
  checkpointEnrichmentBatch,
  nextEnrichmentBatch,
} from '../lib/services/bank_enrichment_batch_store.ts';
import { BankEnrichmentAnalysis } from '../lib/services/bank_enrichment_analysis.ts';
import { BankEnrichmentUsage } from '../lib/services/bank_enrichment_usage.ts';
import { loadEnrichmentSources } from '../lib/services/bank_enrichment_sources.ts';
import { enrichmentDefinitionFixture } from '../tests/bank_enrichment_fixture.ts';
import {
  enrichmentConfigFixture,
  enrichmentProviderFixture,
} from '../tests/helpers/enrichment_provider_fixture.ts';
import {
  addEnrichmentQuestions,
  withEnrichmentWorkspace,
} from '../tests/helpers/enrichment_workspace.ts';

// SAFETY: this local test adapter names the Workflow binding declared in tools/testing/cloudflare_workflow.config.ts.
const bindings = env;

it(
  'recovers an interrupted batch through the real Workflow and preserves earlier commits',
  async () => {
    const database = getDb({ bindings });
    await withEnrichmentWorkspace(async (ctx) => {
      await addEnrichmentQuestions(ctx, 25, database);
      const now = () => new Date(), old = new Date(Date.now() - 240_000);
      const snapshotId = crypto.randomUUID(),
        schemeId = crypto.randomUUID(),
        versionId = crypto.randomUUID();
      const runId = crypto.randomUUID(), executionId = crypto.randomUUID();
      const params = { jobId: runId, workflowExecutionId: executionId };
      const definition = enrichmentDefinitionFixture();
      expect(
        (await new BankEnrichmentScopes(database, now).capture(ctx, snapshotId, {
          _tag: 'Filtered',
          queryString: '',
        })).ok,
      ).toBe(true);
      expect(
        (await new BankEnrichmentStore(database, now).saveVersion(ctx, {
          id: versionId,
          schemeId,
          expectedVersion: 0,
          definition,
        })).ok,
      ).toBe(true);
      expect(
        (await new BankEnrichmentRunStore(database, now).prepare(ctx, runId, {
          snapshotId,
          versionId,
          dimensions: ['subject', 'topic', 'difficulty'],
          replacement: 'preserve_manual',
        })).ok,
      ).toBe(true);
      const jobs = new BankEnrichmentJobs(database, now);
      expect((await jobs.queueRun(ctx, runId, executionId, enrichmentConfigFixture)).ok).toBe(true);
      const before = await database.select().from(questionRevisions).where(
        eq(questionRevisions.tenantId, ctx.tenantId),
      );
      const first = await processEnrichmentStep(params, {
        database,
        now: () => old,
        newId: () => crypto.randomUUID(),
        provider: () => enrichmentProviderFixture,
      });
      expect(first).toEqual({ ok: true, value: { state: 'more', completed: 20 } });
      const acquired = await claimEnrichmentStep(
        database,
        old,
        runId,
        executionId,
        crypto.randomUUID(),
      );
      if (
        !acquired.ok || acquired.value.kind !== 'claimed' ||
        acquired.value.claim.kind !== 'classify'
      ) throw new Error('Expected an owned classification claim.');
      const claim = acquired.value.claim;
      const next = await nextEnrichmentBatch(database, claim, old);
      if (!next.ok || !('sequence' in next.value)) throw new Error('Expected the remaining batch.');
      const batch = next.value;
      const refs = await database.select().from(enrichmentRunItems).where(
        and(eq(enrichmentRunItems.runId, runId), eq(enrichmentRunItems.state, 'pending')),
      );
      const sources = await loadEnrichmentSources(database, ctx.tenantId, refs);
      const attempt = await beginEnrichmentAttempt(
        database,
        claim,
        batch,
        crypto.randomUUID(),
        old,
      );
      if (!attempt.ok) throw new Error('Expected a provider attempt.');
      const classified = await new BankEnrichmentAnalysis(
        new BankEnrichmentUsage(database, now),
        () => enrichmentProviderFixture,
      )
        .classify(
          ctx,
          runId,
          attempt.value,
          definition,
          sources.flatMap((s) => s.content.ok ? [s.content.value] : []),
        );
      if (!classified.ok) throw new Error('Expected a classifier receipt.');
      expect(
        (await checkpointEnrichmentBatch(
          database,
          claim,
          batch,
          classified.value.result,
          classified.value.usage,
          old,
        )).ok,
      ).toBe(true);
      expect(
        await database.select({ state: enrichmentBatches.state }).from(enrichmentBatches).where(
          eq(enrichmentBatches.runId, runId),
        ).orderBy(enrichmentBatches.sequence),
      ).toEqual([{ state: 'applied' }, { state: 'received' }]);

      // The old worker disappeared after its checkpoint. A real Workflow owns all remaining DB work.
      // No AI binding is configured: repeating the completed provider call would fail this test.
      const instance = await introspectWorkflowInstance(
        bindings.QFLOW_BANK_ENRICHMENT_WORKFLOW,
        executionId,
      );
      try {
        await bindings.QFLOW_BANK_ENRICHMENT_WORKFLOW.create({
          id: executionId,
          params: { jobId: runId },
        });
        expect((await dispatchWorkflowOutbox(bindings)).ok).toBe(true);
        await instance.waitForStatus('complete');
        expect((await dispatchWorkflowOutbox(bindings)).ok).toBe(true);
        expect(await instance.getOutput()).toEqual({
          _tag: 'Completed',
          jobId: runId,
          attempts: 1,
        });
        expect(
          (await database.select().from(enrichmentAssignments).where(
            eq(enrichmentAssignments.schemeId, schemeId),
          )).length,
        ).toBe(75);
        expect(
          (await database.select().from(enrichmentChanges).where(
            eq(enrichmentChanges.operationId, runId),
          )).length,
        ).toBe(75);
        expect(
          await database.select().from(questionRevisions).where(
            eq(questionRevisions.tenantId, ctx.tenantId),
          ),
        ).toEqual(before);
        expect(
          await database.select({ state: enrichmentRuns.state }).from(enrichmentRuns).where(
            eq(enrichmentRuns.id, runId),
          ),
        ).toEqual([{ state: 'completed' }]);
        expect(
          await database.select({ state: workflowDispatches.state }).from(workflowDispatches).where(
            eq(workflowDispatches.id, executionId),
          ),
        ).toEqual([{ state: 'complete' }]);
        const view = await new BankEnrichmentJobRead(database, now).get(ctx, runId);
        if (!view.ok || view.value.kind !== 'classify') {
          throw new Error('Expected reloadable progress.');
        }
        expect(view.value.progress).toEqual({
          total: 25,
          completed: 25,
          counts: {
            pending: 0,
            classified: 25,
            unassigned: 0,
            protected: 0,
            outdated: 0,
            failed: 0,
            cancelled: 0,
          },
        });
        expect(view.value.usage.attempts).toBe(2);
      } finally {
        await instance.dispose();
      }
    }, database);
  },
  30_000,
);

it('runs correction and undo in real Workflows without an AI binding or budget', async () => {
  const database = getDb({ bindings });
  await withEnrichmentWorkspace(async (ctx) => {
    await addEnrichmentQuestions(ctx, 25, database);
    const now = () => new Date(),
      snapshotId = crypto.randomUUID(),
      schemeId = crypto.randomUUID(),
      versionId = crypto.randomUUID();
    expect(
      (await new BankEnrichmentScopes(database, now).capture(ctx, snapshotId, {
        _tag: 'Filtered',
        queryString: '',
      })).ok,
    ).toBe(true);
    expect(
      (await new BankEnrichmentStore(database, now).saveVersion(ctx, {
        id: versionId,
        schemeId,
        expectedVersion: 0,
        definition: enrichmentDefinitionFixture(),
      })).ok,
    ).toBe(true);
    const mutations = new BankEnrichmentMutations(database, now);
    const jobs = new BankEnrichmentJobs(database, now);
    const source = crypto.randomUUID(), undo = crypto.randomUUID();
    expect(
      (await mutations.correct(ctx, source, {
        snapshotId,
        versionId,
        values: {
          subject: { state: 'assigned', valueIds: ['life'] },
          topic: { state: 'assigned', valueIds: ['cells'] },
          difficulty: { state: 'assigned', valueIds: ['hard'] },
        },
      })).ok,
    ).toBe(true);
    for (const id of [source, undo]) {
      if (id === undo) expect((await mutations.undo(ctx, undo, source)).ok).toBe(true);
      const executionId = crypto.randomUUID();
      expect((await jobs.queueMutation(ctx, id, executionId)).ok).toBe(true);
      const instance = await introspectWorkflowInstance(
        bindings.QFLOW_BANK_ENRICHMENT_WORKFLOW,
        executionId,
      );
      try {
        await bindings.QFLOW_BANK_ENRICHMENT_WORKFLOW.create({
          id: executionId,
          params: { jobId: id },
        });
        expect((await dispatchWorkflowOutbox(bindings)).ok).toBe(true);
        await instance.waitForStatus('complete');
        expect((await dispatchWorkflowOutbox(bindings)).ok).toBe(true);
        expect(await instance.getOutput()).toEqual({ _tag: 'Completed', jobId: id, attempts: 1 });
        const view = await new BankEnrichmentJobRead(database, now).get(ctx, id);
        if (!view.ok || (view.value.kind !== 'correct' && view.value.kind !== 'undo')) {
          throw new Error('Expected a manual workflow result.');
        }
        expect(view.value.state).toBe('completed');
        expect(view.value.usage).toBe(null);
        if (id === undo) expect(view.value.teachingExampleCount).toBe(0);
        else {
          expect(view.value.teachingExampleCount).toBeGreaterThan(0);
          expect(view.value.teachingExampleCount).toBeLessThanOrEqual(20);
        }
        expect(view.value.changes).toEqual({
          questions: 25,
          dimensions: 75,
          laterEdits: 0,
          noChanges: 0,
        });
        const current = await database.select({
          value: enrichmentChanges.value,
          dimension: enrichmentChanges.dimension,
        }).from(
          enrichmentAssignments,
        )
          .innerJoin(enrichmentChanges, eq(enrichmentChanges.id, enrichmentAssignments.changeId))
          .where(eq(enrichmentAssignments.schemeId, schemeId));
        expect(current).toHaveLength(75);
        for (const row of current) {
          expect(row.value).toEqual(
            id === undo ? { state: 'absent' } : {
              state: 'assigned',
              valueIds: [
                row.dimension === 'subject' ? 'life' : row.dimension === 'topic' ? 'cells' : 'hard',
              ],
            },
          );
        }
      } finally {
        await instance.dispose();
      }
    }
    expect(
      (await database.select().from(enrichmentChanges).where(
        eq(enrichmentChanges.schemeId, schemeId),
      )).length,
    ).toBe(150);
  }, database);
}, 30_000);

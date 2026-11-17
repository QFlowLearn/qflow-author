import { expect, test as testCase } from 'vitest';

import { count, eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { enrichmentAssignments, enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import { enrichmentBatches } from '../lib/db/bank_enrichment_job_schema.ts';
import { BankEnrichmentRunStore } from '../lib/services/bank_enrichment_run_store.ts';
import { BankEnrichmentJobs } from '../lib/services/bank_enrichment_jobs.ts';
import { BankEnrichmentJobRead } from '../lib/services/bank_enrichment_job_read.ts';
import { processEnrichmentStep } from '../lib/services/bank_enrichment_processor.ts';
import { runBankEnrichmentWorkflow } from '../lib/workflows/bank_enrichment_workflow.ts';
import { mutationBank, mutationNow } from './helpers/enrichment_mutation_fixture.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import {
  enrichmentConfigFixture,
  enrichmentProviderFixture,
} from './helpers/enrichment_provider_fixture.ts';

class ScaleFixtureInterruption extends Error {}

/** A compact checksum covers every source column without loading all bodies into the test process. */
function sourceFingerprint(tenantId: string) {
  return db.execute(sql`SELECT
    (SELECT md5(string_agg(md5(to_jsonb(q)::text), '' ORDER BY q.id)) FROM questions q WHERE q.tenant_id = ${tenantId}) questions,
    (SELECT md5(string_agg(md5(to_jsonb(r)::text), '' ORDER BY r.id)) FROM question_revisions r WHERE r.tenant_id = ${tenantId}) revisions`);
}

testCase(
  '7787-question enrichment resumes after a worker interruption with exact outcomes and no duplicate writes',
  { skip: process.env['QFLOW_ENRICHMENT_SCALE_TESTS'] !== '1' },
  async function () {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!(databaseUrl && /test/.test(new URL(databaseUrl).pathname))) {
      expect.unreachable('Use an isolated test database.');
    }
    const started = performance.now();
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const bank = await mutationBank(ctx, 7787);
        const before = await sourceFingerprint(ctx.tenantId);
        const runId = crypto.randomUUID(), executionId = crypto.randomUUID();
        const params = { jobId: runId, workflowExecutionId: executionId };
        if (
          !((await new BankEnrichmentRunStore(db, mutationNow).prepare(ctx, runId, {
            snapshotId: bank.snapshotId,
            versionId: bank.versionId,
            dimensions: ['subject', 'topic', 'difficulty'],
            replacement: 'preserve_manual',
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await new BankEnrichmentRunStore(db, mutationNow).prepare(ctx, runId, { snapshotId: bank.',
          );
        }
        // Only an external provider fixture runs. This explicit test budget accommodates its
        // deliberately conservative character-as-token usage; it is not a production cost estimate.
        if (
          !((await new BankEnrichmentJobs(db, mutationNow).queueRun(ctx, runId, executionId, {
            ...enrichmentConfigFixture,
            runBudgetMicros: 250_000_000,
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await new BankEnrichmentJobs(db, mutationNow).queueRun(ctx, runId, executionId, { ...enri',
          );
        }
        const process = () =>
          processEnrichmentStep(params, {
            database: db,
            now: mutationNow,
            newId: () => crypto.randomUUID(),
            provider: () => enrichmentProviderFixture,
          });
        let committedSteps = 0;
        await expect(
          Promise.resolve().then(() =>
            runBankEnrichmentWorkflow(params, {
              do: (_name, _config, action) => {
                if (committedSteps++ === 13) {
                  throw new ScaleFixtureInterruption('Test worker stopped.');
                }
                return action();
              },
              sleep: () => Promise.reject(new Error('Unexpected fixture retry.')),
            }, process)
          ),
        ).rejects.toBeInstanceOf(ScaleFixtureInterruption);
        const read = new BankEnrichmentJobRead(db, mutationNow);
        const interrupted = await read.get(ctx, runId);
        if (!(interrupted.ok && interrupted.value.kind === 'classify')) {
          expect.unreachable("Expected interrupted.ok && interrupted.value.kind === 'classify'");
        }
        expect(interrupted.value.progress.completed).toStrictEqual(260);
        const committed = await db.select().from(enrichmentChanges).where(
          eq(enrichmentChanges.operationId, runId),
        ).orderBy(enrichmentChanges.id);
        expect(committed.length).toStrictEqual(780);

        // A fresh workflow invocation starts its local sequence at zero and uses persisted work.
        const resumed = await runBankEnrichmentWorkflow(params, {
          do: (_name, _config, action) => action(),
          sleep: () => Promise.reject(new Error('Unexpected fixture retry.')),
        }, process);
        expect(resumed._tag).toStrictEqual('Completed');
        const result = await read.get(ctx, runId);
        if (!(result.ok && result.value.kind === 'classify')) {
          expect.unreachable("Expected result.ok && result.value.kind === 'classify'");
        }
        expect(result.value.state).toStrictEqual('completed');
        expect(result.value.progress).toStrictEqual({
          total: 7787,
          completed: 7787,
          counts: {
            pending: 0,
            classified: 7787,
            unassigned: 0,
            protected: 0,
            outdated: 0,
            failed: 0,
            cancelled: 0,
          },
        });
        const [assignments] = await db.select({ total: count() }).from(enrichmentAssignments).where(
          eq(enrichmentAssignments.schemeId, bank.schemeId),
        );
        const [changes] = await db.select({ total: count() }).from(enrichmentChanges).where(
          eq(enrichmentChanges.operationId, runId),
        );
        expect(assignments.total).toStrictEqual(7787 * 3);
        expect(changes.total).toStrictEqual(7787 * 3);
        const [duplicates] = await db.execute(sql`SELECT count(*)::int total FROM (
          SELECT question_id, dimension FROM bank_enrichment_changes WHERE operation_id = ${runId}
          GROUP BY question_id, dimension HAVING count(*) <> 1
        ) repeated`);
        expect(duplicates.total).toStrictEqual(0);
        const after = await db.select().from(enrichmentChanges).where(
          eq(enrichmentChanges.operationId, runId),
        ).orderBy(enrichmentChanges.id);
        const earlyIds = new Set(committed.map((c) => c.id));
        expect(after.filter((c) => earlyIds.has(c.id))).toStrictEqual(committed);
        const batches = await db.select().from(enrichmentBatches).where(
          eq(enrichmentBatches.runId, runId),
        );
        expect(batches.length).toStrictEqual(Math.ceil(7787 / 20));
        if (!(batches.every((batch) => batch.state === 'applied'))) {
          expect.unreachable("Expected batches.every((batch) => batch.state === 'applied')");
        }
        expect(result.value.usage.attempts).toStrictEqual(batches.length);
        expect(await sourceFingerprint(ctx.tenantId)).toStrictEqual(before);
        expect(await process()).toStrictEqual({
          ok: true,
          value: { state: 'completed', completed: 7787 },
        });
        console.log(JSON.stringify({
          fixture: 'deterministic provider; not model quality or production throughput',
          questions: 7787,
          dimensions: assignments.total,
          batches: batches.length,
          interruptedAfter: interrupted.value.progress.completed,
          elapsedMs: Math.round(performance.now() - started),
        }));
      });
    } finally {
      await shutdownDb();
    }
  },
);

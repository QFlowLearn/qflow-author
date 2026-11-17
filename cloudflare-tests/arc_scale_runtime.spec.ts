import { updateMigrationItems } from '../lib/import/migration_run_review.ts';
import { assignMigrationBatchReviewer } from '../lib/import/migration_batches.ts';
import {
  decideMigrationRunApproval,
  submitMigrationRunForApproval,
} from '../lib/import/migration_approvals.ts';
import {
  enqueueMigrationCommit,
  processMigrationCommitBatch,
} from '../lib/import/migration_commit_job.ts';
import { env } from 'cloudflare:workers';
import { assert, it } from 'vitest';
import { introspectWorkflowInstance } from 'cloudflare:test';
import { runWithRequestRuntime } from '../lib/server/request_runtime_context.ts';
import { resolveStorage } from '../lib/storage.ts';
const assertEquals = assert.deepEqual;
import { and, count, eq } from 'drizzle-orm';

import { db } from '../lib/db.ts';
import {
  auditLogs,
  migrationBatches,
  migrationItems,
  organizationMemberships,
  questions,
  tenants,
  users,
  workflowDispatches,
} from '../lib/db/schema.ts';
import { enqueueMigrationBatch } from '../lib/import/migration_enqueue.ts';
import { claimMigrationRun } from '../lib/import/migration_jobs.ts';
import { getMigrationRun } from '../lib/import/migration_run_queries.ts';
import { processClaimedMigrationRun } from '../lib/import/migration_processor.ts';
import type { RequestContext } from '../lib/tenants.ts';

it(
  'imports all ARC questions through the native runtime and durable commit workflow',
  () =>
    runWithRequestRuntime({ bindings: env }, async () => {
      const tenantId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const ctx: RequestContext = { tenantId, userId, role: 'owner' };
      const storage = resolveStorage({ bindings: env });
      try {
        await db.insert(tenants).values({
          id: tenantId,
          slug: `large-source-${tenantId}`,
          name: 'Large source regression test',
        });
        const email = `large-source-${userId}@example.com`;
        await db.insert(users).values({ id: userId, email, emailNormalized: email });
        await db.insert(organizationMemberships).values({
          id: crypto.randomUUID(),
          tenantId,
          userId,
          role: 'owner',
        });

        const questionCount = 7787;
        const response = await fetch('http://127.0.0.1:8879/arc-all-7787-qti3.zip');
        assert(response.ok);
        const source = new Uint8Array(await response.arrayBuffer());
        const batch = await enqueueMigrationBatch(ctx, {
          idempotencyKey: crypto.randomUUID(),
          purpose: 'recover_existing',
          destination: { _tag: 'WorkspaceBank', collectionId: null },
          sources: [{
            source: {
              filename: 'arc-all-7787-qti3.zip',
              mime: 'application/zip',
              bytes: source,
            },
            adapter: { id: 'qti3', version: '1' },
          }],
        }, { storage });
        assertEquals(batch.runs.length, 1);
        const runId = batch.runs[0].id;
        const [dispatch] = await db.select({ id: workflowDispatches.id }).from(workflowDispatches)
          .where(
            and(
              eq(workflowDispatches.kind, 'source_migration'),
              eq(workflowDispatches.jobId, runId),
            ),
          );
        assert(dispatch);
        const claim = await claimMigrationRun(runId, dispatch.id);
        assert(claim);
        const processed = await processClaimedMigrationRun(claim, { storage });
        assert(
          processed._tag === 'Success',
          processed._tag === 'Failure' ? processed.failure.code : undefined,
        );
        assertEquals(processed.value, { runId });
        const run = await getMigrationRun(ctx, runId);
        assert(run);
        assertEquals(run.execution._tag, 'Analyzed');
        assertEquals(
          run.summary.counts.blocked,
          0,
          JSON.stringify(
            run.items.filter((item) => item.readiness === 'blocked').slice(0, 2).map((item) => ({
              id: item.sourceIdentifier,
              warnings: item.warnings,
            })),
          ),
        );
        assertEquals(run.summary.counts.items, questionCount);
        assertEquals(run.items.length, questionCount);
        assertEquals(
          run.items.map((item) => item.position),
          Array.from({ length: questionCount }, (_, index) => index + 1),
        );
        assertEquals(new Set(run.items.map((item) => item.id)).size, questionCount);
        const [persisted] = await db.select({ total: count() }).from(migrationItems)
          .where(eq(migrationItems.runId, runId));
        assertEquals(persisted.total, questionCount);
        assertEquals(await claimMigrationRun(runId, dispatch.id), null);
        for (let offset = 0; offset < questionCount; offset += 100) {
          const page = await getMigrationRun(ctx, runId, db, { offset, limit: 100 });
          assert(page);
          const versions = Object.fromEntries(
            page.items.map((
              item,
            ) => [item.id, {
              contentHash: item.contentHash,
              contextHash: item.contextHash,
              decision: item.decision,
            }]),
          );
          await updateMigrationItems(
            ctx,
            runId,
            page.items.map((item) => item.id),
            { kind: 'accept' },
            versions,
          );
        }
        await assignMigrationBatchReviewer(ctx, batch.id, userId);
        await submitMigrationRunForApproval(ctx, runId);
        await decideMigrationRunApproval(ctx, runId, { decision: 'approve' });
        const approvedIds = run.items.map((item) => item.id);
        await enqueueMigrationCommit(ctx, runId, approvedIds, true);
        await enqueueMigrationCommit(ctx, runId, approvedIds, true);
        const [commitDispatch] = await db.select({ id: workflowDispatches.id }).from(
          workflowDispatches,
        ).where(
          and(eq(workflowDispatches.kind, 'migration_commit'), eq(workflowDispatches.jobId, runId)),
        );
        // SAFETY: tools/testing/cloudflare_workflow.config.ts binds this real Workflow class.
        const workflow = env.QFLOW_MIGRATION_COMMIT_WORKFLOW;
        const instance = await introspectWorkflowInstance(workflow, commitDispatch.id);
        await workflow.create({ id: commitDispatch.id, params: { jobId: runId } });
        await instance.waitForStatus('complete');
        assertEquals(await instance.getOutput(), { _tag: 'Completed', jobId: runId, attempts: 1 });
        assertEquals(await processMigrationCommitBatch(runId, { database: db, storage }), {
          complete: true,
          completed: questionCount,
        });
        const [created] = await db.select({ total: count() }).from(questions).where(
          eq(questions.tenantId, tenantId),
        );
        assertEquals(created.total, questionCount);
      } finally {
        await db.delete(questions).where(eq(questions.tenantId, tenantId));
        await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId));
        await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, tenantId));
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
        await db.delete(organizationMemberships).where(
          eq(organizationMemberships.tenantId, tenantId),
        );
        await db.delete(users).where(eq(users.id, userId));
        await db.delete(tenants).where(eq(tenants.id, tenantId));
      }
    }),
  240_000,
);

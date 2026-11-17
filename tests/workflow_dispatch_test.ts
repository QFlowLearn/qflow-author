import { expect, test as testCase } from 'vitest';

import { asc, eq } from 'drizzle-orm';

import { db, shutdownDb } from '../lib/db.ts';
import {
  aiGenerationJobsTable,
  auditLogs,
  migrationBatches,
  migrationRuns,
  tenants,
  users,
  workflowDispatches,
} from '../lib/db/schema.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { buildEmptyMigrationSummary } from '../lib/import/migration_analysis.ts';
import {
  parseQflowWorkflowEvent,
  parseQflowWorkflowParams,
} from '../lib/workflows/job_workflows.ts';
import { dispatchPendingWorkflowJobs } from '../lib/workflows/workflow_dispatch.ts';

testCase('Workflow parameters accept only one canonical job ID', () => {
  const jobId = crypto.randomUUID();
  expect(parseQflowWorkflowParams({ jobId })).toStrictEqual({ jobId });
  expect(parseQflowWorkflowParams({ jobId, tenantId: crypto.randomUUID() })).toStrictEqual(null);
  expect(parseQflowWorkflowParams({ jobId: jobId.toUpperCase() })).toStrictEqual(null);
  expect(parseQflowWorkflowParams({ jobId: '018f8f70-7b5c-7e3f-8a2b-1234567890ab' })).toStrictEqual(
    null,
  );
  expect(parseQflowWorkflowParams({ jobId: 'not-a-uuid' })).toStrictEqual(null);
});

testCase('Workflow events require Cloudflare payload and execution identity', () => {
  const jobId = crypto.randomUUID();
  const workflowExecutionId = crypto.randomUUID();
  expect(parseQflowWorkflowEvent({ instanceId: workflowExecutionId, payload: { jobId } }))
    .toStrictEqual({
      jobId,
      workflowExecutionId,
    });
  expect(parseQflowWorkflowEvent({ payload: { jobId } })).toStrictEqual(null);
  expect(parseQflowWorkflowEvent({ instanceId: workflowExecutionId, params: { jobId } }))
    .toStrictEqual(null);
});

testCase('malformed platform status fails reconciliation without inventing Workflow state', {
  skip: !process.env['DATABASE_URL'],
}, async () => {
  const tenantId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const dispatchId = crypto.randomUUID();
  const binding = new TestWorkflowBinding();
  const runtime = {
    bindings: {
      QFLOW_SOURCE_MIGRATION_WORKFLOW: binding,
      QFLOW_AI_GENERATION_WORKFLOW: binding,
      QFLOW_RELEASE_BUILD_WORKFLOW: binding,
      QFLOW_MIGRATION_COMMIT_WORKFLOW: binding,
      QFLOW_BANK_ENRICHMENT_WORKFLOW: binding,
      QFLOW_QUESTION_ORGANIZATION_WORKFLOW: binding,
      QFLOW_ASSESSMENT_PRINT_WORKFLOW: binding,
    },
  };

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `workflow-status-${tenantId.slice(0, 8)}`,
      name: 'Workflow status boundary test',
    });
    await db.insert(workflowDispatches).values(pendingDispatch(dispatchId, jobId, tenantId));
    expect((await dispatchPendingWorkflowJobs(runtime)).ok).toStrictEqual(true);

    binding.setRawStatus(dispatchId, 'retired');
    expect(await dispatchPendingWorkflowJobs(runtime)).toStrictEqual({
      ok: false,
      error: {
        _tag: 'WorkflowDispatchFailed',
        message: 'Cloudflare could not reconcile every queued workflow.',
        phase: 'reconcile_workflow_instances',
        cause: { name: 'Error', code: null },
      },
    });
    const rows = await db.select({
      state: workflowDispatches.state,
      workflowStatus: workflowDispatches.workflowStatus,
      lastErrorCode: workflowDispatches.lastErrorCode,
    }).from(workflowDispatches).where(eq(workflowDispatches.id, dispatchId));
    expect(rows).toStrictEqual([{
      state: 'active',
      workflowStatus: 'queued',
      lastErrorCode: 'workflow_dispatch_failed',
    }]);
  } finally {
    await db.delete(workflowDispatches).where(eq(workflowDispatches.id, dispatchId)).catch(
      () => undefined,
    );
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined);
    await shutdownDb().catch(() => undefined);
  }
});

testCase('the outbox idempotently creates stable executions and restarts terminal instances', {
  skip: !process.env['DATABASE_URL'],
}, async () => {
  const tenantId = crypto.randomUUID();
  const firstJobId = crypto.randomUUID();
  const secondJobId = crypto.randomUUID();
  const firstDispatchId = crypto.randomUUID();
  const secondDispatchId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const binding = new TestWorkflowBinding();
  const runtime = {
    bindings: {
      QFLOW_SOURCE_MIGRATION_WORKFLOW: binding,
      QFLOW_AI_GENERATION_WORKFLOW: binding,
      QFLOW_RELEASE_BUILD_WORKFLOW: binding,
      QFLOW_MIGRATION_COMMIT_WORKFLOW: binding,
      QFLOW_BANK_ENRICHMENT_WORKFLOW: binding,
      QFLOW_QUESTION_ORGANIZATION_WORKFLOW: binding,
      QFLOW_ASSESSMENT_PRINT_WORKFLOW: binding,
    },
  };

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `workflow-${tenantId.slice(0, 8)}`,
      name: 'Workflow dispatch test',
    });
    const userEmail = `workflow-${userId.slice(0, 8)}@example.test`;
    await db.insert(users).values({ id: userId, email: userEmail, emailNormalized: userEmail });
    await db.insert(migrationBatches).values({
      id: batchId,
      tenantId,
      createdBy: userId,
      createdBySnapshot: { id: userId, email: 'workflow@example.test' },
      purpose: 'generate_new',
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: '0'.repeat(64),
      sourceCount: 2,
    });
    await db.insert(migrationRuns).values([
      sourceMigrationRun({
        id: firstJobId,
        batchId,
        tenantId,
      }),
      {
        ...sourceMigrationRun({
          id: secondJobId,
          batchId,
          tenantId,
        }),
        batchPosition: 2,
        status: 'analyzed',
        completedAt: new Date(),
      },
    ]);
    await db.insert(workflowDispatches).values([
      pendingDispatch(firstDispatchId, firstJobId, tenantId),
      pendingDispatch(secondDispatchId, secondJobId, tenantId),
    ]);

    expect(await dispatchPendingWorkflowJobs(runtime)).toStrictEqual({
      ok: true,
      dispatched: 2,
      reconciled: 0,
      completed: 0,
    });
    // The two rows share a transaction timestamp; dispatch identity has no SQL tie-order contract.
    expect(binding.created).toHaveLength(2);
    expect(binding.created).toEqual(expect.arrayContaining([
      { id: firstDispatchId, params: { jobId: firstJobId } },
      { id: secondDispatchId, params: { jobId: secondJobId } },
    ]));

    expect(await dispatchPendingWorkflowJobs(runtime)).toStrictEqual({
      ok: true,
      dispatched: 0,
      reconciled: 0,
      completed: 0,
    });
    expect([...binding.skipped].sort()).toStrictEqual([firstDispatchId, secondDispatchId].sort());
    binding.setStatus(firstDispatchId, 'errored');
    binding.setStatus(secondDispatchId, 'complete');

    expect(await dispatchPendingWorkflowJobs(runtime)).toStrictEqual({
      ok: true,
      dispatched: 0,
      reconciled: 1,
      completed: 1,
    });
    const rows = await db.select().from(workflowDispatches)
      .where(eq(workflowDispatches.tenantId, tenantId))
      .orderBy(asc(workflowDispatches.createdAt));
    expect(rows.length).toStrictEqual(2);
    expect(rows.find((row) => row.id === firstDispatchId)?.state).toStrictEqual('active');
    expect(rows.find((row) => row.id === firstDispatchId)?.attempts).toStrictEqual(1);
    expect(rows.find((row) => row.id === secondDispatchId)?.state).toStrictEqual('complete');
    expect(binding.restarted).toStrictEqual([firstDispatchId]);
    expect(binding.created.length).toStrictEqual(2);

    binding.setStatus(firstDispatchId, 'errored');
    expect((await dispatchPendingWorkflowJobs(runtime)).ok).toStrictEqual(true);
    binding.setStatus(firstDispatchId, 'terminated');
    expect((await dispatchPendingWorkflowJobs(runtime)).ok).toStrictEqual(true);
    binding.setStatus(firstDispatchId, 'errored');
    expect(await dispatchPendingWorkflowJobs(runtime)).toStrictEqual({
      ok: true,
      dispatched: 0,
      reconciled: 1,
      completed: 0,
    });
    const exhausted = await db.select().from(workflowDispatches)
      .where(eq(workflowDispatches.id, firstDispatchId));
    expect(exhausted[0]?.state).toStrictEqual('failed');
    expect(exhausted[0]?.attempts).toStrictEqual(3);
    expect(exhausted[0]?.lastErrorCode).toStrictEqual('workflow_restart_exhausted');
    const failedRun = await db.select({ status: migrationRuns.status }).from(migrationRuns)
      .where(eq(migrationRuns.id, firstJobId));
    expect(failedRun[0]?.status).toStrictEqual('failed');
    expect(binding.restarted).toStrictEqual([firstDispatchId, firstDispatchId, firstDispatchId]);
    expect(binding.created.length).toStrictEqual(2);
  } finally {
    await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId)).catch(
      () => undefined,
    );
    await db.delete(migrationRuns).where(eq(migrationRuns.tenantId, tenantId)).catch(
      () => undefined,
    );
    await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, tenantId)).catch(
      () => undefined,
    );
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId)).catch(() => undefined);
    await db.delete(users).where(eq(users.id, userId)).catch(() => undefined);
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined);
    await shutdownDb().catch(() => undefined);
  }
});

testCase('platform completion fails an active domain job and its dispatch together', {
  skip: !process.env['DATABASE_URL'],
}, async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const dispatchId = crypto.randomUUID();
  const binding = new TestWorkflowBinding();
  const runtime = {
    bindings: {
      QFLOW_SOURCE_MIGRATION_WORKFLOW: binding,
      QFLOW_AI_GENERATION_WORKFLOW: binding,
      QFLOW_RELEASE_BUILD_WORKFLOW: binding,
      QFLOW_MIGRATION_COMMIT_WORKFLOW: binding,
      QFLOW_BANK_ENRICHMENT_WORKFLOW: binding,
      QFLOW_QUESTION_ORGANIZATION_WORKFLOW: binding,
      QFLOW_ASSESSMENT_PRINT_WORKFLOW: binding,
    },
  };

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `workflow-invariant-${tenantId.slice(0, 8)}`,
      name: 'Workflow completion invariant test',
    });
    const email = `workflow-invariant-${userId.slice(0, 8)}@example.test`;
    await db.insert(users).values({ id: userId, email, emailNormalized: email });
    await db.insert(migrationBatches).values({
      id: batchId,
      tenantId,
      createdBy: userId,
      createdBySnapshot: { id: userId, email },
      purpose: 'generate_new',
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: '3'.repeat(64),
      sourceCount: 1,
    });
    await db.insert(migrationRuns).values(sourceMigrationRun({ id: jobId, batchId, tenantId }));
    await db.insert(workflowDispatches).values(pendingDispatch(dispatchId, jobId, tenantId));
    expect((await dispatchPendingWorkflowJobs(runtime)).ok).toStrictEqual(true);

    binding.setStatus(dispatchId, 'complete');
    expect(await dispatchPendingWorkflowJobs(runtime)).toStrictEqual({
      ok: true,
      dispatched: 0,
      reconciled: 1,
      completed: 0,
    });

    const dispatches = await db.select().from(workflowDispatches)
      .where(eq(workflowDispatches.id, dispatchId));
    const runs = await db.select().from(migrationRuns).where(eq(migrationRuns.id, jobId));
    expect(dispatches[0]?.state).toStrictEqual('failed');
    expect(dispatches[0]?.lastErrorCode).toStrictEqual('workflow_completed_before_domain_terminal');
    expect(runs[0]?.status).toStrictEqual('failed');
  } finally {
    await db.delete(workflowDispatches).where(eq(workflowDispatches.id, dispatchId)).catch(
      () => undefined,
    );
    await db.delete(migrationRuns).where(eq(migrationRuns.id, jobId)).catch(() => undefined);
    await db.delete(migrationBatches).where(eq(migrationBatches.id, batchId)).catch(
      () => undefined,
    );
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId)).catch(() => undefined);
    await db.delete(users).where(eq(users.id, userId)).catch(() => undefined);
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined);
    await shutdownDb().catch(() => undefined);
  }
});

testCase('restart exhaustion quarantines a dispatch when its domain job is missing', {
  skip: !process.env['DATABASE_URL'],
}, async () => {
  const tenantId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const dispatchId = crypto.randomUUID();
  const binding = new TestWorkflowBinding();
  const runtime = {
    bindings: {
      QFLOW_SOURCE_MIGRATION_WORKFLOW: binding,
      QFLOW_AI_GENERATION_WORKFLOW: binding,
      QFLOW_RELEASE_BUILD_WORKFLOW: binding,
      QFLOW_MIGRATION_COMMIT_WORKFLOW: binding,
      QFLOW_BANK_ENRICHMENT_WORKFLOW: binding,
      QFLOW_QUESTION_ORGANIZATION_WORKFLOW: binding,
      QFLOW_ASSESSMENT_PRINT_WORKFLOW: binding,
    },
  };

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `workflow-missing-${tenantId.slice(0, 8)}`,
      name: 'Missing Workflow job test',
    });
    await db.insert(workflowDispatches).values(pendingDispatch(dispatchId, jobId, tenantId));
    expect((await dispatchPendingWorkflowJobs(runtime)).ok).toStrictEqual(true);

    for (let attempt = 0; attempt < 3; attempt++) {
      binding.setStatus(dispatchId, 'errored');
      expect((await dispatchPendingWorkflowJobs(runtime)).ok).toStrictEqual(true);
    }
    binding.setStatus(dispatchId, 'errored');
    const exhausted = await dispatchPendingWorkflowJobs(runtime);
    expect(exhausted).toStrictEqual({
      ok: true,
      dispatched: 0,
      reconciled: 1,
      completed: 0,
    });

    const rows = await db.select().from(workflowDispatches)
      .where(eq(workflowDispatches.id, dispatchId));
    expect(rows[0]?.state).toStrictEqual('failed');
    expect(rows[0]?.attempts).toStrictEqual(3);
    expect(rows[0]?.lastErrorCode).toStrictEqual('workflow_domain_job_missing');
  } finally {
    await db.delete(workflowDispatches).where(eq(workflowDispatches.id, dispatchId)).catch(
      () => undefined,
    );
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId)).catch(() => undefined);
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined);
    await shutdownDb().catch(() => undefined);
  }
});

testCase('restart exhaustion completes a dispatch when the domain job already finished', {
  skip: !process.env['DATABASE_URL'],
}, async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const dispatchId = crypto.randomUUID();
  const binding = new TestWorkflowBinding();
  const runtime = {
    bindings: {
      QFLOW_SOURCE_MIGRATION_WORKFLOW: binding,
      QFLOW_AI_GENERATION_WORKFLOW: binding,
      QFLOW_RELEASE_BUILD_WORKFLOW: binding,
      QFLOW_MIGRATION_COMMIT_WORKFLOW: binding,
      QFLOW_BANK_ENRICHMENT_WORKFLOW: binding,
      QFLOW_QUESTION_ORGANIZATION_WORKFLOW: binding,
      QFLOW_ASSESSMENT_PRINT_WORKFLOW: binding,
    },
  };

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `workflow-complete-${tenantId.slice(0, 8)}`,
      name: 'Completed Workflow job test',
    });
    await db.insert(migrationBatches).values({
      id: batchId,
      tenantId,
      createdBy: userId,
      createdBySnapshot: { id: userId, email: 'complete@example.test' },
      purpose: 'generate_new',
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: '1'.repeat(64),
      sourceCount: 1,
    });
    await db.insert(migrationRuns).values({
      ...sourceMigrationRun({ id: jobId, batchId, tenantId }),
      status: 'analyzed',
      completedAt: new Date(),
    });
    await db.insert(workflowDispatches).values(pendingDispatch(dispatchId, jobId, tenantId));
    expect((await dispatchPendingWorkflowJobs(runtime)).ok).toStrictEqual(true);

    for (let attempt = 0; attempt < 3; attempt++) {
      binding.setStatus(dispatchId, 'errored');
      expect((await dispatchPendingWorkflowJobs(runtime)).ok).toStrictEqual(true);
    }
    binding.setStatus(dispatchId, 'errored');
    expect(await dispatchPendingWorkflowJobs(runtime)).toStrictEqual({
      ok: true,
      dispatched: 0,
      reconciled: 0,
      completed: 1,
    });

    const rows = await db.select().from(workflowDispatches)
      .where(eq(workflowDispatches.id, dispatchId));
    expect(rows[0]?.state).toStrictEqual('complete');
    expect(rows[0]?.workflowStatus).toStrictEqual('errored');
    expect(rows[0]?.lastErrorCode).toStrictEqual('workflow_terminal_after_domain_completion');
  } finally {
    await db.delete(workflowDispatches).where(eq(workflowDispatches.id, dispatchId)).catch(
      () => undefined,
    );
    await db.delete(migrationRuns).where(eq(migrationRuns.id, jobId)).catch(() => undefined);
    await db.delete(migrationBatches).where(eq(migrationBatches.id, batchId)).catch(
      () => undefined,
    );
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId)).catch(() => undefined);
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined);
    await shutdownDb().catch(() => undefined);
  }
});

testCase('restart exhaustion fails the owned AI generation job and dispatch together', {
  skip: !process.env['DATABASE_URL'],
}, async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const dispatchId = crypto.randomUUID();
  const binding = new TestWorkflowBinding();
  const runtime = {
    bindings: {
      QFLOW_SOURCE_MIGRATION_WORKFLOW: binding,
      QFLOW_AI_GENERATION_WORKFLOW: binding,
      QFLOW_RELEASE_BUILD_WORKFLOW: binding,
      QFLOW_MIGRATION_COMMIT_WORKFLOW: binding,
      QFLOW_BANK_ENRICHMENT_WORKFLOW: binding,
      QFLOW_QUESTION_ORGANIZATION_WORKFLOW: binding,
      QFLOW_ASSESSMENT_PRINT_WORKFLOW: binding,
    },
  };

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `workflow-ai-${tenantId.slice(0, 8)}`,
      name: 'AI Workflow failure test',
    });
    const userEmail = `workflow-ai-${userId.slice(0, 8)}@example.test`;
    await db.insert(users).values({ id: userId, email: userEmail, emailNormalized: userEmail });
    await db.insert(migrationBatches).values({
      id: batchId,
      tenantId,
      createdBy: userId,
      createdBySnapshot: { id: userId, email: userEmail },
      purpose: 'generate_new',
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: '2'.repeat(64),
      sourceCount: 1,
    });
    await db.insert(migrationRuns).values({
      ...sourceMigrationRun({ id: runId, batchId, tenantId }),
      status: 'analyzed',
      completedAt: new Date(),
    });
    await db.insert(aiGenerationJobsTable).values({
      id: jobId,
      tenantId,
      conversionRunId: runId,
      userId,
      status: 'queued',
      progress: 0,
      input: {},
      output: null,
      error: null,
      attempts: 0,
      maxAttempts: 3,
      leaseToken: null,
      startedAt: null,
      completedAt: null,
    });
    await db.insert(workflowDispatches).values(
      pendingDispatch(dispatchId, jobId, tenantId, 'ai_generation'),
    );
    expect((await dispatchPendingWorkflowJobs(runtime)).ok).toStrictEqual(true);

    for (let attempt = 0; attempt < 3; attempt++) {
      binding.setStatus(dispatchId, 'errored');
      expect((await dispatchPendingWorkflowJobs(runtime)).ok).toStrictEqual(true);
    }
    binding.setStatus(dispatchId, 'errored');
    expect((await dispatchPendingWorkflowJobs(runtime)).ok).toStrictEqual(true);

    const dispatches = await db.select().from(workflowDispatches)
      .where(eq(workflowDispatches.id, dispatchId));
    const jobs = await db.select().from(aiGenerationJobsTable)
      .where(eq(aiGenerationJobsTable.id, jobId));
    expect(dispatches[0]?.state).toStrictEqual('failed');
    expect(jobs[0]?.status).toStrictEqual('failed');
  } finally {
    await db.delete(workflowDispatches).where(eq(workflowDispatches.id, dispatchId)).catch(
      () => undefined,
    );
    await db.delete(aiGenerationJobsTable).where(eq(aiGenerationJobsTable.id, jobId)).catch(
      () => undefined,
    );
    await db.delete(migrationRuns).where(eq(migrationRuns.id, runId)).catch(() => undefined);
    await db.delete(migrationBatches).where(eq(migrationBatches.id, batchId)).catch(
      () => undefined,
    );
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId)).catch(() => undefined);
    await db.delete(users).where(eq(users.id, userId)).catch(() => undefined);
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined);
    await shutdownDb().catch(() => undefined);
  }
});

type WorkflowStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'errored'
  | 'terminated'
  | 'complete'
  | 'waiting'
  | 'waitingForPause'
  | 'unknown';

class TestWorkflowBinding {
  readonly created: Array<{ id: string; params: { jobId: string } }> = [];
  readonly skipped: string[] = [];
  readonly restarted: string[] = [];
  readonly #statuses = new Map<string, unknown>();

  get(id: string) {
    if (!this.#statuses.has(id)) throw new Error('Workflow instance not found.');
    return this.instance(id);
  }

  createBatch(inputs: readonly { id: string; params: { jobId: string } }[]) {
    const instances = inputs.flatMap((input) => {
      if (this.#statuses.has(input.id)) {
        this.skipped.push(input.id);
        return [];
      }
      this.created.push(input);
      this.#statuses.set(input.id, 'queued');
      return [this.instance(input.id)];
    });
    return Promise.resolve(instances);
  }

  setStatus(id: string, status: WorkflowStatus): void {
    if (!this.#statuses.has(id)) throw new Error('Workflow instance not found.');
    this.#statuses.set(id, status);
  }

  setRawStatus(id: string, status: unknown): void {
    if (!this.#statuses.has(id)) throw new Error('Workflow instance not found.');
    this.#statuses.set(id, status);
  }

  private instance(id: string) {
    return {
      status: () => Promise.resolve({ status: this.#statuses.get(id) }),
      restart: () => {
        this.restarted.push(id);
        this.#statuses.set(id, 'queued');
        return Promise.resolve();
      },
    };
  }
}

function pendingDispatch(
  id: string,
  jobId: string,
  tenantId: string,
  kind: 'source_migration' | 'ai_generation' = 'source_migration',
) {
  return {
    id,
    kind,
    jobId,
    tenantId,
    state: 'pending',
    workflowStatus: null,
    attempts: 0,
    lastErrorCode: null,
    startedAt: null,
    completedAt: null,
    lastCheckedAt: null,
  };
}

function sourceMigrationRun(input: {
  readonly id: string;
  readonly batchId: string;
  readonly tenantId: string;
}) {
  return {
    id: input.id,
    batchId: input.batchId,
    batchPosition: 1,
    tenantId: input.tenantId,
    sourceFilename: 'workflow-source.txt',
    sourceMime: 'text/plain',
    sourceSize: 1,
    adapterId: 'source-extraction',
    adapterLabel: 'Source extraction',
    adapterVersion: '1',
    status: 'queued',
    parts: [],
    summary: buildEmptyMigrationSummary(),
    destination: 'Assessment',
    blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
    attempts: 0,
    maxAttempts: 3,
    leaseToken: null,
    lastError: null,
    startedAt: null,
    completedAt: null,
    approvalStatus: 'draft',
    submittedBy: null,
    submittedAt: null,
    decidedBy: null,
    decidedAt: null,
    approvalNote: null,
    assessmentId: null,
    committedAt: null,
  };
}

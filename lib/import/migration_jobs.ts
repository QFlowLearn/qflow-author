import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, type QflowDatabase, type QflowDatabaseTransaction } from '../db.ts';
import { migrationBatches, migrationRuns, workflowDispatches } from '../db/schema.ts';
import type { WorkflowTerminalDomainOutcome } from '../job_failure.ts';
import { recordAuditEventInTransaction } from '../services/audit_logs.ts';
import { type RequestContext, type WorkerContext, workerContext } from '../tenants.ts';
import type { RetryableMigrationFailure, TerminalMigrationFailure } from './migration_failures.ts';
import { migrationFailureSummary } from './migration_failures.ts';
import { buildEmptyMigrationSummary, emptyMigrationCounts } from './migration_analysis.ts';
import { toMigrationJsonColumn } from './migration_run_store.ts';
import { draftApprovalColumns } from './migration_state.ts';
import { getMigrationRun } from './migration_run_queries.ts';
import type { MigrationRunRecord } from './migration_types.ts';
import type { ConversionPurpose } from './migration_types.ts';

/** Lease-owned migration work claimed by one worker attempt. */
export type ClaimedMigrationRun = {
  readonly id: string;
  readonly batchId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly purpose: ConversionPurpose;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly leaseToken: string;
  readonly workflowExecutionId: string;
};

/** Signals that a guarded worker transition no longer owns the run. */
export class MigrationLeaseLostError extends Error {
  readonly runId: string;

  constructor(runId: string) {
    super(`Migration analysis lease was lost for run ${runId}.`);
    this.name = 'MigrationLeaseLostError';
    this.runId = runId;
  }
}

/**
 * Atomically claims one source run for a Workflow execution.
 *
 * Replaying the same stable execution returns its persisted lease. Another execution cannot take
 * ownership; an explicit user retry clears ownership and creates a new dispatch.
 */
export async function claimMigrationRun(
  runId: string,
  workflowExecutionId: string,
  database: QflowDatabase = db,
): Promise<ClaimedMigrationRun | null> {
  return await database.transaction(async (tx) => {
    const candidates = await tx.select({
      id: migrationRuns.id,
      batchId: migrationRuns.batchId,
      tenantId: migrationRuns.tenantId,
      userId: migrationBatches.createdBy,
      purpose: migrationBatches.purpose,
      status: migrationRuns.status,
      attempts: migrationRuns.attempts,
      maxAttempts: migrationRuns.maxAttempts,
      leaseToken: migrationRuns.leaseToken,
    }).from(migrationRuns)
      .innerJoin(migrationBatches, eq(migrationBatches.id, migrationRuns.batchId))
      .where(and(
        eq(migrationRuns.id, runId),
        inArray(migrationRuns.status, ['queued', 'analyzing']),
      ))
      .for('update')
      .limit(1);
    const candidate = candidates[0];
    if (!candidate) return null;

    const ownsDispatch = await hasOpenMigrationDispatch(tx, {
      runId: candidate.id,
      tenantId: candidate.tenantId,
      workflowExecutionId,
    });
    if (!ownsDispatch) return null;

    if (
      candidate.status === 'analyzing' &&
      candidate.leaseToken
    ) {
      return claimedMigrationRun(candidate, candidate.leaseToken, workflowExecutionId);
    }
    if (candidate.attempts >= candidate.maxAttempts) {
      await failExhaustedMigrationRun(tx, candidate);
      return null;
    }

    const leaseToken = crypto.randomUUID();
    const updated = await tx.update(migrationRuns).set({
      status: 'analyzing',
      attempts: sql`${migrationRuns.attempts} + 1`,
      leaseToken,
      lastError: null,
      startedAt: sql`now()`,
      completedAt: null,
      updatedAt: sql`now()`,
    }).where(and(
      eq(migrationRuns.id, candidate.id),
      inArray(migrationRuns.status, ['queued', 'analyzing']),
      sql`${migrationRuns.attempts} < ${migrationRuns.maxAttempts}`,
    )).returning({ attempts: migrationRuns.attempts });
    const claimed = updated[0];
    if (!claimed) return null;
    return claimedMigrationRun(
      { ...candidate, attempts: claimed.attempts },
      leaseToken,
      workflowExecutionId,
    );
  });
}

/** Requeue an owned retryable attempt without discarding its retained source. */
export async function markMigrationRunRetry(
  job: ClaimedMigrationRun,
  failure: RetryableMigrationFailure,
  database: QflowDatabase = db,
): Promise<void> {
  const message = migrationFailureSummary(failure);
  await database.transaction(async (tx) => {
    const updated = await tx.update(migrationRuns).set({
      status: 'queued',
      leaseToken: null,
      lastError: message,
      startedAt: null,
      completedAt: null,
      updatedAt: sql`now()`,
    }).where(ownedAnalyzingRun(job.id, job.leaseToken)).returning({ id: migrationRuns.id });
    if (!updated.length && await migrationTransitionAlreadyApplied(tx, job, 'queued')) return;
    if (!updated.length) throw new MigrationLeaseLostError(job.id);
    await recordAuditEventInTransaction(tx, {
      tenantId: job.tenantId,
      actorUserId: job.userId,
      action: 'migration_retry_queued',
      metadata: {
        batchId: job.batchId,
        runId: job.id,
        attempts: job.attempts,
        failureCode: failure.code,
      },
    });
  });
}

/** Mark an owned attempt terminal for a permanent or exhausted failure. */
export async function markMigrationRunFailed(
  job: ClaimedMigrationRun,
  failure: TerminalMigrationFailure,
  database: QflowDatabase = db,
): Promise<void> {
  const message = migrationFailureSummary(failure);
  await database.transaction(async (tx) => {
    const updated = await tx.update(migrationRuns).set({
      status: 'failed',
      summary: toMigrationJsonColumn(buildFailedSummary(message)),
      leaseToken: null,
      lastError: message,
      startedAt: null,
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
    }).where(ownedAnalyzingRun(job.id, job.leaseToken)).returning({ id: migrationRuns.id });
    if (!updated.length && await migrationTransitionAlreadyApplied(tx, job, 'failed')) return;
    if (!updated.length) throw new MigrationLeaseLostError(job.id);
    await recordAuditEventInTransaction(tx, {
      tenantId: job.tenantId,
      actorUserId: job.userId,
      action: 'migration_analysis_failed',
      metadata: {
        batchId: job.batchId,
        runId: job.id,
        attempts: job.attempts,
        failureCode: failure.code,
      },
    });
  });
}

/** Return one terminally failed run to the queue after an explicit user request. */
export async function retryMigrationRun(
  ctx: RequestContext,
  runId: string,
): Promise<MigrationRunRecord> {
  const workflowExecutionId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.update(workflowDispatches).set({
      state: 'failed',
      startedAt: sql`coalesce(${workflowDispatches.startedAt}, now())`,
      completedAt: sql`now()`,
      lastErrorCode: 'workflow_superseded_by_user_retry',
      updatedAt: sql`now()`,
    }).where(and(
      eq(workflowDispatches.kind, 'source_migration'),
      eq(workflowDispatches.jobId, runId),
      eq(workflowDispatches.tenantId, ctx.tenantId),
      inArray(workflowDispatches.state, ['pending', 'active']),
    ));
    const updated = await tx.update(migrationRuns).set({
      status: 'queued',
      parts: [],
      organizationGroups: [],
      summary: toMigrationJsonColumn(buildEmptyMigrationSummary()),
      attempts: 0,
      leaseToken: null,
      lastError: null,
      startedAt: null,
      completedAt: null,
      ...draftApprovalColumns(),
      assessmentId: null,
      committedAt: null,
      updatedAt: sql`now()`,
    }).where(and(
      eq(migrationRuns.id, runId),
      eq(migrationRuns.tenantId, ctx.tenantId),
      eq(migrationRuns.status, 'failed'),
    )).returning({
      batchId: migrationRuns.batchId,
      sourceFilename: migrationRuns.sourceFilename,
    });
    const row = updated[0];
    if (!row) {
      throw new Error('Only failed migration runs can be retried.');
    }
    await tx.insert(workflowDispatches).values({
      id: workflowExecutionId,
      kind: 'source_migration',
      jobId: runId,
      tenantId: ctx.tenantId,
      state: 'pending',
      workflowStatus: null,
      attempts: 0,
      lastErrorCode: null,
      startedAt: null,
      completedAt: null,
      lastCheckedAt: null,
    });
    await recordAuditEventInTransaction(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'migration_retry_queued',
      metadata: {
        batchId: row.batchId,
        runId,
        workflowExecutionId,
        sourceFilename: row.sourceFilename,
      },
    });
  });
  const run = await getMigrationRun(ctx, runId);
  if (!run) throw new Error('Migration run not found after retry.');
  return run;
}

/** Build the tenant scope for a persisted migration command. */
export function contextForClaim(job: ClaimedMigrationRun): WorkerContext {
  return workerContext(job.tenantId, job.userId);
}

function ownedAnalyzingRun(runId: string, leaseToken: string) {
  return and(
    eq(migrationRuns.id, runId),
    eq(migrationRuns.status, 'analyzing'),
    eq(migrationRuns.leaseToken, leaseToken),
  );
}

async function migrationTransitionAlreadyApplied(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  job: ClaimedMigrationRun,
  status: 'queued' | 'failed',
): Promise<boolean> {
  const rows = await tx.select({ id: migrationRuns.id }).from(migrationRuns).innerJoin(
    workflowDispatches,
    and(
      eq(workflowDispatches.id, job.workflowExecutionId),
      eq(workflowDispatches.kind, 'source_migration'),
      eq(workflowDispatches.jobId, job.id),
      eq(workflowDispatches.tenantId, job.tenantId),
      inArray(workflowDispatches.state, ['pending', 'active']),
    ),
  ).where(and(
    eq(migrationRuns.id, job.id),
    eq(migrationRuns.status, status),
  )).limit(1);
  return rows.length === 1;
}

/** Settle a terminal source Workflow, failing its job when work is still active. */
export async function settleMigrationRunAfterWorkflowTerminal(
  tx: QflowDatabaseTransaction,
  input: {
    readonly runId: string;
    readonly tenantId: string;
  },
): Promise<WorkflowTerminalDomainOutcome> {
  const candidates = await tx.select({
    batchId: migrationRuns.batchId,
    userId: migrationBatches.createdBy,
    attempts: migrationRuns.attempts,
    status: migrationRuns.status,
  }).from(migrationRuns)
    .innerJoin(migrationBatches, eq(migrationBatches.id, migrationRuns.batchId))
    .where(and(
      eq(migrationRuns.id, input.runId),
      eq(migrationRuns.tenantId, input.tenantId),
    )).for('update').limit(1);
  const candidate = candidates[0];
  if (!candidate) return { _tag: 'JobMissing' };
  if (candidate.status === 'failed') return { _tag: 'AlreadyFailed' };
  if (candidate.status === 'analyzed' || candidate.status === 'committed') {
    return { _tag: 'AlreadyCompleted' };
  }
  if (candidate.status !== 'queued' && candidate.status !== 'analyzing') {
    throw new Error('Persisted migration run has an invalid status.');
  }

  const failure: RetryableMigrationFailure = {
    _tag: 'Retryable',
    code: 'unexpected_failure',
    message: 'QFlowLearn could not finish source processing because an internal dependency failed.',
    cause: null,
  };
  const message = migrationFailureSummary(failure);
  const updated = await tx.update(migrationRuns).set({
    status: 'failed',
    summary: toMigrationJsonColumn(buildFailedSummary(message)),
    leaseToken: null,
    lastError: message,
    startedAt: null,
    completedAt: sql`now()`,
    updatedAt: sql`now()`,
  }).where(and(
    eq(migrationRuns.id, input.runId),
    eq(migrationRuns.tenantId, input.tenantId),
    inArray(migrationRuns.status, ['queued', 'analyzing']),
  )).returning({ id: migrationRuns.id });
  if (!updated.length) throw new Error('Migration run changed while its row lock was held.');

  await recordAuditEventInTransaction(tx, {
    tenantId: input.tenantId,
    actorUserId: candidate.userId,
    action: 'migration_analysis_failed',
    metadata: {
      batchId: candidate.batchId,
      runId: input.runId,
      attempts: candidate.attempts,
      failureCode: failure.code,
    },
  });
  return { _tag: 'Failed' };
}

async function hasOpenMigrationDispatch(
  tx: QflowDatabaseTransaction,
  input: {
    readonly runId: string;
    readonly tenantId: string;
    readonly workflowExecutionId: string;
  },
): Promise<boolean> {
  const rows = await tx.select({ id: workflowDispatches.id }).from(workflowDispatches).where(and(
    eq(workflowDispatches.id, input.workflowExecutionId),
    eq(workflowDispatches.kind, 'source_migration'),
    eq(workflowDispatches.jobId, input.runId),
    eq(workflowDispatches.tenantId, input.tenantId),
    inArray(workflowDispatches.state, ['pending', 'active']),
  )).limit(1);
  return rows.length === 1;
}

async function failExhaustedMigrationRun(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  candidate: {
    readonly id: string;
    readonly batchId: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly attempts: number;
  },
): Promise<void> {
  const failure: RetryableMigrationFailure = {
    _tag: 'Retryable',
    code: 'unexpected_failure',
    message: 'QFlowLearn could not finish source processing because an internal dependency failed.',
    cause: null,
  };
  const message = migrationFailureSummary(failure);
  await tx.update(migrationRuns).set({
    status: 'failed',
    summary: toMigrationJsonColumn(buildFailedSummary(message)),
    leaseToken: null,
    lastError: message,
    startedAt: null,
    completedAt: sql`now()`,
    updatedAt: sql`now()`,
  }).where(and(
    eq(migrationRuns.id, candidate.id),
    inArray(migrationRuns.status, ['queued', 'analyzing']),
  ));
  await recordAuditEventInTransaction(tx, {
    tenantId: candidate.tenantId,
    actorUserId: candidate.userId,
    action: 'migration_analysis_failed',
    metadata: {
      batchId: candidate.batchId,
      runId: candidate.id,
      attempts: candidate.attempts,
      failureCode: failure.code,
    },
  });
}

function claimedMigrationRun(
  candidate: {
    readonly id: string;
    readonly batchId: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly purpose: unknown;
    readonly attempts: number;
    readonly maxAttempts: number;
  },
  leaseToken: string,
  workflowExecutionId: string,
): ClaimedMigrationRun {
  return {
    id: candidate.id,
    batchId: candidate.batchId,
    tenantId: candidate.tenantId,
    userId: candidate.userId,
    purpose: parseConversionPurpose(candidate.purpose),
    attempts: candidate.attempts,
    maxAttempts: candidate.maxAttempts,
    leaseToken,
    workflowExecutionId,
  };
}

function buildFailedSummary(message: string) {
  return {
    counts: { ...emptyMigrationCounts(), warnings: 1 },
    warningCounts: { IMPORT_FAILED: 1 },
    itemTypeCounts: {},
    globalWarnings: [{ code: 'IMPORT_FAILED', message }],
  };
}

function parseConversionPurpose(value: unknown): ConversionPurpose {
  if (value === 'recover_existing' || value === 'generate_new') return value;
  throw new Error('Claimed migration run has an invalid conversion purpose.');
}

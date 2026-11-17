import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm';

import {
  parseAssessmentBlueprint,
  requireDefinedAssessmentBlueprint,
} from '../assessment_blueprint.ts';
import {
  type AIGenerationJobInput,
  AIGenerationJobInputError,
  type AIGenerationJobStatus,
  parseAIGenerationJobInput,
  type RetryableAIGenerationJobErrorCode,
  safeAIGenerationJobErrorMessage,
  sameAIGenerationJobInput,
  type TerminalAIGenerationJobErrorCode,
} from '../ai_generation_job.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import {
  type AIGenerationJobOutput,
  AIGenerationLeaseLostError,
  type AIGenerationProviderCheckpoint,
  parseAIGenerationJobOutput,
} from '../conversion/generation_checkpoint.ts';
import { db, type QflowDatabase, type QflowDatabaseTransaction } from '../db.ts';
import {
  aiGenerationJobsTable,
  migrationBatches,
  migrationItems,
  migrationRuns,
  workflowDispatches,
} from '../db/schema.ts';
import type { WorkflowTerminalDomainOutcome } from '../job_failure.ts';
import {
  parseNonEmptyString,
  parseNonNegativeInteger,
  parseOptionalTimestamp,
  parsePositiveInteger,
  parseTimestamp,
} from '../persistence_parse.ts';
import { type RequestContext, type WorkerContext } from '../tenants.ts';
import { recordAuditEventInTransaction } from './audit_logs.ts';

/** Parsed AI generation job reconstructed from persistence. */
export type AIGenerationJobRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly conversionRunId: string;
  readonly userId: string;
  readonly status: AIGenerationJobStatus;
  readonly progress: number;
  readonly input: AIGenerationJobInput;
  readonly output: AIGenerationJobOutput | null;
  readonly error: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly leaseToken: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** AI generation job whose lease is owned by one open Workflow dispatch. */
export type ClaimedAIGenerationJob = AIGenerationJobRecord & {
  readonly workflowExecutionId: string;
};

type OwnedJobUpdate = {
  readonly status?: AIGenerationJobStatus;
  readonly progress?: number;
  readonly output?: Record<string, unknown> | null;
  readonly error?: string | null;
  readonly leaseToken?: string | null;
  readonly startedAt?: Date | SQL | null;
  readonly completedAt?: Date | SQL | null;
  readonly updatedAt?: Date | SQL;
};
/** Enqueue or replay the one active generation job for a conversion run. */
export async function enqueueAIGenerationJob(
  ctx: RequestContext,
  conversionRunId: string,
  input: AIGenerationJobInput,
): Promise<AIGenerationJobRecord> {
  const jobId = crypto.randomUUID();
  const workflowExecutionId = crypto.randomUUID();
  return await db.transaction(async (tx) => {
    const runs = await tx.select({
      status: migrationRuns.status,
      batchId: migrationRuns.batchId,
      blueprint: migrationRuns.blueprint,
    }).from(migrationRuns).where(and(
      eq(migrationRuns.id, conversionRunId),
      eq(migrationRuns.tenantId, ctx.tenantId),
    )).for('update').limit(1);
    if (!runs.length) throw new AIGenerationJobInputError('Conversion run not found.');
    if (runs[0].status !== 'analyzed') {
      throw new AIGenerationJobInputError(
        'Generation requires an analyzed conversion with no existing questions.',
      );
    }
    const batches = await tx.select({ purpose: migrationBatches.purpose })
      .from(migrationBatches)
      .where(and(
        eq(migrationBatches.id, runs[0].batchId),
        eq(migrationBatches.tenantId, ctx.tenantId),
      ))
      .limit(1);
    if (!batches.length || batches[0].purpose !== 'generate_new') {
      throw new AIGenerationJobInputError(
        'AI generation requires a generate-from-source conversion.',
      );
    }
    const existingItems = await tx.select({ id: migrationItems.id })
      .from(migrationItems)
      .where(eq(migrationItems.runId, conversionRunId))
      .limit(1);
    if (existingItems.length) {
      throw new AIGenerationJobInputError(
        'Generation requires an analyzed conversion with no existing questions.',
      );
    }

    const inserted = await tx.insert(aiGenerationJobsTable).values({
      id: jobId,
      tenantId: ctx.tenantId,
      conversionRunId,
      userId: ctx.userId,
      status: 'queued',
      progress: 0,
      input: input as unknown as Record<string, unknown>,
      output: null,
      attempts: 0,
      maxAttempts: 3,
      leaseToken: null,
    }).onConflictDoNothing().returning();
    if (!inserted.length) {
      const active = await tx.select().from(aiGenerationJobsTable).where(and(
        eq(aiGenerationJobsTable.tenantId, ctx.tenantId),
        eq(aiGenerationJobsTable.conversionRunId, conversionRunId),
        or(
          eq(aiGenerationJobsTable.status, 'queued'),
          eq(aiGenerationJobsTable.status, 'running'),
        ),
      )).limit(1);
      if (!active.length) throw new Error('Failed to enqueue AI generation job.');
      const activeJob = mapRow(active[0]);
      if (!sameAIGenerationJobInput(activeJob.input, input)) {
        throw new AIGenerationJobInputError(
          'A different generation command is already active for this conversion.',
        );
      }
      const persistedBlueprint = requireDefinedAssessmentBlueprint(
        parseAssessmentBlueprint(runs[0].blueprint),
      );
      if (
        canonicalJsonStringify(persistedBlueprint) !==
          canonicalJsonStringify(input.blueprint)
      ) {
        throw new Error('Active generation job and conversion blueprint disagree.');
      }
      return activeJob;
    }

    await tx.update(migrationRuns).set({
      blueprint: input.blueprint,
      updatedAt: sql`now()`,
    }).where(and(
      eq(migrationRuns.id, conversionRunId),
      eq(migrationRuns.tenantId, ctx.tenantId),
    ));
    await tx.insert(workflowDispatches).values({
      id: workflowExecutionId,
      kind: 'ai_generation',
      jobId: inserted[0].id,
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
      action: 'conversion_generation_started',
      metadata: {
        runId: conversionRunId,
        jobId: inserted[0].id,
        blueprint: input.blueprint,
      },
    });
    return mapRow(inserted[0]);
  });
}

/** Find one tenant-scoped generation job. */
export async function getAIGenerationJob(
  ctx: RequestContext | WorkerContext,
  conversionRunId: string,
  jobId: string,
  database: QflowDatabase = db,
): Promise<AIGenerationJobRecord | null> {
  const rows = await database.select().from(aiGenerationJobsTable).where(and(
    eq(aiGenerationJobsTable.id, jobId),
    eq(aiGenerationJobsTable.tenantId, ctx.tenantId),
    eq(aiGenerationJobsTable.conversionRunId, conversionRunId),
  )).limit(1);
  return rows.length ? mapRow(rows[0]) : null;
}

/**
 * Atomically claims one AI job for a Workflow execution.
 *
 * Replaying the same stable execution returns its persisted lease. Another execution cannot take
 * ownership; an explicit user retry clears ownership and creates a new dispatch.
 */
export async function claimAIGenerationJob(
  jobId: string,
  workflowExecutionId: string,
  database: QflowDatabase = db,
): Promise<ClaimedAIGenerationJob | null> {
  return await database.transaction(async (tx) => {
    const rows = await tx.select()
      .from(aiGenerationJobsTable)
      .where(and(
        eq(aiGenerationJobsTable.id, jobId),
        inArray(aiGenerationJobsTable.status, ['queued', 'running']),
      ))
      .for('update')
      .limit(1);
    const candidate = rows[0];
    if (!candidate) return null;
    const ownsDispatch = await hasOpenAIGenerationDispatch(tx, {
      jobId: candidate.id,
      tenantId: candidate.tenantId,
      workflowExecutionId,
    });
    if (!ownsDispatch) return null;
    if (candidate.status === 'running' && candidate.leaseToken) {
      return { ...mapRow(candidate), workflowExecutionId };
    }
    if (candidate.attempts >= candidate.maxAttempts) {
      await failActiveAIGenerationJob(tx, candidate);
      return null;
    }

    const leaseToken = crypto.randomUUID();
    const updated = await tx.update(aiGenerationJobsTable).set({
      status: 'running',
      progress: 5,
      leaseToken,
      error: null,
      startedAt: sql`now()`,
      completedAt: null,
      updatedAt: sql`now()`,
      attempts: sql`${aiGenerationJobsTable.attempts} + 1`,
    }).where(and(
      eq(aiGenerationJobsTable.id, candidate.id),
      inArray(aiGenerationJobsTable.status, ['queued', 'running']),
      sql`${aiGenerationJobsTable.attempts} < ${aiGenerationJobsTable.maxAttempts}`,
    )).returning();
    return updated.length ? { ...mapRow(updated[0]), workflowExecutionId } : null;
  });
}

/** Update progress and heartbeat only while the caller owns the active lease. */
export async function markAIGenerationJobProgress(
  jobId: string,
  leaseToken: string,
  progress: number,
  database: QflowDatabase = db,
): Promise<void> {
  if (!Number.isFinite(progress)) throw new Error('AI generation progress must be finite.');
  const nextProgress = Math.max(0, Math.min(99, Math.round(progress)));
  await updateOwnedJob(database, jobId, leaseToken, {
    progress: nextProgress,
    updatedAt: sql`now()`,
  });
}

/** Persist a resumable provider response under the active attempt lease. */
export async function storeAIGenerationProviderCheckpoint(
  jobId: string,
  leaseToken: string,
  checkpoint: AIGenerationProviderCheckpoint,
  database: QflowDatabase = db,
): Promise<void> {
  await updateOwnedJob(database, jobId, leaseToken, {
    output: checkpoint as unknown as Record<string, unknown>,
    progress: 70,
    updatedAt: sql`now()`,
  });
}

/** Return an owned failed attempt to the queue without discarding provider output. */
export async function markAIGenerationJobRetry(
  jobId: string,
  leaseToken: string,
  workflowExecutionId: string,
  code: RetryableAIGenerationJobErrorCode,
  database: QflowDatabase = db,
): Promise<void> {
  await updateOwnedJob(database, jobId, leaseToken, {
    status: 'queued',
    progress: 0,
    leaseToken: null,
    error: safeAIGenerationJobErrorMessage(code),
    startedAt: null,
    completedAt: null,
    updatedAt: sql`now()`,
  }, { workflowExecutionId, status: 'queued' });
}

/** Mark an owned failed attempt terminal without discarding provider output. */
export async function markAIGenerationJobFailed(
  jobId: string,
  leaseToken: string,
  workflowExecutionId: string,
  code: TerminalAIGenerationJobErrorCode,
  database: QflowDatabase = db,
): Promise<void> {
  await updateOwnedJob(database, jobId, leaseToken, {
    status: 'failed',
    progress: 100,
    leaseToken: null,
    error: safeAIGenerationJobErrorMessage(code),
    completedAt: sql`now()`,
    updatedAt: sql`now()`,
  }, { workflowExecutionId, status: 'failed' });
}

/** Execute one claimed job, resuming from a durable provider checkpoint when present. */
async function updateOwnedJob(
  database: QflowDatabase,
  jobId: string,
  leaseToken: string,
  values: OwnedJobUpdate,
  replay?: {
    readonly workflowExecutionId: string;
    readonly status: 'queued' | 'failed';
  },
): Promise<void> {
  const updated = await database.update(aiGenerationJobsTable).set(values).where(and(
    eq(aiGenerationJobsTable.id, jobId),
    eq(aiGenerationJobsTable.status, 'running'),
    eq(aiGenerationJobsTable.leaseToken, leaseToken),
  )).returning({ id: aiGenerationJobsTable.id });
  if (!updated.length && replay) {
    const applied = await database.select({ id: aiGenerationJobsTable.id })
      .from(aiGenerationJobsTable)
      .innerJoin(
        workflowDispatches,
        and(
          eq(workflowDispatches.id, replay.workflowExecutionId),
          eq(workflowDispatches.kind, 'ai_generation'),
          eq(workflowDispatches.jobId, jobId),
          inArray(workflowDispatches.state, ['pending', 'active']),
        ),
      )
      .where(and(
        eq(aiGenerationJobsTable.id, jobId),
        eq(aiGenerationJobsTable.status, replay.status),
      )).limit(1);
    if (applied.length) return;
  }
  if (!updated.length) throw new AIGenerationLeaseLostError(jobId);
}

function mapRow(row: typeof aiGenerationJobsTable.$inferSelect): AIGenerationJobRecord {
  const status = parseJobStatus(row.status);
  const output = parseAIGenerationJobOutput(row.output);
  const leaseToken = row.leaseToken;
  const startedAt = parseOptionalTimestamp(row.startedAt, 'AI job started timestamp is invalid.');
  const completedAt = parseOptionalTimestamp(
    row.completedAt,
    'AI job completed timestamp is invalid.',
  );
  if (status === 'running' && (!leaseToken || !startedAt || completedAt)) {
    throw new Error('Running AI job has contradictory lease timestamps.');
  }
  if (status !== 'running' && leaseToken) {
    throw new Error('Non-running AI job cannot retain a lease token.');
  }
  if (status === 'completed' && (output?._tag !== 'completed' || !completedAt)) {
    throw new Error('Completed AI job is missing terminal output or timestamp.');
  }
  if (status === 'failed' && !completedAt) {
    throw new Error('Failed AI job is missing its completion timestamp.');
  }
  return {
    id: parseNonEmptyString(row.id, 'AI job ID is required.'),
    tenantId: parseNonEmptyString(row.tenantId, 'AI job tenant ID is required.'),
    conversionRunId: parseNonEmptyString(
      row.conversionRunId,
      'AI job conversion run ID is required.',
    ),
    userId: parseNonEmptyString(row.userId, 'AI job user ID is required.'),
    status,
    progress: parseIntegerInRange(row.progress, 0, 100, 'AI job progress is invalid.'),
    input: parseAIGenerationJobInput(row.input),
    output,
    error: row.error,
    attempts: parseNonNegativeInteger(row.attempts, 'AI job attempts are invalid.'),
    maxAttempts: parsePositiveInteger(row.maxAttempts, 'AI job max attempts are invalid.'),
    leaseToken,
    startedAt,
    completedAt,
    createdAt: parseTimestamp(row.createdAt, 'AI job created timestamp is invalid.'),
    updatedAt: parseTimestamp(row.updatedAt, 'AI job updated timestamp is invalid.'),
  };
}

/** Settle a terminal AI Workflow, failing its job when work is still active. */
export async function settleAIGenerationJobAfterWorkflowTerminal(
  tx: QflowDatabaseTransaction,
  input: {
    readonly jobId: string;
    readonly tenantId: string;
  },
): Promise<WorkflowTerminalDomainOutcome> {
  const candidates = await tx.select().from(aiGenerationJobsTable).where(and(
    eq(aiGenerationJobsTable.id, input.jobId),
    eq(aiGenerationJobsTable.tenantId, input.tenantId),
  )).for('update').limit(1);
  const candidate = candidates[0];
  if (!candidate) return { _tag: 'JobMissing' };
  if (candidate.status === 'failed') return { _tag: 'AlreadyFailed' };
  if (candidate.status === 'completed') return { _tag: 'AlreadyCompleted' };
  if (candidate.status !== 'queued' && candidate.status !== 'running') {
    throw new Error('Persisted AI generation job has an invalid status.');
  }

  await failActiveAIGenerationJob(tx, candidate);
  return { _tag: 'Failed' };
}

async function hasOpenAIGenerationDispatch(
  tx: QflowDatabaseTransaction,
  input: {
    readonly jobId: string;
    readonly tenantId: string;
    readonly workflowExecutionId: string;
  },
): Promise<boolean> {
  const rows = await tx.select({ id: workflowDispatches.id }).from(workflowDispatches).where(and(
    eq(workflowDispatches.id, input.workflowExecutionId),
    eq(workflowDispatches.kind, 'ai_generation'),
    eq(workflowDispatches.jobId, input.jobId),
    eq(workflowDispatches.tenantId, input.tenantId),
    inArray(workflowDispatches.state, ['pending', 'active']),
  )).limit(1);
  return rows.length === 1;
}

async function failActiveAIGenerationJob(
  tx: QflowDatabaseTransaction,
  candidate: typeof aiGenerationJobsTable.$inferSelect,
): Promise<void> {
  const code = 'unknown' as const;
  const updated = await tx.update(aiGenerationJobsTable).set({
    status: 'failed',
    progress: 100,
    leaseToken: null,
    error: safeAIGenerationJobErrorMessage(code),
    completedAt: sql`now()`,
    updatedAt: sql`now()`,
  }).where(and(
    eq(aiGenerationJobsTable.id, candidate.id),
    eq(aiGenerationJobsTable.tenantId, candidate.tenantId),
    inArray(aiGenerationJobsTable.status, ['queued', 'running']),
  )).returning({ id: aiGenerationJobsTable.id });
  if (!updated.length) throw new Error('AI generation job changed while its row lock was held.');
  await recordAuditEventInTransaction(tx, {
    tenantId: candidate.tenantId,
    actorUserId: candidate.userId,
    action: 'assessment_generation_failed',
    metadata: {
      runId: candidate.conversionRunId,
      jobId: candidate.id,
      attempts: candidate.attempts,
      failureCode: code,
    },
  });
}

function parseJobStatus(value: unknown): AIGenerationJobStatus {
  if (value === 'queued' || value === 'running' || value === 'completed' || value === 'failed') {
    return value;
  }
  throw new Error(`Invalid AI generation job status: ${String(value)}`);
}
function parseIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  message: string,
): number {
  if (
    typeof value !== 'number' || !Number.isInteger(value) ||
    value < minimum || value > maximum
  ) {
    throw new Error(message);
  }
  return value;
}

import { settlePrintAfterWorkflowTerminal } from '../services/assessment_print_build.ts';
import { settleOrganizationAfterWorkflowTerminal } from '../services/question_organization_settlement.ts';
import { settleMigrationCommitAfterWorkflowTerminal } from '../import/migration_commit_job.ts';
import { settleEnrichmentAfterWorkflowTerminal } from '../services/bank_enrichment_settlement.ts';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { mapConcurrentBounded } from '../bounded_concurrency.ts';
import { getDb, type QflowDatabase } from '../db.ts';
import { workflowDispatches } from '../db/schema.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { settleMigrationRunAfterWorkflowTerminal } from '../import/migration_jobs.ts';
import type { WorkflowTerminalDomainOutcome } from '../job_failure.ts';
import { getRuntimeBinding, type RuntimeSource } from '../runtime.ts';
import { recordAuditEventInTransaction } from '../services/audit_logs.ts';
import { settleAIGenerationJobAfterWorkflowTerminal } from '../services/ai_generation_job_store.ts';
import { settleReleaseBuildAfterWorkflowTerminal } from '../services/release_build_processor.ts';

/** Durable job kinds backed by distinct Cloudflare Workflow definitions. */
export type QflowWorkflowKind =
  | 'source_migration'
  | 'ai_generation'
  | 'release_build'
  | 'migration_commit'
  | 'bank_enrichment'
  | 'question_organization'
  | 'assessment_print';

/** Cloudflare Workflow statuses accepted at the platform boundary. */
export type QflowWorkflowStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'errored'
  | 'terminated'
  | 'complete'
  | 'waiting'
  | 'waitingForPause'
  | 'unknown';

/** Safe result from delivering and reconciling durable Workflow executions. */
export type WorkflowDispatchResult =
  | {
    readonly ok: true;
    readonly dispatched: number;
    readonly reconciled: number;
    readonly completed: number;
  }
  | {
    readonly ok: false;
    readonly error: {
      readonly _tag: 'WorkflowBindingMissing' | 'WorkflowDispatchFailed';
      readonly message: string;
      readonly phase:
        | 'resolve_bindings'
        | 'load_dispatch_rows'
        | 'ensure_workflow_instances'
        | 'reconcile_workflow_instances';
      readonly cause: {
        readonly name: string;
        readonly code: string | null;
      };
    };
  };

type WorkflowInstanceLike = {
  status(): Promise<unknown>;
  restart(): Promise<void>;
};

type WorkflowBatchInput = {
  readonly id: string;
  readonly params: { readonly jobId: string };
};

type WorkflowBindingLike = {
  /** Idempotently creates missing instances and skips IDs that still exist. */
  createBatch(inputs: readonly WorkflowBatchInput[]): Promise<readonly WorkflowInstanceLike[]>;
  get(id: string): WorkflowInstanceLike | Promise<WorkflowInstanceLike>;
};

type DispatchRow = {
  readonly id: string;
  readonly kind: QflowWorkflowKind;
  readonly jobId: string;
  readonly tenantId: string;
  readonly state: 'pending' | 'active';
  readonly attempts: number;
};

type ReconciliationOutcome =
  | { readonly _tag: 'Reconciled' }
  | { readonly _tag: 'Completed' }
  | { readonly _tag: 'Observed' }
  | {
    readonly _tag: 'DispatchFailure';
    readonly cause: unknown;
  };

type TerminalWorkflowObservation =
  | { readonly _tag: 'PlatformCompleted'; readonly status: 'complete' }
  | {
    readonly _tag: 'RestartExhausted';
    readonly status: 'errored' | 'terminated';
  };

type TerminalDispatchDecision = {
  readonly state: 'complete' | 'failed';
  readonly lastErrorCode:
    | 'workflow_completed_before_domain_terminal'
    | 'workflow_domain_job_missing'
    | 'workflow_restart_exhausted'
    | 'workflow_terminal_after_domain_completion'
    | null;
};

const BINDING_NAMES = {
  source_migration: 'QFLOW_SOURCE_MIGRATION_WORKFLOW',
  ai_generation: 'QFLOW_AI_GENERATION_WORKFLOW',
  release_build: 'QFLOW_RELEASE_BUILD_WORKFLOW',
  migration_commit: 'QFLOW_MIGRATION_COMMIT_WORKFLOW',
  bank_enrichment: 'QFLOW_BANK_ENRICHMENT_WORKFLOW',
  question_organization: 'QFLOW_QUESTION_ORGANIZATION_WORKFLOW',
  assessment_print: 'QFLOW_ASSESSMENT_PRINT_WORKFLOW',
} as const satisfies Record<QflowWorkflowKind, string>;

const DISPATCH_CONCURRENCY = 8;
const MAX_PLATFORM_RESTART_ATTEMPTS = 3;

/** Signals that a required Cloudflare Workflow binding is missing or malformed. */
export class WorkflowBindingConfigError extends Error {
  readonly _tag = 'WorkflowBindingMissing' as const;

  constructor(readonly bindingName: string) {
    super(`Missing required Workflow binding ${bindingName}`);
    this.name = 'WorkflowBindingConfigError';
  }
}

/** Fails before a mutating request when either required Workflow binding is absent. */
export function requireWorkflowBindings(runtime: RuntimeSource): void {
  for (const kind of workflowKinds()) resolveBinding(runtime, kind);
}

/**
 * Idempotently creates stable Workflow instances and reconciles their platform state.
 *
 * An explicit user retry creates a new dispatch ID. Platform recovery always restarts the same ID.
 */
export async function dispatchPendingWorkflowJobs(
  runtime: RuntimeSource,
  options: {
    readonly jobIds?: readonly string[];
    readonly tenantId?: string;
    readonly limit?: number;
  } = {},
): Promise<WorkflowDispatchResult> {
  let bindings: Readonly<Record<QflowWorkflowKind, WorkflowBindingLike>>;
  try {
    bindings = {
      source_migration: resolveBinding(runtime, 'source_migration'),
      ai_generation: resolveBinding(runtime, 'ai_generation'),
      release_build: resolveBinding(runtime, 'release_build'),
      migration_commit: resolveBinding(runtime, 'migration_commit'),
      bank_enrichment: resolveBinding(runtime, 'bank_enrichment'),
      question_organization: resolveBinding(runtime, 'question_organization'),
      assessment_print: resolveBinding(runtime, 'assessment_print'),
    };
  } catch (cause: unknown) {
    return bindingMissing(cause);
  }

  let database: QflowDatabase;
  let rows: readonly DispatchRow[];
  try {
    database = getDb(runtime);
    rows = await loadDispatchRows(database, options);
  } catch (cause: unknown) {
    return dispatchFailed('load_dispatch_rows', cause);
  }
  if (!rows.length) return { ok: true, dispatched: 0, reconciled: 0, completed: 0 };

  const ensured = await ensureWorkflowInstances(database, bindings, rows);
  if (!ensured.ok) return dispatchFailed('ensure_workflow_instances', ensured.cause);

  const outcomes = await mapConcurrentBounded(
    rows,
    { concurrency: DISPATCH_CONCURRENCY },
    async (row) => {
      try {
        return await reconcileDispatchRow(database, bindings[row.kind], row);
      } catch (cause: unknown) {
        await recordDispatchFailure(database, row.id).catch(() => undefined);
        return { _tag: 'DispatchFailure', cause } as const;
      }
    },
  );
  const dispatchFailure = outcomes.find((outcome) => outcome._tag === 'DispatchFailure');
  if (dispatchFailure?._tag === 'DispatchFailure') {
    return dispatchFailed('reconcile_workflow_instances', dispatchFailure.cause);
  }
  return {
    ok: true,
    dispatched: ensured.dispatched,
    reconciled: countOutcomes(outcomes, 'Reconciled'),
    completed: countOutcomes(outcomes, 'Completed'),
  };
}

async function loadDispatchRows(
  database: QflowDatabase,
  options: {
    readonly jobIds?: readonly string[];
    readonly tenantId?: string;
    readonly limit?: number;
  },
): Promise<readonly DispatchRow[]> {
  const jobFilter = options.jobIds?.length
    ? inArray(workflowDispatches.jobId, [...new Set(options.jobIds)])
    : undefined;
  const rows = await database.select({
    id: workflowDispatches.id,
    kind: workflowDispatches.kind,
    jobId: workflowDispatches.jobId,
    tenantId: workflowDispatches.tenantId,
    state: workflowDispatches.state,
    attempts: workflowDispatches.attempts,
  }).from(workflowDispatches).where(and(
    inArray(workflowDispatches.state, ['pending', 'active']),
    jobFilter,
    options.tenantId ? eq(workflowDispatches.tenantId, options.tenantId) : undefined,
  )).orderBy(workflowDispatches.updatedAt).limit(normalizeLimit(options.limit));

  const parsed: DispatchRow[] = [];
  for (const row of rows) {
    const kind = parseWorkflowKind(row.kind);
    const state = parseActiveDispatchState(row.state);
    if (!kind || !state || !Number.isSafeInteger(row.attempts) || row.attempts < 0) {
      throw new Error('Persisted Workflow dispatch is invalid.');
    }
    parsed.push({ ...row, kind, state });
  }
  return parsed;
}

async function ensureWorkflowInstances(
  database: QflowDatabase,
  bindings: Readonly<Record<QflowWorkflowKind, WorkflowBindingLike>>,
  rows: readonly DispatchRow[],
): Promise<
  | { readonly ok: true; readonly dispatched: number }
  | { readonly ok: false; readonly cause: unknown }
> {
  let dispatched = 0;
  for (const kind of workflowKinds()) {
    const matching = rows.filter((row) => row.kind === kind);
    if (!matching.length) continue;
    try {
      await bindings[kind].createBatch(matching.map((row) => ({
        id: row.id,
        params: { jobId: row.jobId },
      })));
      const pendingIds = matching.filter((row) => row.state === 'pending').map((row) => row.id);
      if (!pendingIds.length) continue;
      const activated = await database.update(workflowDispatches).set({
        state: 'active',
        workflowStatus: 'queued',
        startedAt: sql`now()`,
        lastCheckedAt: sql`now()`,
        lastErrorCode: null,
        updatedAt: sql`now()`,
      }).where(and(
        inArray(workflowDispatches.id, pendingIds),
        eq(workflowDispatches.state, 'pending'),
      )).returning({ id: workflowDispatches.id });
      dispatched += activated.length;
    } catch (cause: unknown) {
      await Promise.allSettled(matching.map((row) => recordDispatchFailure(database, row.id)));
      return { ok: false, cause };
    }
  }
  return { ok: true, dispatched };
}

async function reconcileDispatchRow(
  database: QflowDatabase,
  binding: WorkflowBindingLike,
  row: DispatchRow,
): Promise<ReconciliationOutcome> {
  let instance: WorkflowInstanceLike;
  let status: QflowWorkflowStatus;
  try {
    instance = await binding.get(row.id);
    status = await readWorkflowStatus(instance);
  } catch (cause: unknown) {
    await recordDispatchFailure(database, row.id).catch(() => undefined);
    return { _tag: 'DispatchFailure', cause };
  }

  if (status === 'complete') {
    return await reconcileTerminalDispatch(database, row, {
      _tag: 'PlatformCompleted',
      status,
    });
  }
  if (status === 'errored' || status === 'terminated') {
    return await recoverTerminalDispatch(database, instance, row, status);
  }

  await database.update(workflowDispatches).set({
    state: 'active',
    workflowStatus: status,
    startedAt: sql`coalesce(${workflowDispatches.startedAt}, now())`,
    lastCheckedAt: sql`now()`,
    lastErrorCode: null,
    updatedAt: sql`now()`,
  }).where(and(
    eq(workflowDispatches.id, row.id),
    inArray(workflowDispatches.state, ['pending', 'active']),
  ));
  return { _tag: 'Observed' };
}

async function recoverTerminalDispatch(
  database: QflowDatabase,
  instance: WorkflowInstanceLike,
  row: DispatchRow,
  status: 'errored' | 'terminated',
): Promise<ReconciliationOutcome> {
  const reserved = await database.update(workflowDispatches).set({
    workflowStatus: status,
    attempts: sql`${workflowDispatches.attempts} + 1`,
    lastCheckedAt: sql`now()`,
    lastErrorCode: status === 'errored' ? 'workflow_errored' : 'workflow_terminated',
    updatedAt: sql`now()`,
  }).where(and(
    eq(workflowDispatches.id, row.id),
    eq(workflowDispatches.state, 'active'),
    eq(workflowDispatches.attempts, row.attempts),
    sql`${workflowDispatches.attempts} < ${MAX_PLATFORM_RESTART_ATTEMPTS}`,
  )).returning({ attempts: workflowDispatches.attempts });

  if (!reserved.length) {
    if (row.attempts < MAX_PLATFORM_RESTART_ATTEMPTS) return { _tag: 'Observed' };
    return await reconcileTerminalDispatch(database, row, {
      _tag: 'RestartExhausted',
      status,
    });
  }

  try {
    await instance.restart();
  } catch (cause: unknown) {
    await recordDispatchFailure(database, row.id).catch(() => undefined);
    return { _tag: 'DispatchFailure', cause };
  }

  await database.transaction(async (tx) => {
    await tx.update(workflowDispatches).set({
      workflowStatus: 'queued',
      lastCheckedAt: sql`now()`,
      lastErrorCode: null,
      updatedAt: sql`now()`,
    }).where(and(
      eq(workflowDispatches.id, row.id),
      eq(workflowDispatches.state, 'active'),
    ));
    await recordAuditEventInTransaction(tx, {
      tenantId: row.tenantId,
      action: 'workflow_execution_restarted',
      metadata: {
        jobId: row.jobId,
        kind: row.kind,
        workflowExecutionId: row.id,
        previousWorkflowStatus: status,
        restartAttempt: reserved[0].attempts,
      },
    });
  });
  return { _tag: 'Reconciled' };
}

async function reconcileTerminalDispatch(
  database: QflowDatabase,
  row: DispatchRow,
  observation: TerminalWorkflowObservation,
): Promise<ReconciliationOutcome> {
  return await database.transaction(async (tx) => {
    const eligibility = observation._tag === 'RestartExhausted'
      ? and(
        eq(workflowDispatches.state, 'active'),
        sql`${workflowDispatches.attempts} >= ${MAX_PLATFORM_RESTART_ATTEMPTS}`,
      )
      : inArray(workflowDispatches.state, ['pending', 'active']);
    const owned = await tx.select({ attempts: workflowDispatches.attempts })
      .from(workflowDispatches).where(and(
        eq(workflowDispatches.id, row.id),
        eligibility,
      )).for('update').limit(1);
    const dispatch = owned[0];
    if (!dispatch) return { _tag: 'Observed' } as const;

    const domainOutcome = row.kind === 'assessment_print'
      ? await settlePrintAfterWorkflowTerminal(tx, {
        jobId: row.jobId,
        tenantId: row.tenantId,
        executionId: row.id,
      })
      : row.kind === 'source_migration'
      ? await settleMigrationRunAfterWorkflowTerminal(tx, {
        runId: row.jobId,
        tenantId: row.tenantId,
      })
      : row.kind === 'question_organization'
      ? await settleOrganizationAfterWorkflowTerminal(tx, {
        jobId: row.jobId,
        tenantId: row.tenantId,
        executionId: row.id,
      })
      : row.kind === 'bank_enrichment'
      ? await settleEnrichmentAfterWorkflowTerminal(tx, {
        jobId: row.jobId,
        tenantId: row.tenantId,
        executionId: row.id,
        now: new Date(),
      })
      : row.kind === 'migration_commit'
      ? await settleMigrationCommitAfterWorkflowTerminal(tx, {
        jobId: row.jobId,
        tenantId: row.tenantId,
      })
      : row.kind === 'release_build'
      ? await settleReleaseBuildAfterWorkflowTerminal(tx, {
        jobId: row.jobId,
        tenantId: row.tenantId,
      })
      : await settleAIGenerationJobAfterWorkflowTerminal(tx, {
        jobId: row.jobId,
        tenantId: row.tenantId,
      });
    const decision = decideTerminalDispatch(observation, domainOutcome);
    await tx.update(workflowDispatches).set({
      state: decision.state,
      workflowStatus: observation.status,
      startedAt: sql`coalesce(${workflowDispatches.startedAt}, now())`,
      completedAt: sql`now()`,
      lastCheckedAt: sql`now()`,
      lastErrorCode: decision.lastErrorCode,
      updatedAt: sql`now()`,
    }).where(and(
      eq(workflowDispatches.id, row.id),
      inArray(workflowDispatches.state, ['pending', 'active']),
    ));
    if (decision.lastErrorCode) {
      await recordAuditEventInTransaction(tx, {
        tenantId: row.tenantId,
        action: decision.state === 'failed'
          ? 'workflow_execution_failed'
          : 'workflow_execution_reconciled',
        metadata: {
          jobId: row.jobId,
          kind: row.kind,
          workflowExecutionId: row.id,
          workflowStatus: observation.status,
          restartAttempts: dispatch.attempts,
          failureCode: decision.lastErrorCode,
        },
      });
    }
    return decision.state === 'complete'
      ? { _tag: 'Completed' } as const
      : { _tag: 'Reconciled' } as const;
  });
}

function decideTerminalDispatch(
  observation: TerminalWorkflowObservation,
  domain: WorkflowTerminalDomainOutcome,
): TerminalDispatchDecision {
  if (observation._tag === 'PlatformCompleted') {
    switch (domain._tag) {
      case 'AlreadyCompleted':
      case 'AlreadyFailed':
        return { state: 'complete', lastErrorCode: null };
      case 'Failed':
        return { state: 'failed', lastErrorCode: 'workflow_completed_before_domain_terminal' };
      case 'JobMissing':
        return { state: 'failed', lastErrorCode: 'workflow_domain_job_missing' };
      default:
        return unexpectedWorkflowTerminalDomainOutcome(domain);
    }
  }

  switch (domain._tag) {
    case 'AlreadyCompleted':
      return {
        state: 'complete',
        lastErrorCode: 'workflow_terminal_after_domain_completion',
      };
    case 'Failed':
    case 'AlreadyFailed':
      return { state: 'failed', lastErrorCode: 'workflow_restart_exhausted' };
    case 'JobMissing':
      return { state: 'failed', lastErrorCode: 'workflow_domain_job_missing' };
    default:
      return unexpectedWorkflowTerminalDomainOutcome(domain);
  }
}

function unexpectedWorkflowTerminalDomainOutcome(_outcome: never): never {
  throw new Error('Unhandled Workflow terminal domain outcome.');
}

async function recordDispatchFailure(
  database: QflowDatabase,
  dispatchId: string,
): Promise<void> {
  await database.update(workflowDispatches).set({
    lastErrorCode: 'workflow_dispatch_failed',
    lastCheckedAt: sql`now()`,
    updatedAt: sql`now()`,
  }).where(and(
    eq(workflowDispatches.id, dispatchId),
    inArray(workflowDispatches.state, ['pending', 'active']),
  ));
}

async function readWorkflowStatus(instance: WorkflowInstanceLike): Promise<QflowWorkflowStatus> {
  const value = await instance.status();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Cloudflare Workflow returned an invalid status response.');
  }
  const status = parseWorkflowStatus((value as { readonly status?: unknown }).status);
  if (!status) throw new Error('Cloudflare Workflow returned an unrecognized status.');
  return status;
}

function resolveBinding(runtime: RuntimeSource, kind: QflowWorkflowKind): WorkflowBindingLike {
  const binding = getRuntimeBinding(runtime, BINDING_NAMES[kind]);
  if (
    !binding || typeof binding !== 'object' ||
    typeof (binding as { createBatch?: unknown }).createBatch !== 'function' ||
    typeof (binding as { get?: unknown }).get !== 'function'
  ) throw new WorkflowBindingConfigError(BINDING_NAMES[kind]);
  // SAFETY: The composition seam established the exact createBatch/get capability used here.
  return binding as WorkflowBindingLike;
}

function parseWorkflowKind(input: unknown): QflowWorkflowKind | null {
  return input === 'source_migration' || input === 'ai_generation' || input === 'release_build' ||
      input === 'migration_commit' || input === 'bank_enrichment' ||
      input === 'question_organization' || input === 'assessment_print'
    ? input
    : null;
}

function parseActiveDispatchState(input: unknown): 'pending' | 'active' | null {
  return input === 'pending' || input === 'active' ? input : null;
}

function parseWorkflowStatus(input: unknown): QflowWorkflowStatus | null {
  switch (input) {
    case 'queued':
    case 'running':
    case 'paused':
    case 'errored':
    case 'terminated':
    case 'complete':
    case 'waiting':
    case 'waitingForPause':
    case 'unknown':
      return input;
    default:
      return null;
  }
}

function workflowKinds(): readonly QflowWorkflowKind[] {
  return [
    'source_migration',
    'ai_generation',
    'release_build',
    'migration_commit',
    'bank_enrichment',
    'question_organization',
    'assessment_print',
  ];
}

function countOutcomes(
  outcomes: readonly ReconciliationOutcome[],
  tag: ReconciliationOutcome['_tag'],
): number {
  return outcomes.filter((outcome) => outcome._tag === tag).length;
}

function normalizeLimit(input: number | undefined): number {
  if (input === undefined) return 100;
  if (!Number.isSafeInteger(input) || input < 1 || input > 100) {
    throw new Error('Workflow dispatch limit must be an integer from 1 to 100.');
  }
  return input;
}

function bindingMissing(cause: unknown): WorkflowDispatchResult {
  return {
    ok: false,
    error: {
      _tag: 'WorkflowBindingMissing',
      message: 'Cloudflare Workflow bindings are required for queued work.',
      phase: 'resolve_bindings',
      cause: safeWorkflowDispatchCause(cause),
    },
  };
}

function dispatchFailed(
  phase:
    | 'load_dispatch_rows'
    | 'ensure_workflow_instances'
    | 'reconcile_workflow_instances',
  cause: unknown,
): WorkflowDispatchResult {
  return {
    ok: false,
    error: {
      _tag: 'WorkflowDispatchFailed',
      message: 'Cloudflare could not reconcile every queued workflow.',
      phase,
      cause: safeWorkflowDispatchCause(cause),
    },
  };
}

function safeWorkflowDispatchCause(
  cause: unknown,
): { readonly name: string; readonly code: string | null } {
  let code: string | null = null;
  if (cause && typeof cause === 'object') {
    try {
      const candidate = Reflect.get(cause, 'code');
      if (typeof candidate === 'string' && /^[0-9A-Z]{5}$/u.test(candidate)) code = candidate;
    } catch (_cause: unknown) {
      // A thrown value may be an exotic object. Its stable type summary is still safe to report.
    }
  }
  return { name: safeErrorSummary(cause), code };
}

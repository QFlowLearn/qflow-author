import {
  claimMigrationRun,
  markMigrationRunFailed,
  markMigrationRunRetry,
} from '../import/migration_jobs.ts';
import { processClaimedMigrationRun } from '../import/migration_processor.ts';
import {
  type AIGenerationJobFailure,
  aiGenerationRetryDelay,
  classifyAIGenerationJobFailure,
  type RetryableAIGenerationJobErrorCode,
  type TerminalAIGenerationJobErrorCode,
} from '../ai_generation_job.ts';
import { processAIGenerationJob } from '../services/ai_generation_job_processor.ts';
import {
  claimAIGenerationJob,
  getAIGenerationJob,
  markAIGenerationJobFailed,
  markAIGenerationJobRetry,
} from '../services/ai_generation_job_store.ts';
import type {
  MigrationProcessingFailure,
  PermanentMigrationFailureCode,
  RetryableMigrationFailureCode,
} from '../import/migration_failures.ts';
import { migrationRetryDelay } from '../import/migration_failures.ts';
import type { QflowDatabase } from '../db.ts';
import { and, eq } from 'drizzle-orm';
import { migrationRuns } from '../db/schema.ts';
import type { ObjectReader, ObjectReadWriter } from '../storage_contract.ts';
import { workerContext } from '../tenants.ts';
import type { AssessmentGenerationProvider } from '../ai/assessment_generation_provider.ts';
import { isCanonicalUuid } from '../uuid.ts';

/** Serializable parameter contract accepted by every QFlow Workflow instance. */
export type QflowWorkflowParams = { readonly jobId: string };

/** Parsed Cloudflare invocation context supplied to one Workflow runner. */
export type QflowWorkflowInvocation = QflowWorkflowParams & {
  readonly workflowExecutionId: string;
};

/** Unit-bearing duration accepted by the durable orchestration boundary. */
export type DurableDuration = `${number} ${
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year'
}${'' | 's'}`;

/** Explicit retry and timeout policy applied to one Cloudflare Workflow step. */
export type DurableWorkflowStepConfig = {
  readonly retries: {
    readonly limit: number;
    readonly delay: DurableDuration;
    readonly backoff: 'constant';
  };
  readonly timeout: DurableDuration;
};

/** Small capability supplied by Cloudflare WorkflowStep at the platform seam. */
export type DurableWorkflowStep = {
  do<T>(name: string, config: DurableWorkflowStepConfig, operation: () => Promise<T>): Promise<T>;
  sleep(name: string, duration: DurableDuration): Promise<void>;
};

/** Invocation-owned capabilities used by source-migration orchestration. */
export type SourceMigrationWorkflowServices = {
  readonly database: QflowDatabase;
  readonly storage: ObjectReadWriter;
};

/** Invocation-owned capabilities used by AI-generation orchestration. */
export type AiGenerationWorkflowServices = {
  readonly database: QflowDatabase;
  readonly storage: ObjectReader;
  readonly provider: AssessmentGenerationProvider;
};

/** Persisted terminal summary returned by a QFlow Workflow instance. */
export type QflowWorkflowOutcome =
  | { readonly _tag: 'Completed'; readonly jobId: string; readonly attempts: number }
  | { readonly _tag: 'Failed'; readonly jobId: string; readonly attempts: number }
  | { readonly _tag: 'NoWork'; readonly jobId: string };

type SerializableJobFailure<RetryCode extends string, PermanentCode extends string> =
  | {
    readonly _tag: 'Retryable';
    readonly code: RetryCode;
    readonly message: string;
  }
  | {
    readonly _tag: 'Permanent';
    readonly code: PermanentCode;
    readonly message: string;
  }
  | { readonly _tag: 'LeaseLost'; readonly code: 'lease_lost'; readonly message: string };

type DurableAttemptProcessingOutcome<RetryCode extends string, PermanentCode extends string> =
  | { readonly _tag: 'Succeeded' }
  | {
    readonly _tag: 'Failed';
    readonly failure: SerializableJobFailure<RetryCode, PermanentCode>;
  };

type SerializableMigrationFailure = SerializableJobFailure<
  RetryableMigrationFailureCode,
  PermanentMigrationFailureCode
>;

type SerializableAIGenerationFailure = SerializableJobFailure<
  RetryableAIGenerationJobErrorCode,
  Exclude<TerminalAIGenerationJobErrorCode, RetryableAIGenerationJobErrorCode>
>;

type DurableAttemptJob = {
  readonly attempts: number;
  readonly maxAttempts: number;
};

type DurableAttemptLabels = {
  readonly subject: string;
  readonly processingAction: string;
};

type DurableAttemptOperations<
  Job extends DurableAttemptJob,
  RetryCode extends string,
  PermanentCode extends string,
> = {
  claim(): Promise<Job | null>;
  process(job: Job): Promise<DurableAttemptProcessingOutcome<RetryCode, PermanentCode>>;
  requeue(
    job: Job,
    failure: Extract<
      SerializableJobFailure<RetryCode, PermanentCode>,
      { readonly _tag: 'Retryable' }
    >,
  ): Promise<void>;
  fail(
    job: Job,
    failure: Exclude<
      SerializableJobFailure<RetryCode, PermanentCode>,
      { readonly _tag: 'LeaseLost' }
    >,
  ): Promise<void>;
  retryDelay(code: RetryCode): DurableDuration;
};

/** Parses the runtime-hop payload before service orchestration receives it. */
export function parseQflowWorkflowParams(input: unknown): QflowWorkflowParams | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const keys = Object.keys(input);
  const jobId = (input as { readonly jobId?: unknown }).jobId;
  if (keys.length !== 1 || keys[0] !== 'jobId' || !isLowercaseCanonicalUuid(jobId)) return null;
  return { jobId };
}

/** Reads the payload shape Cloudflare supplies to WorkflowEntrypoint.run(). */
export function parseQflowWorkflowEvent(input: unknown): QflowWorkflowInvocation | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const event = input as { readonly instanceId?: unknown; readonly payload?: unknown };
  const params = parseQflowWorkflowParams(event.payload);
  if (!params || !isLowercaseCanonicalUuid(event.instanceId)) return null;
  return { ...params, workflowExecutionId: event.instanceId };
}

/** Runs one source migration through bounded durable attempts without queue polling. */
export async function runSourceMigrationWorkflow(
  params: QflowWorkflowInvocation,
  step: DurableWorkflowStep,
  services: SourceMigrationWorkflowServices,
): Promise<QflowWorkflowOutcome> {
  return await runDurableAttempts(
    params,
    step,
    { subject: 'source', processingAction: 'process source' },
    {
      claim: () =>
        claimMigrationRun(
          params.jobId,
          params.workflowExecutionId,
          services.database,
        ),
      process: async (job) => {
        const database = services.database;
        const [persisted] = await database.select({ status: migrationRuns.status })
          .from(migrationRuns).where(
            and(eq(migrationRuns.id, job.id), eq(migrationRuns.tenantId, job.tenantId)),
          ).limit(1);
        if (persisted?.status === 'analyzed' || persisted?.status === 'committed') {
          return { _tag: 'Succeeded' } as const;
        }
        const result = await processClaimedMigrationRun(job, {
          storage: services.storage,
          database,
        });
        if (result._tag === 'Success') return { _tag: 'Succeeded' } as const;
        return {
          _tag: 'Failed' as const,
          failure: serializableJobFailure(result.failure),
        };
      },
      requeue: (job, failure) =>
        markMigrationRunRetry(job, {
          ...failure,
          cause: null,
        }, services.database),
      fail: (job, failure) =>
        markMigrationRunFailed(
          job,
          { ...failure, cause: null },
          services.database,
        ),
      retryDelay: migrationRetryDelay,
    },
  );
}

/** Runs one AI generation job through bounded durable attempts without queue polling. */
export async function runAiGenerationWorkflow(
  params: QflowWorkflowInvocation,
  step: DurableWorkflowStep,
  services: AiGenerationWorkflowServices,
): Promise<QflowWorkflowOutcome> {
  return await runDurableAttempts(
    params,
    step,
    { subject: 'generation', processingAction: 'generate questions' },
    {
      claim: async () => {
        const job = await claimAIGenerationJob(
          params.jobId,
          params.workflowExecutionId,
          services.database,
        );
        return job?.leaseToken ? { ...job, leaseToken: job.leaseToken } : null;
      },
      process: async (job) => {
        const database = services.database;
        try {
          const persisted = await getAIGenerationJob(
            workerContext(job.tenantId, job.userId),
            job.conversionRunId,
            job.id,
            database,
          );
          if (persisted?.status === 'completed') return { _tag: 'Succeeded' } as const;
          await processAIGenerationJob(job, {
            database,
            storage: services.storage,
            provider: services.provider,
          });
          return { _tag: 'Succeeded' } as const;
        } catch (cause: unknown) {
          return {
            _tag: 'Failed' as const,
            failure: serializableJobFailure(classifyAIGenerationJobFailure(cause)),
          };
        }
      },
      requeue: (job, failure) =>
        markAIGenerationJobRetry(
          job.id,
          job.leaseToken,
          job.workflowExecutionId,
          failure.code,
          services.database,
        ),
      fail: (job, failure) =>
        markAIGenerationJobFailed(
          job.id,
          job.leaseToken,
          job.workflowExecutionId,
          failure.code,
          services.database,
        ),
      retryDelay: aiGenerationRetryDelay,
    },
  );
}

async function runDurableAttempts<
  Job extends DurableAttemptJob,
  RetryCode extends string,
  PermanentCode extends string,
>(
  params: QflowWorkflowParams,
  step: DurableWorkflowStep,
  labels: DurableAttemptLabels,
  operations: DurableAttemptOperations<Job, RetryCode, PermanentCode>,
): Promise<QflowWorkflowOutcome> {
  let slot = 1;
  while (true) {
    const job = await step.do(
      `claim ${labels.subject} attempt ${slot}`,
      databaseStepConfig(),
      operations.claim,
    );
    if (!job) return { _tag: 'NoWork', jobId: params.jobId };
    const processed = await step.do<DurableAttemptProcessingOutcome<RetryCode, PermanentCode>>(
      `${labels.processingAction} attempt ${slot}`,
      processingStepConfig(),
      () => operations.process(job),
    );
    if (processed._tag === 'Succeeded') {
      return { _tag: 'Completed', jobId: params.jobId, attempts: job.attempts };
    }
    const failure = processed.failure;
    if (failure._tag === 'LeaseLost') return { _tag: 'NoWork', jobId: params.jobId };
    if (failure._tag === 'Retryable' && job.attempts < job.maxAttempts) {
      await step.do(
        `requeue ${labels.subject} attempt ${slot}`,
        databaseStepConfig(),
        () => operations.requeue(job, failure),
      );
      await step.sleep(
        `wait before ${labels.subject} attempt ${slot + 1}`,
        operations.retryDelay(failure.code),
      );
      slot += 1;
      continue;
    }
    await step.do(
      `fail ${labels.subject} attempt ${slot}`,
      databaseStepConfig(),
      () => operations.fail(job, failure),
    );
    return { _tag: 'Failed', jobId: params.jobId, attempts: job.attempts };
  }
}

function serializableJobFailure(
  failure: MigrationProcessingFailure,
): SerializableMigrationFailure;
function serializableJobFailure(
  failure: AIGenerationJobFailure,
): SerializableAIGenerationFailure;
function serializableJobFailure(
  failure: MigrationProcessingFailure | AIGenerationJobFailure,
) {
  const { cause: _cause, ...serializable } = failure;
  return serializable;
}

function isLowercaseCanonicalUuid(input: unknown): input is string {
  return isCanonicalUuid(input) && input === input.toLowerCase();
}

function databaseStepConfig(): DurableWorkflowStepConfig {
  return {
    retries: { limit: 0, delay: '1 second', backoff: 'constant' },
    timeout: '2 minutes',
  };
}

function processingStepConfig(): DurableWorkflowStepConfig {
  return {
    retries: { limit: 0, delay: '1 second', backoff: 'constant' },
    timeout: '30 minutes',
  };
}

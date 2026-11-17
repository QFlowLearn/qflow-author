import { resolvePrintRenderer } from './print_renderer_binding.ts';
import { runAssessmentPrintWorkflow } from '../../lib/workflows/assessment_print_workflow.ts';
import {
  type ClefBinding,
  createClefOrganizationProvider,
} from '../../lib/ai/clef_organization_provider.ts';
import { processOrganizationStep } from '../../lib/services/question_organization_processor.ts';
import { runMigrationCommitWorkflow } from '../../lib/workflows/migration_commit_workflow.ts';
import { runBankEnrichmentWorkflow } from '../../lib/workflows/bank_enrichment_workflow.ts';
import { processEnrichmentStep } from '../../lib/services/bank_enrichment_processor.ts';
import { createRuntimeEnrichmentAIProvider } from '../../lib/ai/bank_enrichment_provider.ts';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

import {
  parseQflowWorkflowEvent,
  type QflowWorkflowParams,
  runAiGenerationWorkflow,
  runSourceMigrationWorkflow,
} from '../../lib/workflows/job_workflows.ts';
import {
  dispatchPendingWorkflowJobs,
  type WorkflowDispatchResult,
} from '../../lib/workflows/workflow_dispatch.ts';
import { getDb, withHyperdriveDatabase } from '../../lib/db.ts';
import { processMigrationCommitBatch } from '../../lib/import/migration_commit_job.ts';
import { resolveStorage } from '../../lib/storage.ts';
import { createAssessmentGenerationProvider } from '../../lib/ai/assessment_generation_provider.ts';
import { runReleaseBuildWorkflow } from '../../lib/workflows/release_build_workflow.ts';

type WorkflowEnv = Record<string, unknown>;

/** Durable generation of separately retained student and marking PDF candidates. */
export class AssessmentPrintWorkflow extends WorkflowEntrypoint<WorkflowEnv, QflowWorkflowParams> {
  declare readonly env: WorkflowEnv;
  async run(event: WorkflowEvent<QflowWorkflowParams>, step: WorkflowStep) {
    const params = parseQflowWorkflowEvent(event);
    if (!params) throw new NonRetryableError('Print Workflow parameters are invalid.');
    const runtime = cloudflareRuntime(this.env);
    return await runAssessmentPrintWorkflow(
      params,
      step,
      (operation) =>
        withHyperdriveDatabase(
          runtime,
          (database) =>
            operation({
              database,
              storage: resolveStorage(runtime),
              renderer: resolvePrintRenderer(this.env),
            }),
        ),
    );
  }
}

/** Durable preview and question classification with step-owned Hyperdrive and provider capabilities. */
export class BankEnrichmentWorkflow extends WorkflowEntrypoint<WorkflowEnv, QflowWorkflowParams> {
  declare readonly env: WorkflowEnv;
  async run(event: WorkflowEvent<QflowWorkflowParams>, step: WorkflowStep) {
    const params = parseQflowWorkflowEvent(event);
    if (!params) throw new NonRetryableError('Bank enrichment Workflow parameters are invalid.');
    return await runBankEnrichmentWorkflow(params, step, () => {
      const runtime = cloudflareRuntime(this.env);
      return withHyperdriveDatabase(runtime, (database) =>
        processEnrichmentStep(params, {
          database,
          now: () => new Date(),
          newId: () => crypto.randomUUID(),
          provider: (config) => createRuntimeEnrichmentAIProvider(runtime, config),
        }));
    });
  }
}

/** Durable compilation of an exact frozen edition into its retained destination package. */
export class ReleaseBuildWorkflow extends WorkflowEntrypoint<WorkflowEnv, QflowWorkflowParams> {
  declare readonly env: WorkflowEnv;
  async run(event: WorkflowEvent<QflowWorkflowParams>, step: WorkflowStep) {
    const params = parseQflowWorkflowEvent(event);
    if (!params) throw new NonRetryableError('Release build Workflow parameters are invalid.');
    return await runReleaseBuildWorkflow(params, step, sourceWorkflowServices(this.env));
  }
}

/** Durable source parsing and migration analysis for one persisted migration run. */
export class SourceMigrationWorkflow extends WorkflowEntrypoint<WorkflowEnv, QflowWorkflowParams> {
  /** Runs one parsed source-migration invocation through durable job orchestration. */
  async run(event: WorkflowEvent<QflowWorkflowParams>, step: WorkflowStep) {
    const params = parseQflowWorkflowEvent(event);
    if (!params) throw new NonRetryableError('Source migration Workflow parameters are invalid.');
    return await runSourceMigrationWorkflow(params, step, sourceWorkflowServices(this.env));
  }
}

/** Durable AI generation for one persisted generation job. */
export class AiGenerationWorkflow extends WorkflowEntrypoint<WorkflowEnv, QflowWorkflowParams> {
  /** Runs one parsed AI-generation invocation through durable job orchestration. */
  async run(event: WorkflowEvent<QflowWorkflowParams>, step: WorkflowStep) {
    const params = parseQflowWorkflowEvent(event);
    if (!params) throw new NonRetryableError('AI generation Workflow parameters are invalid.');
    return await runAiGenerationWorkflow(params, step, aiWorkflowServices(this.env));
  }
}

/** Reconciles committed outbox rows from the Worker's scheduled handler. */
export async function dispatchWorkflowOutbox(env: WorkflowEnv): Promise<WorkflowDispatchResult> {
  return await dispatchPendingWorkflowJobs(cloudflareRuntime(env));
}

function sourceWorkflowServices(env: WorkflowEnv) {
  const runtime = cloudflareRuntime(env);
  return {
    database: getDb(runtime),
    storage: resolveStorage(runtime),
  };
}

function aiWorkflowServices(env: WorkflowEnv) {
  const runtime = cloudflareRuntime(env);
  return {
    database: getDb(runtime),
    storage: resolveStorage(runtime),
    provider: createAssessmentGenerationProvider(runtime),
  };
}

function cloudflareRuntime(env: WorkflowEnv) {
  return { bindings: env };
}

/** Durable publication of a frozen, approved bank selection. */
export class MigrationCommitWorkflow extends WorkflowEntrypoint<WorkflowEnv, QflowWorkflowParams> {
  declare readonly env: WorkflowEnv;
  async run(event: WorkflowEvent<QflowWorkflowParams>, step: WorkflowStep) {
    const params = parseQflowWorkflowEvent(event);
    if (!params) throw new NonRetryableError('Migration commit Workflow parameters are invalid.');
    // Hyperdrive connections belong to a single durable step, including on replay.
    return await runMigrationCommitWorkflow(
      params,
      step,
      (jobId) => {
        const runtime = cloudflareRuntime(this.env);
        return withHyperdriveDatabase(runtime, (database) =>
          processMigrationCommitBatch(jobId, {
            database,
            storage: resolveStorage(runtime),
          }));
      },
    );
  }
}

/** Direct Clef organization runs independently of frozen generative enrichment jobs. */
export class QuestionOrganizationWorkflow
  extends WorkflowEntrypoint<WorkflowEnv, QflowWorkflowParams> {
  declare readonly env: WorkflowEnv;
  async run(event: WorkflowEvent<QflowWorkflowParams>, step: WorkflowStep) {
    const params = parseQflowWorkflowEvent(event);
    if (!params) {
      throw new NonRetryableError('Question organization Workflow parameters are invalid.');
    }
    return await runBankEnrichmentWorkflow(params, step, () => {
      const runtime = cloudflareRuntime(this.env);
      return withHyperdriveDatabase(runtime, (database) =>
        processOrganizationStep(params, {
          database,
          now: () => new Date(),
          newId: () => crypto.randomUUID(),
          provider: (config) => {
            const binding = this.env.AI;
            if (
              !binding || typeof binding !== 'object' || !('run' in binding) ||
              typeof binding.run !== 'function'
            ) {
              throw new Error('Question organization requires the Cloudflare AI binding.');
            }
            // SAFETY: the external adapter checks every unknown response from this run capability.
            return createClefOrganizationProvider(binding as ClefBinding, config);
          },
        }));
    });
  }
}

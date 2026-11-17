import type { QflowDatabase } from '../db.ts';
import type { ObjectStorage } from '../storage_contract.ts';
import type { PrintRenderer } from '../print/print_renderer_contract.ts';
import { buildPrintPack } from '../services/assessment_print_build.ts';
import type {
  DurableWorkflowStep,
  QflowWorkflowInvocation,
  QflowWorkflowOutcome,
} from './job_workflows.ts';

/** One durable build from a retained snapshot; platform replay adopts the same candidate identity. */
export async function runAssessmentPrintWorkflow(
  params: QflowWorkflowInvocation,
  step: DurableWorkflowStep,
  execute: (
    operation: (
      services: {
        readonly database: QflowDatabase;
        readonly storage: ObjectStorage;
        readonly renderer: PrintRenderer;
      },
    ) => Promise<boolean>,
  ) => Promise<boolean>,
): Promise<QflowWorkflowOutcome> {
  const success = await step.do(
    'build paper candidate',
    { retries: { limit: 2, delay: '10 seconds', backoff: 'constant' }, timeout: '10 minutes' },
    () =>
      execute(async (services) =>
        (await buildPrintPack(params.jobId, params.workflowExecutionId, services)).ok
      ),
  );
  return { _tag: success ? 'Completed' : 'Failed', jobId: params.jobId, attempts: 1 };
}

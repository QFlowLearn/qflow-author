import type { QflowDatabase } from '../db.ts';
import type { ObjectStorage } from '../storage_contract.ts';
import { claimReleaseBuild } from '../services/release_artifacts.ts';
import { processReleaseBuild } from '../services/release_build_processor.ts';
import type {
  DurableWorkflowStep,
  QflowWorkflowInvocation,
  QflowWorkflowOutcome,
} from './job_workflows.ts';

/** Concrete durable release build, with retained source and current-attempt adoption. */
export async function runReleaseBuildWorkflow(
  params: QflowWorkflowInvocation,
  step: DurableWorkflowStep,
  services: { readonly database: QflowDatabase; readonly storage: ObjectStorage },
): Promise<QflowWorkflowOutcome> {
  const claim = await step.do('claim release build', {
    retries: { limit: 0, delay: '1 second', backoff: 'constant' },
    timeout: '2 minutes',
  }, () => claimReleaseBuild(params.jobId, params.workflowExecutionId, services.database));
  if (!claim) return { _tag: 'NoWork', jobId: params.jobId };
  for (let slot = 1; slot <= 3; slot++) {
    const result = await step.do(`compile release attempt ${slot}`, {
      retries: { limit: 0, delay: '1 second', backoff: 'constant' },
      timeout: '30 minutes',
    }, () => processReleaseBuild(claim, services));
    if (result.ok) return { _tag: 'Completed', jobId: params.jobId, attempts: slot };
    if (result.code !== 'storage_failed' || slot === 3) {
      return { _tag: 'Failed', jobId: params.jobId, attempts: slot };
    }
    await step.sleep(`retry release storage ${slot}`, '10 seconds');
  }
  throw new Error('Release retry bound was exceeded.');
}

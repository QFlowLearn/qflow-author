import type {
  EnrichmentBatchProgress,
  EnrichmentJobFailure,
} from '../services/bank_enrichment_job_contract.ts';
import type { EnrichmentResult } from '../services/bank_enrichment_contract.ts';
import type {
  DurableWorkflowStep,
  QflowWorkflowInvocation,
  QflowWorkflowOutcome,
} from './job_workflows.ts';

/** The application owns provider retries; Workflows persist only small batch progress receipts. */
export async function runBankEnrichmentWorkflow(
  params: QflowWorkflowInvocation,
  step: DurableWorkflowStep,
  process: () => Promise<EnrichmentResult<EnrichmentBatchProgress, EnrichmentJobFailure>>,
): Promise<QflowWorkflowOutcome> {
  for (let sequence = 0; sequence < 100_000; sequence++) {
    const outcome = await step.do(`enrichment batch ${sequence}`, {
      retries: { limit: 0, delay: '1 second', backoff: 'constant' },
      timeout: '3 minutes',
    }, async () => {
      const result = await process();
      if (result.ok) return result.value;
      if (result.code === 'lease_lost') return { state: 'busy', completed: 0 } as const;
      if (result.code === 'forbidden' || result.code === 'not_found') {
        return { state: 'failed', completed: 0 } as const;
      }
      // Storage failures cross the platform boundary explicitly. Its reconciler can restart the
      // workflow; persisted attempts and receipts still prevent duplicate requests and writes.
      throw new Error(`Enrichment step failed: ${result.code}`);
    });
    if (outcome.state === 'completed') {
      return { _tag: 'Completed', jobId: params.jobId, attempts: 1 };
    }
    if (outcome.state === 'failed' || outcome.state === 'cancelled') {
      return { _tag: 'Failed', jobId: params.jobId, attempts: 1 };
    }
    if (outcome.state === 'retry' || outcome.state === 'busy') {
      await step.sleep(`enrichment retry delay ${sequence}`, '10 seconds');
    }
  }
  throw new Error('Enrichment exceeded its bounded step count.');
}

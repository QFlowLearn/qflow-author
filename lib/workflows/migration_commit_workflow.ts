import type {
  DurableWorkflowStep,
  QflowWorkflowInvocation,
  QflowWorkflowOutcome,
} from './job_workflows.ts';

/** Persist only small progress receipts between durable bank-commit batches. */
export async function runMigrationCommitWorkflow(
  params: QflowWorkflowInvocation,
  step: DurableWorkflowStep,
  processBatch: (jobId: string) => Promise<{ complete: boolean; completed: number }>,
): Promise<QflowWorkflowOutcome> {
  for (let batch = 0; batch < 10_000; batch++) {
    const progress = await step.do(`commit question batch ${batch}`, {
      retries: { limit: 3, delay: '10 seconds', backoff: 'constant' },
      timeout: '5 minutes',
    }, () => processBatch(params.jobId));
    if (progress.complete) return { _tag: 'Completed', jobId: params.jobId, attempts: 1 };
  }
  throw new Error('Commit exceeded its explicit batch budget.');
}

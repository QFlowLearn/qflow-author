import { db } from '../../lib/db.ts';
import { processEnrichmentStep } from '../../lib/services/bank_enrichment_processor.ts';
import { runBankEnrichmentWorkflow } from '../../lib/workflows/bank_enrichment_workflow.ts';
import { enrichmentProviderFixture } from './enrichment_provider_fixture.ts';

/** Real workflow/application processing with an explicitly owned deterministic external provider. */
export function finishTestEnrichment(jobId: string, workflowExecutionId: string) {
  const params = { jobId, workflowExecutionId };
  return runBankEnrichmentWorkflow(params, {
    do: (_name, _config, action) => action(),
    sleep: () => Promise.reject(new Error('Unexpected retry in the successful fixture workflow.')),
  }, () =>
    processEnrichmentStep(params, {
      database: db,
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
      provider: () => enrichmentProviderFixture,
    }));
}

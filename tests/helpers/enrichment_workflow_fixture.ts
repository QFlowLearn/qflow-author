import { expect } from 'vitest';

import { db } from '../../lib/db.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { BankEnrichmentScopes } from '../../lib/services/bank_enrichment_scope.ts';
import { BankEnrichmentStore } from '../../lib/services/bank_enrichment_store.ts';
import { BankEnrichmentRunStore } from '../../lib/services/bank_enrichment_run_store.ts';
import { BankEnrichmentJobs } from '../../lib/services/bank_enrichment_jobs.ts';
import {
  type EnrichmentWorkerServices,
  processEnrichmentStep,
} from '../../lib/services/bank_enrichment_processor.ts';
import { enrichmentDefinitionFixture } from '../bank_enrichment_fixture.ts';
import {
  enrichmentConfigFixture,
  enrichmentProviderFixture,
} from './enrichment_provider_fixture.ts';
import { addEnrichmentQuestions } from './enrichment_workspace.ts';

/** Wall clock used by the integration fixture. */
export const enrichmentTestNow = () => new Date();
/** Real persistence with an explicitly deterministic provider. */
export const enrichmentWorkerFixture: EnrichmentWorkerServices = {
  database: db,
  now: enrichmentTestNow,
  newId: () => crypto.randomUUID(),
  provider: () => enrichmentProviderFixture,
};

/** Capture and queue a fresh local test run. */
export async function prepareEnrichmentRunFixture(
  ctx: RequestContext,
  amount: number,
  configuration = enrichmentConfigFixture,
) {
  await addEnrichmentQuestions(ctx, amount);
  const snapshotId = crypto.randomUUID();
  if (
    !((await new BankEnrichmentScopes(db, enrichmentTestNow).capture(ctx, snapshotId, {
      _tag: 'Filtered',
      queryString: '',
    })).ok)
  ) {
    expect.unreachable(
      "Expected (await new BankEnrichmentScopes(db, enrichmentTestNow).capture(ctx, snapshotId, { _tag: 'F",
    );
  }
  const schemeId = crypto.randomUUID(),
    versionId = crypto.randomUUID(),
    runId = crypto.randomUUID(),
    executionId = crypto.randomUUID();
  if (
    !((await new BankEnrichmentStore(db, enrichmentTestNow).saveVersion(ctx, {
      id: versionId,
      schemeId,
      expectedVersion: 0,
      definition: enrichmentDefinitionFixture(),
    })).ok)
  ) {
    expect.unreachable(
      'Expected (await new BankEnrichmentStore(db, enrichmentTestNow).saveVersion(ctx, { id: versionId, sc',
    );
  }
  if (
    !((await new BankEnrichmentRunStore(db, enrichmentTestNow).prepare(ctx, runId, {
      snapshotId,
      versionId,
      dimensions: ['subject', 'topic', 'difficulty'],
      replacement: 'preserve_manual',
    })).ok)
  ) {
    expect.unreachable(
      'Expected (await new BankEnrichmentRunStore(db, enrichmentTestNow).prepare(ctx, runId, { snapshotId,',
    );
  }
  const jobs = new BankEnrichmentJobs(db, enrichmentTestNow);
  if (!((await jobs.queueRun(ctx, runId, executionId, configuration)).ok)) {
    expect.unreachable('Expected (await jobs.queueRun(ctx, runId, executionId, configuration)).ok');
  }
  return {
    snapshotId,
    schemeId,
    versionId,
    runId,
    executionId,
    jobs,
    params: { jobId: runId, workflowExecutionId: executionId },
  };
}
/** Drive bounded test steps through the production processor. */
export async function finishEnrichmentRunFixture(
  params: { jobId: string; workflowExecutionId: string },
  worker = enrichmentWorkerFixture,
) {
  for (let step = 0; step < 30; step++) {
    const result = await processEnrichmentStep(params, worker);
    if (!(result.ok)) expect.unreachable(JSON.stringify(result));
    if (['completed', 'failed', 'cancelled'].includes(result.value.state)) return result.value;
    if (!(result.value.state !== 'busy')) {
      expect.unreachable('A released batch must be immediately claimable.');
    }
  }
  throw new Error('Test enrichment run did not finish.');
}

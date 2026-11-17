import { expect } from 'vitest';

import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../lib/db.ts';
import { enrichmentRunItems } from '../../lib/db/bank_enrichment_job_schema.ts';
import {
  enrichmentChanges,
  enrichmentSchemeVersions,
} from '../../lib/db/bank_enrichment_schema.ts';
import { BankEnrichmentStore } from '../../lib/services/bank_enrichment_store.ts';
import { BankEnrichmentScopes } from '../../lib/services/bank_enrichment_scope.ts';
import { BankEnrichmentMutations } from '../../lib/services/bank_enrichment_mutation_store.ts';
import { BankEnrichmentJobs } from '../../lib/services/bank_enrichment_jobs.ts';
import { processEnrichmentStep } from '../../lib/services/bank_enrichment_processor.ts';
import { loadCurrentEnrichmentChanges } from '../../lib/services/bank_enrichment_changes.ts';
import type { EnrichmentCorrectionValues } from '../../lib/services/bank_enrichment_change_contract.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { enrichmentDefinitionFixture } from '../bank_enrichment_fixture.ts';
import { addEnrichmentQuestions } from './enrichment_workspace.ts';

export const mutationNow = () => new Date();
export const mutationJobs = new BankEnrichmentJobs(db, mutationNow);
export const mutations = new BankEnrichmentMutations(db, mutationNow);

/** A real published bank and frozen all-matching scope. */
export async function mutationBank(ctx: RequestContext, count: number) {
  const ids = await addEnrichmentQuestions(ctx, count);
  const schemeId = crypto.randomUUID(),
    versionId = crypto.randomUUID(),
    snapshotId = crypto.randomUUID();
  if (
    !((await new BankEnrichmentStore(db, mutationNow).saveVersion(ctx, {
      id: versionId,
      schemeId,
      expectedVersion: 0,
      definition: enrichmentDefinitionFixture(),
    })).ok)
  ) {
    expect.unreachable(
      'Expected (await new BankEnrichmentStore(db, mutationNow).saveVersion(ctx, { id: versionId, schemeId',
    );
  }
  const scope = await new BankEnrichmentScopes(db, mutationNow).capture(ctx, snapshotId, {
    _tag: 'Filtered',
    queryString: 'tags=source-science&page=2',
  });
  if (!(scope.ok)) expect.unreachable('Expected scope.ok');
  expect(scope.value.itemCount).toStrictEqual(count);
  return { ids, schemeId, versionId, snapshotId };
}

/** Freeze and dispatch a real selected correction; inputs travel through production parsers. */
export async function correctQuestions(
  ctx: RequestContext,
  versionId: string,
  ids: readonly string[],
  values: EnrichmentCorrectionValues,
) {
  const snapshotId = crypto.randomUUID(),
    id = crypto.randomUUID(),
    executionId = crypto.randomUUID();
  if (
    !((await new BankEnrichmentScopes(db, mutationNow).capture(ctx, snapshotId, {
      _tag: 'Selected',
      questionIds: ids,
    })).ok)
  ) {
    expect.unreachable(
      "Expected (await new BankEnrichmentScopes(db, mutationNow).capture(ctx, snapshotId, { _tag: 'Selecte",
    );
  }
  if (!((await mutations.correct(ctx, id, { snapshotId, versionId, values })).ok)) {
    expect.unreachable(
      'Expected (await mutations.correct(ctx, id, { snapshotId, versionId, values })).ok',
    );
  }
  if (!((await mutationJobs.queueMutation(ctx, id, executionId)).ok)) {
    expect.unreachable('Expected (await mutationJobs.queueMutation(ctx, id, executionId)).ok');
  }
  await finishMutation(id, executionId);
  return id;
}

/** An explicit provider boundary rejects any AI dispatch by human operations. */
export const mutationWorker = {
  database: db,
  now: mutationNow,
  newId: () => crypto.randomUUID(),
  provider: () => {
    throw new Error('Human mutation must not create an AI provider.');
  },
};

/** Drain bounded production steps, with a finite fixture-only ceiling. */
export async function finishMutation(jobId: string, workflowExecutionId: string) {
  for (let step = 0; step < 100; step++) {
    const result = await processEnrichmentStep({ jobId, workflowExecutionId }, mutationWorker);
    if (!(result.ok)) expect.unreachable(JSON.stringify(result));
    if (result.value.state === 'completed') return result.value;
    expect(result.value.state).toStrictEqual('more');
  }
  throw new Error('Mutation fixture did not finish.');
}

/** Read the real token and historical vocabulary for one question. */
export async function currentQuestion(ctx: RequestContext, schemeId: string, questionId: string) {
  const rows = await loadCurrentEnrichmentChanges(db, ctx.tenantId, schemeId, [questionId]);
  const row = rows.get(questionId);
  if (!row) expect.unreachable('Expected row');
  return row;
}
export function mutationOutcomes(id: string) {
  return db.select().from(enrichmentRunItems).where(eq(enrichmentRunItems.runId, id)).orderBy(
    enrichmentRunItems.questionId,
  );
}
export function mutationWrites(ctx: RequestContext, id: string) {
  return db.select().from(enrichmentChanges).where(
    and(eq(enrichmentChanges.tenantId, ctx.tenantId), eq(enrichmentChanges.operationId, id)),
  );
}

/** Inspect the current edit token after corrections may have saved teaching versions. */
export async function currentMutationVocabularyVersion(
  ctx: RequestContext,
  schemeId: string,
): Promise<number> {
  const [latest] = await db.select({ version: enrichmentSchemeVersions.version }).from(
    enrichmentSchemeVersions,
  ).where(
    and(
      eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
      eq(enrichmentSchemeVersions.schemeId, schemeId),
    ),
  ).orderBy(desc(enrichmentSchemeVersions.version)).limit(1);
  if (!latest) expect.unreachable('Expected latest');
  return latest.version;
}

import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { enrichmentBatches, enrichmentRunItems } from '../lib/db/bank_enrichment_job_schema.ts';
import { enrichmentAssignments, enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import { processEnrichmentStep } from '../lib/services/bank_enrichment_processor.ts';
import { claimEnrichmentStep } from '../lib/services/bank_enrichment_worker_store.ts';
import {
  beginEnrichmentAttempt,
  nextEnrichmentBatch,
} from '../lib/services/bank_enrichment_batch_store.ts';
import { classificationRequest } from '../lib/services/bank_enrichment_classifier.ts';
import { loadEnrichmentSources } from '../lib/services/bank_enrichment_sources.ts';
import { BankEnrichmentUsage } from '../lib/services/bank_enrichment_usage.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { enrichmentProviderFixture } from './helpers/enrichment_provider_fixture.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import {
  enrichmentTestNow as now,
  enrichmentWorkerFixture as services,
  finishEnrichmentRunFixture as finish,
  prepareEnrichmentRunFixture as prepare,
} from './helpers/enrichment_workflow_fixture.ts';

testCase(
  'invalid classifier output retries within the budget without applying rejected values',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepare(ctx, 2);
        const invalidWorker = {
          ...services,
          provider: () => async (request: Parameters<typeof enrichmentProviderFixture>[0]) => {
            const receipt = await enrichmentProviderFixture(request);
            if (!(receipt.ok)) expect.unreachable('Expected receipt.ok');
            return { ...receipt, content: JSON.stringify({ items: [] }) };
          },
        };
        const first = await processEnrichmentStep(run.params, invalidWorker);
        if (!(first.ok && first.value.state === 'retry')) {
          expect.unreachable("Expected first.ok && first.value.state === 'retry'");
        }
        expect(first.value.completed).toStrictEqual(0);
        expect(
          (await db.select().from(enrichmentAssignments).where(
            eq(enrichmentAssignments.schemeId, run.schemeId),
          )).length,
        ).toStrictEqual(0);
        expect((await finish(run.params)).completed).toStrictEqual(2);
        const summary = await new BankEnrichmentUsage(db, now).summary(ctx, run.runId);
        if (!(summary.ok)) expect.unreachable('Expected summary.ok');
        expect(summary.value.attempts).toStrictEqual(2);
        expect(
          (await db.select().from(enrichmentChanges).where(
            eq(enrichmentChanges.operationId, run.runId),
          )).length,
        ).toStrictEqual(6);
      });
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepare(ctx, 2);
        await finish(run.params, {
          ...services,
          provider: () => () =>
            Promise.resolve({ ok: false, code: 'invalid_response', usage: null }),
        });
        const [batch] = await db.select().from(enrichmentBatches).where(
          eq(enrichmentBatches.runId, run.runId),
        );
        expect(batch.attempts).toStrictEqual(3);
        expect(batch.state).toStrictEqual('failed');
        expect(
          (await db.select().from(enrichmentAssignments).where(
            eq(enrichmentAssignments.schemeId, run.schemeId),
          )).length,
        ).toStrictEqual(0);
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'resume after a request change retains the old charge and uses a fresh bounded attempt',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepare(ctx, 2);
        const acquired = await claimEnrichmentStep(
          db,
          now(),
          run.runId,
          run.executionId,
          crypto.randomUUID(),
        );
        if (
          !(acquired.ok && acquired.value.kind === 'claimed' &&
            acquired.value.claim.kind === 'classify')
        ) {
          expect.unreachable(
            "Expected acquired.ok && acquired.value.kind === 'claimed' && acquired.value.claim.kind === 'classif",
          );
        }
        const claim = acquired.value.claim;
        const next = await nextEnrichmentBatch(db, claim, now());
        if (!(next.ok && 'sequence' in next.value)) {
          expect.unreachable("Expected next.ok && 'sequence' in next.value");
        }
        const refs = await db.select({
          questionId: enrichmentRunItems.questionId,
          revisionId: enrichmentRunItems.revisionId,
        }).from(enrichmentRunItems).where(eq(enrichmentRunItems.runId, run.runId));
        const sources = await loadEnrichmentSources(db, ctx.tenantId, refs);
        const request = classificationRequest(
          enrichmentDefinitionFixture(),
          sources.flatMap((source) => source.content.ok ? [source.content.value] : []),
        );
        if (!request) expect.unreachable('Expected request');
        const attempt = await beginEnrichmentAttempt(
          db,
          claim,
          next.value,
          crypto.randomUUID(),
          now(),
        );
        if (!(attempt.ok)) expect.unreachable('Expected attempt.ok');
        const usage = new BankEnrichmentUsage(db, now);
        const old = await usage.execute(ctx, run.runId, attempt.value, {
          ...request,
          system: request.system + ' Prior request instructions.',
        }, () => enrichmentProviderFixture);
        if (!(old.ok && old.value.ok)) expect.unreachable('Expected old.ok && old.value.ok');
        const oldSummary = await usage.summary(ctx, run.runId);
        if (!(oldSummary.ok)) expect.unreachable('Expected oldSummary.ok');
        if (!((await run.jobs.cancel(ctx, run.runId)).ok)) {
          expect.unreachable('Expected (await run.jobs.cancel(ctx, run.runId)).ok');
        }
        const executionId = crypto.randomUUID();
        if (!((await run.jobs.resume(ctx, run.runId, executionId)).ok)) {
          expect.unreachable('Expected (await run.jobs.resume(ctx, run.runId, executionId)).ok');
        }
        const params = { jobId: run.runId, workflowExecutionId: executionId };
        const retry = await processEnrichmentStep(params, services);
        if (!(retry.ok && retry.value.state === 'retry')) {
          expect.unreachable("Expected retry.ok && retry.value.state === 'retry'");
        }
        expect(retry.value.completed).toStrictEqual(0);
        expect((await finish(params)).completed).toStrictEqual(2);
        const summary = await usage.summary(ctx, run.runId);
        if (!(summary.ok)) expect.unreachable('Expected summary.ok');
        expect(summary.value.attempts).toStrictEqual(2);
        if (!(summary.value.chargedMicros > oldSummary.value.chargedMicros)) {
          expect.unreachable(
            'Expected summary.value.chargedMicros > oldSummary.value.chargedMicros',
          );
        }
        expect(
          (await db.select().from(enrichmentChanges).where(
            eq(enrichmentChanges.operationId, run.runId),
          )).length,
        ).toStrictEqual(6);
      });
    } finally {
      await shutdownDb();
    }
  },
);

import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { enrichmentUsageAttempts } from '../lib/db/bank_enrichment_usage_schema.ts';
import { enrichmentAssignments } from '../lib/db/bank_enrichment_schema.ts';
import { enrichmentCostMicros, parseEnrichmentAIConfig } from '../lib/ai/bank_enrichment_config.ts';
import type {
  EnrichmentAIProvider,
  EnrichmentAIReceipt,
  EnrichmentAIRequest,
} from '../lib/ai/bank_enrichment_provider.ts';
import { BankEnrichmentUsage } from '../lib/services/bank_enrichment_usage.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import { BankEnrichmentSampler } from '../lib/services/bank_enrichment_sample.ts';
import {
  BankEnrichmentAnalysis,
  estimateEnrichmentRunMicros,
} from '../lib/services/bank_enrichment_analysis.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';

const config = parseEnrichmentAIConfig({
  provider: 'cloudflare',
  model: '@cf/moonshotai/kimi-k2.6',
  promptVersion: 'bank-enrichment-v1',
  inputMicrosPerMillion: 950000,
  outputMicrosPerMillion: 4000000,
  previewBudgetMicros: 40000,
  runBudgetMicros: 25000000,
});
if (!config) throw new Error('Invalid usage configuration fixture.');
const request: EnrichmentAIRequest = { system: 'Classify', data: '{}', schema: { type: 'object' } };
const receipt: EnrichmentAIReceipt = {
  ok: true,
  content: '{}',
  usage: { model: 'kimi-k2.6', requestId: 'test-request', inputTokens: 1000, outputTokens: 100 },
};

testCase(
  'concurrent attempts cannot exceed the budget or redispatch an ambiguous request',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        await addEnrichmentQuestions(ctx, 1);
        const snapshotId = crypto.randomUUID();
        if (
          !((await new BankEnrichmentScopes(db, () => new Date()).capture(ctx, snapshotId, {
            _tag: 'Filtered',
            queryString: '',
          })).ok)
        ) {
          expect.unreachable(
            "Expected (await new BankEnrichmentScopes(db, () => new Date()).capture(ctx, snapshotId, { _tag: 'Fi",
          );
        }
        const usage = new BankEnrichmentUsage(db, () => new Date());
        const budgetId = crypto.randomUUID();
        if (!((await usage.open(ctx, budgetId, snapshotId, 'preview', config)).ok)) {
          expect.unreachable(
            "Expected (await usage.open(ctx, budgetId, snapshotId, 'preview', config)).ok",
          );
        }
        expect(
          await usage.open(ctx, budgetId, snapshotId, 'preview', {
            ...config,
            previewBudgetMicros: 50000,
          }),
        ).toStrictEqual({ ok: false, code: 'operation_conflict' });
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<EnrichmentAIReceipt>();
        const provider: EnrichmentAIProvider = () => {
          started.resolve();
          return release.promise;
        };
        const attemptId = crypto.randomUUID();
        const first = usage.execute(ctx, budgetId, attemptId, request, () => provider);
        await started.promise;
        expect(await usage.execute(ctx, budgetId, attemptId, request, () => provider))
          .toStrictEqual({
            ok: false,
            code: 'in_flight',
          });
        expect(await usage.execute(ctx, budgetId, crypto.randomUUID(), request, () => provider))
          .toStrictEqual({ ok: false, code: 'budget_exceeded' });
        release.resolve({ ok: false, code: 'provider_failed', usage: null });
        if (!((await first).ok)) expect.unreachable('Expected (await first).ok');
        expect(await usage.execute(ctx, budgetId, crypto.randomUUID(), request, () => provider))
          .toStrictEqual({ ok: false, code: 'budget_exceeded' });
        const summary = await usage.summary(ctx, budgetId);
        if (!(summary.ok)) expect.unreachable('Expected summary.ok');
        expect(summary.value.attempts).toStrictEqual(1);
        expect(summary.value.chargedMicros).toStrictEqual(0);
        if (!(summary.value.reservedMicros > 0)) {
          expect.unreachable('Expected summary.value.reservedMicros > 0');
        }
        expect(summary.value.uncertain).toStrictEqual(1);
        const rows = await db.select().from(enrichmentUsageAttempts).where(
          eq(enrichmentUsageAttempts.budgetId, budgetId),
        );
        expect(rows[0].chargedMicros).toStrictEqual(rows[0].reservedMicros);
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'receipts replay without another call, measured costs settle and cancellation does not dispatch',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        await addEnrichmentQuestions(ctx, 1);
        const snapshotId = crypto.randomUUID();
        if (
          !((await new BankEnrichmentScopes(db, () => new Date()).capture(ctx, snapshotId, {
            _tag: 'Filtered',
            queryString: '',
          })).ok)
        ) {
          expect.unreachable(
            "Expected (await new BankEnrichmentScopes(db, () => new Date()).capture(ctx, snapshotId, { _tag: 'Fi",
          );
        }
        const usage = new BankEnrichmentUsage(db, () => new Date());
        const budgetId = crypto.randomUUID();
        if (!((await usage.open(ctx, budgetId, snapshotId, 'preview', config)).ok)) {
          expect.unreachable(
            "Expected (await usage.open(ctx, budgetId, snapshotId, 'preview', config)).ok",
          );
        }
        const attemptId = crypto.randomUUID();
        expect(
          await usage.execute(
            ctx,
            budgetId,
            attemptId,
            request,
            () => () => Promise.resolve(receipt),
          ),
        ).toStrictEqual({ ok: true, value: receipt });
        const forbiddenProvider = () => {
          throw new Error('Provider must not be called on replay, forbidden or aborted requests.');
        };
        expect(await usage.execute(ctx, budgetId, attemptId, request, forbiddenProvider))
          .toStrictEqual({
            ok: true,
            value: receipt,
          });
        expect(
          await usage.execute(
            ctx,
            budgetId,
            attemptId,
            { ...request, data: '{"changed":true}' },
            forbiddenProvider,
          ),
        ).toStrictEqual({ ok: false, code: 'request_changed' });
        expect(
          await usage.execute(
            { ...ctx, userId: crypto.randomUUID() },
            budgetId,
            crypto.randomUUID(),
            request,
            forbiddenProvider,
          ),
        ).toStrictEqual({ ok: false, code: 'forbidden' });
        const controller = new AbortController();
        controller.abort();
        expect(
          await usage.execute(
            ctx,
            budgetId,
            crypto.randomUUID(),
            request,
            forbiddenProvider,
            { signal: controller.signal },
          ),
        ).toStrictEqual({ ok: false, code: 'aborted' });
        const summary = await usage.summary(ctx, budgetId);
        if (!(summary.ok)) expect.unreachable('Expected summary.ok');
        expect(summary.value.chargedMicros).toStrictEqual(enrichmentCostMicros(config, 1000, 100));
        expect(summary.value.attempts).toStrictEqual(1);
        expect(summary.value.reservedMicros).toStrictEqual(0);
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'analysis validates recorded provider output, previews write no assignments and estimates use measured classifications',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        await addEnrichmentQuestions(ctx, 1);
        const snapshotId = crypto.randomUUID();
        if (
          !((await new BankEnrichmentScopes(db, () => new Date()).capture(ctx, snapshotId, {
            _tag: 'Filtered',
            queryString: '',
          })).ok)
        ) {
          expect.unreachable(
            "Expected (await new BankEnrichmentScopes(db, () => new Date()).capture(ctx, snapshotId, { _tag: 'Fi",
          );
        }
        const sampled = await new BankEnrichmentSampler(db).sample(
          ctx,
          snapshotId,
          crypto.randomUUID(),
        );
        if (!(sampled.ok)) expect.unreachable('Expected sampled.ok');
        const usage = new BankEnrichmentUsage(db, () => new Date());
        const budgetId = crypto.randomUUID();
        if (
          !((await usage.open(ctx, budgetId, snapshotId, 'preview', {
            ...config,
            previewBudgetMicros: 1000000,
          })).ok)
        ) {
          expect.unreachable(
            "Expected (await usage.open(ctx, budgetId, snapshotId, 'preview', { ...config, previewBudgetMicros: ",
          );
        }
        const assignment = {
          subject: { state: 'assigned', valueIds: ['life'] },
          topic: { state: 'assigned', valueIds: ['cells'] },
          difficulty: { state: 'assigned', valueIds: ['easy'] },
        };
        const items = sampled.value.questions.map((q) => ({
          questionId: q.questionId,
          revisionId: q.revisionId,
          classification: assignment,
          rationale: 'Recall a familiar structure.',
        }));
        const analysis = new BankEnrichmentAnalysis(
          usage,
          () => () => Promise.resolve({ ...receipt, content: JSON.stringify({ items }) }),
        );
        const classified = await analysis.classify(
          ctx,
          budgetId,
          crypto.randomUUID(),
          enrichmentDefinitionFixture(),
          sampled.value.questions,
        );
        if (!(classified.ok)) expect.unreachable('Expected classified.ok');
        expect(classified.value.result.length).toStrictEqual(1);
        const malformed = new BankEnrichmentAnalysis(
          usage,
          () => () => Promise.resolve({ ...receipt, content: '{"items":[]}' }),
        );
        expect(
          await malformed.classify(
            ctx,
            budgetId,
            crypto.randomUUID(),
            enrichmentDefinitionFixture(),
            sampled.value.questions,
          ),
        ).toStrictEqual({ ok: false, code: 'invalid_response' });
        expect(
          await db.select().from(enrichmentAssignments).where(
            eq(enrichmentAssignments.tenantId, ctx.tenantId),
          ),
        ).toStrictEqual([]);
        const summary = await usage.summary(ctx, budgetId);
        if (!(summary.ok)) expect.unreachable('Expected summary.ok');
        expect(summary.value.attempts).toStrictEqual(2);
        expect(summary.value.chargedMicros).toStrictEqual(
          enrichmentCostMicros(config, 1000, 100) * 2,
        );
        expect(estimateEnrichmentRunMicros(10000, 20, 7787)).toStrictEqual(3893500);
        expect(estimateEnrichmentRunMicros(10000, 0, 7787)).toStrictEqual(null);
      });
    } finally {
      await shutdownDb();
    }
  },
);

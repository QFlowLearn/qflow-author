import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { enrichmentAssignments } from '../lib/db/bank_enrichment_schema.ts';
import { questionRevisions, questions } from '../lib/db/question_schema.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import { BankEnrichmentSampler } from '../lib/services/bank_enrichment_sample.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';

testCase(
  'sample covers a frozen scope beyond page one, repeats by seed and writes no assignments',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const ids = await addEnrichmentQuestions(ctx, 151);
        const snapshotId = crypto.randomUUID();
        const captured = await new BankEnrichmentScopes(db, () => new Date()).capture(
          ctx,
          snapshotId,
          { _tag: 'Filtered', queryString: 'page=2&pageSize=100' },
        );
        if (!(captured.ok)) expect.unreachable('Expected captured.ok');
        const before = await db.select().from(questionRevisions).where(
          eq(questionRevisions.tenantId, ctx.tenantId),
        );
        const source = await db.select().from(questions).where(
          eq(questions.tenantId, ctx.tenantId),
        );
        const sampler = new BankEnrichmentSampler(db);
        const seed = crypto.randomUUID();
        const sampled = await sampler.sample(ctx, snapshotId, seed);
        if (!(sampled.ok)) expect.unreachable('Expected sampled.ok');
        expect(sampled.value.scopeCount).toStrictEqual(151);
        expect(sampled.value.selectedCount).toStrictEqual(100);
        if (!(sampled.value.questions.length > 50)) {
          expect.unreachable('Expected sampled.value.questions.length > 50');
        }
        if (!(sampled.value.questions.some((q) => ids.slice(100).includes(q.questionId)))) {
          expect.unreachable(
            'Expected sampled.value.questions.some((q) => ids.slice(100).includes(q.questionId))',
          );
        }
        if (!(sampled.value.questions.some((q) => q.promptHtml.length > 2000))) {
          expect.unreachable(
            'Expected sampled.value.questions.some((q) => q.promptHtml.length > 2000)',
          );
        }
        if (!(sampled.value.questions.some((q) => q.promptHtml.length < 100))) {
          expect.unreachable(
            'Expected sampled.value.questions.some((q) => q.promptHtml.length < 100)',
          );
        }
        expect(await sampler.sample(ctx, snapshotId, seed)).toStrictEqual(sampled);
        expect(await sampler.sample(ctx, snapshotId, crypto.randomUUID())).not.toStrictEqual(
          sampled,
        );
        expect(await sampler.sample({ ...ctx, userId: crypto.randomUUID() }, snapshotId, seed))
          .toStrictEqual({ ok: false, code: 'forbidden' });
        expect(
          await db.select().from(enrichmentAssignments).where(
            eq(enrichmentAssignments.tenantId, ctx.tenantId),
          ),
        ).toStrictEqual([]);
        expect(
          await db.select().from(questionRevisions).where(
            eq(questionRevisions.tenantId, ctx.tenantId),
          ),
        ).toStrictEqual(before);
        expect(await db.select().from(questions).where(eq(questions.tenantId, ctx.tenantId)))
          .toStrictEqual(source);
      });
    } finally {
      await shutdownDb();
    }
  },
);

import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { questions } from '../lib/db/question_schema.ts';
import { BankEnrichmentBrowse } from '../lib/services/bank_enrichment_browse.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { BankEnrichmentRunStore } from '../lib/services/bank_enrichment_run_store.ts';
import { BankEnrichmentJobs } from '../lib/services/bank_enrichment_jobs.ts';
import { processEnrichmentStep } from '../lib/services/bank_enrichment_processor.ts';
import { parseQuestionBankQuery } from '../lib/services/question_bank_query.ts';
import { listQuestionBank } from '../lib/services/question_bank_read.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import {
  enrichmentConfigFixture,
  enrichmentProviderFixture,
} from './helpers/enrichment_provider_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { finishTestEnrichment } from './helpers/enrichment_test_worker.ts';

const now = () => new Date();
testCase(
  'enrichment browsing counts the full bank and distinguishes unfinished from untouched questions',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const ids = await addEnrichmentQuestions(ctx, 105);
        const schemeId = crypto.randomUUID(),
          versionId = crypto.randomUUID(),
          snapshotId = crypto.randomUUID(),
          runId = crypto.randomUUID(),
          executionId = crypto.randomUUID();
        if (
          !((await new BankEnrichmentStore(db, now).saveVersion(ctx, {
            id: versionId,
            schemeId,
            expectedVersion: 0,
            definition: enrichmentDefinitionFixture(),
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await new BankEnrichmentStore(db, now).saveVersion(ctx, { id: versionId, schemeId, expect',
          );
        }
        const scopes = new BankEnrichmentScopes(db, now);
        if (!((await scopes.capture(ctx, snapshotId, { _tag: 'Filtered', queryString: '' })).ok)) {
          expect.unreachable(
            "Expected (await scopes.capture(ctx, snapshotId, { _tag: 'Filtered', queryString: '' })).ok",
          );
        }
        if (
          !((await new BankEnrichmentRunStore(db, now).prepare(ctx, runId, {
            snapshotId,
            versionId,
            dimensions: ['subject', 'topic', 'difficulty'],
            replacement: 'preserve_manual',
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await new BankEnrichmentRunStore(db, now).prepare(ctx, runId, { snapshotId, versionId, di',
          );
        }
        const browse = new BankEnrichmentBrowse(db);
        const query = (suffix = '') =>
          parseQuestionBankQuery(new URLSearchParams(`scheme=${schemeId}${suffix}`));
        const prepared = await browse.read(ctx, query(), ids.slice(0, 100));
        if (!(prepared.ok && prepared.value.selection)) {
          expect.unreachable(JSON.stringify(prepared));
        }
        expect(prepared.value.selection.facets.subject.outside).toStrictEqual(105);
        if (
          !((await new BankEnrichmentJobs(db, now).queueRun(
            ctx,
            runId,
            executionId,
            enrichmentConfigFixture,
          )).ok)
        ) {
          expect.unreachable(
            'Expected (await new BankEnrichmentJobs(db, now).queueRun( ctx, runId, executionId, enrichmentConfig',
          );
        }
        const [outsideId] = await addEnrichmentQuestions(ctx, 1);
        const queued = await browse.read(ctx, query(), [ids[0], outsideId]);
        if (!(queued.ok && queued.value.selection)) expect.unreachable(JSON.stringify(queued));
        expect(queued.value.selection.facets.subject.pending).toStrictEqual(105);
        expect(queued.value.selection.facets.subject.outside).toStrictEqual(1);
        expect(queued.value.selection.rows[ids[0]].difficulty).toStrictEqual({ state: 'pending' });
        expect(queued.value.selection.rows[outsideId].difficulty).toStrictEqual({
          state: 'outside',
        });
        const queuedOverview = await browse.page(
          ctx,
          { ...query(), view: 'overview' },
          { locale: 'en-US' },
        );
        if (
          !(queuedOverview.ok && queuedOverview.value.kind === 'overview' &&
            queuedOverview.value.enrichment.selection)
        ) {
          expect.unreachable(
            "Expected queuedOverview.ok && queuedOverview.value.kind === 'overview' && queuedOverview.value.enri",
          );
        }
        expect(queuedOverview.value.enrichment.selection.overview.total).toStrictEqual(106);
        expect(
          queuedOverview.value.enrichment.selection.overview.rows.find((row) =>
            row.bucket.key === 'pending'
          )?.total,
        ).toStrictEqual(105);
        expect(
          queuedOverview.value.enrichment.selection.overview.rows.find((row) =>
            row.bucket.key === 'outside'
          )?.total,
        ).toStrictEqual(1);

        const step = await processEnrichmentStep(
          { jobId: runId, workflowExecutionId: executionId },
          {
            database: db,
            now,
            newId: () => crypto.randomUUID(),
            provider: () => enrichmentProviderFixture,
          },
        );
        if (!(step.ok)) expect.unreachable(JSON.stringify(step));
        const partial = await browse.read(ctx, query(), []);
        if (!(partial.ok && partial.value.selection)) expect.unreachable(JSON.stringify(partial));
        if (
          !(partial.value.selection.facets.subject.pending > 0 &&
            partial.value.selection.facets.subject.pending < 105)
        ) {
          expect.unreachable(
            'Expected partial.value.selection.facets.subject.pending > 0 && partial.value.selection.facets.subje',
          );
        }
        const [done, concurrent] = await Promise.all([
          finishTestEnrichment(runId, executionId),
          browse.page(ctx, query('&subject=pending'), { locale: 'en-US' }),
        ]);
        if (
          !(concurrent.ok && concurrent.value.kind === 'questions' &&
            concurrent.value.enrichment.selection)
        ) expect.unreachable(JSON.stringify(concurrent));
        expect(concurrent.value.bank.total).toStrictEqual(
          concurrent.value.enrichment.selection.facets.subject.pending,
        );
        for (const item of concurrent.value.bank.items) {
          expect(concurrent.value.enrichment.selection.rows[item.id].subject.state).toStrictEqual(
            'pending',
          );
        }
        expect(done._tag).toStrictEqual('Completed');
        const complete = await browse.read(ctx, query(), ids.slice(0, 100));
        if (!(complete.ok && complete.value.selection)) {
          expect.unreachable(JSON.stringify(complete));
        }
        expect(complete.value.selection.facets.subject.pending).toStrictEqual(0);
        const life = complete.value.selection.facets.subject.categories.find((c) =>
          c.id === 'life'
        );
        if (!life) expect.unreachable('Expected life');
        expect(life.count).toStrictEqual(105);
        expect(Object.keys(complete.value.selection.rows).length).toStrictEqual(100);
        const classified = query(`&subject=${versionId}:life&page=2`);
        const page = await listQuestionBank(ctx, classified);
        expect(page.total).toStrictEqual(105);
        expect(page.items.length).toStrictEqual(5);
        const capture = await scopes.capture(ctx, crypto.randomUUID(), {
          _tag: 'Filtered',
          queryString: `scheme=${schemeId}&subject=${versionId}:life&page=2`,
        });
        if (!(capture.ok)) expect.unreachable(JSON.stringify(capture));
        expect(capture.value.itemCount).toStrictEqual(105);
        expect((await listQuestionBank(ctx, query('&subject=outside'))).items.map((q) => q.id))
          .toStrictEqual([outsideId]);
        expect((await listQuestionBank(ctx, query('&subject=pending'))).total).toStrictEqual(0);
        expect((await listQuestionBank(ctx, query(`&subject=${versionId}:physical`))).total)
          .toStrictEqual(0);
        await db.update(questions).set({ tags: ['special-source'] }).where(
          eq(questions.id, ids[0]),
        );
        const tagged = await browse.read(ctx, query('&tags=special-source'), [ids[0]]);
        if (!(tagged.ok && tagged.value.selection)) {
          expect.unreachable('Expected tagged.ok && tagged.value.selection');
        }
        expect(tagged.value.selection.facets.subject.categories.find((c) => c.id === 'life')?.count)
          .toStrictEqual(1);
        const invalid = await browse.read(ctx, query(`&subject=${versionId}:missing`), []);
        expect(invalid).toStrictEqual({ ok: false, code: 'invalid_input' });
        await withEnrichmentWorkspace(async (other) => {
          expect(await browse.read(other, query(), [])).toStrictEqual({
            ok: false,
            code: 'not_found',
          });
          expect(await browse.read({ ...ctx, userId: other.userId }, query(), [])).toStrictEqual({
            ok: false,
            code: 'forbidden',
          });
          expect((await listQuestionBank(other, query(`&subject=${versionId}:life`))).total)
            .toStrictEqual(0);
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);

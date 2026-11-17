import { expect, test as testCase } from 'vitest';

import { BankEnrichmentJobRead } from '../lib/services/bank_enrichment_job_read.ts';
import { BankEnrichmentSetup } from '../lib/services/bank_enrichment_setup.ts';

import { and, eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { enrichmentTasks } from '../lib/db/bank_enrichment_task_schema.ts';
import { enrichmentBudgets } from '../lib/db/bank_enrichment_usage_schema.ts';
import { questionRevisions, questions } from '../lib/db/question_schema.ts';
import { BankEnrichmentBrowse } from '../lib/services/bank_enrichment_browse.ts';
import { BankEnrichmentRunStore } from '../lib/services/bank_enrichment_run_store.ts';
import { processEnrichmentStep } from '../lib/services/bank_enrichment_processor.ts';
import { parseQuestionBankQuery } from '../lib/services/question_bank_query.ts';
import { listQuestionBank } from '../lib/services/question_bank_read.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { enrichmentConfigFixture } from './helpers/enrichment_provider_fixture.ts';
import { finishTestEnrichment } from './helpers/enrichment_test_worker.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import {
  correctQuestions,
  currentQuestion,
  finishMutation,
  mutationBank,
  mutationJobs,
  mutationNow,
  mutationOutcomes,
  mutations,
  mutationWorker,
  mutationWrites,
} from './helpers/enrichment_mutation_fixture.ts';

const assigned = (id: string) => ({ state: 'assigned', valueIds: [id] }) as const;
const hard = { subject: null, topic: null, difficulty: assigned('hard') };

testCase(
  'bulk corrections process a frozen full scope, resume without repeating writes, and undo without AI usage',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const bank = await mutationBank(ctx, 105);
        const originalQuestions = await db.select().from(questions).where(
          eq(questions.tenantId, ctx.tenantId),
        ).orderBy(questions.id);
        const originalRevisions = await db.select().from(questionRevisions).where(
          eq(questionRevisions.tenantId, ctx.tenantId),
        ).orderBy(questionRevisions.id);
        const id = crypto.randomUUID(), executionId = crypto.randomUUID();
        const command = { snapshotId: bank.snapshotId, versionId: bank.versionId, values: hard };
        expect(await mutations.correct(ctx, id, command)).toStrictEqual({
          ok: true,
          value: { id, itemCount: 105 },
        });
        if (!((await mutationJobs.queueMutation(ctx, id, executionId)).ok)) {
          expect.unreachable(
            'Expected (await mutationJobs.queueMutation(ctx, id, executionId)).ok',
          );
        }
        expect(await mutationJobs.queueRun(ctx, id, crypto.randomUUID(), enrichmentConfigFixture))
          .toStrictEqual({ ok: false, code: 'invalid_transition' });
        const [outside] = await addEnrichmentQuestions(ctx, 1);
        const first = await processEnrichmentStep(
          { jobId: id, workflowExecutionId: executionId },
          mutationWorker,
        );
        expect(first).toStrictEqual({ ok: true, value: { state: 'more', completed: 20 } });
        const firstWrites = await mutationWrites(ctx, id);
        expect(firstWrites.length).toStrictEqual(20);
        if (!(firstWrites.every((w) => w.origin === 'human'))) {
          expect.unreachable("Expected firstWrites.every((w) => w.origin === 'human')");
        }
        if (!((await mutationJobs.cancel(ctx, id)).ok)) {
          expect.unreachable('Expected (await mutationJobs.cancel(ctx, id)).ok');
        }
        expect((await mutationOutcomes(id)).filter((q) => q.state === 'cancelled').length)
          .toStrictEqual(85);
        const resumed = crypto.randomUUID();
        if (!((await mutationJobs.resume(ctx, id, resumed)).ok)) {
          expect.unreachable('Expected (await mutationJobs.resume(ctx, id, resumed)).ok');
        }
        expect(
          await processEnrichmentStep(
            { jobId: id, workflowExecutionId: executionId },
            mutationWorker,
          ),
        ).toStrictEqual({ ok: true, value: { state: 'cancelled', completed: 20 } });
        await finishMutation(id, resumed);
        expect((await mutationWrites(ctx, id)).length).toStrictEqual(105);
        expect(await mutations.correct(ctx, id, command)).toStrictEqual({
          ok: true,
          value: { id, itemCount: 105 },
        });
        expect(
          await mutations.correct(ctx, id, {
            ...command,
            values: { ...hard, difficulty: assigned('easy') },
          }),
        ).toStrictEqual({ ok: false, code: 'operation_conflict' });
        expect((await currentQuestion(ctx, bank.schemeId, outside)).difficulty).toStrictEqual(null);
        const query = (suffix = '') =>
          parseQuestionBankQuery(new URLSearchParams(`scheme=${bank.schemeId}${suffix}`));
        expect(
          (await listQuestionBank(ctx, query(`&difficulty=${bank.versionId}:hard&page=2`))).items
            .length,
        ).toStrictEqual(5);
        // A same-value later edit still owns a distinct change token and must survive undo.
        const later = await correctQuestions(ctx, bank.versionId, [bank.ids[0]], hard);
        const undo = crypto.randomUUID(), undoExecution = crypto.randomUUID();
        if (!((await mutations.undo(ctx, undo, id)).ok)) {
          expect.unreachable('Expected (await mutations.undo(ctx, undo, id)).ok');
        }
        if (!((await mutationJobs.queueMutation(ctx, undo, undoExecution)).ok)) {
          expect.unreachable(
            'Expected (await mutationJobs.queueMutation(ctx, undo, undoExecution)).ok',
          );
        }
        await finishMutation(undo, undoExecution);
        expect((await mutationWrites(ctx, undo)).length).toStrictEqual(104);
        const status = await new BankEnrichmentJobRead(db, mutationNow).get(ctx, undo);
        if (!(status.ok && status.value.kind === 'undo')) {
          expect.unreachable(JSON.stringify(status));
        }
        expect(status.value.usage).toStrictEqual(null);
        expect(status.value.changes).toStrictEqual({
          questions: 104,
          dimensions: 104,
          laterEdits: 1,
          noChanges: 0,
        });
        const home = await new BankEnrichmentSetup(db, mutationNow).home(ctx);
        if (!(home.ok)) expect.unreachable(JSON.stringify(home));
        expect(home.value.recent[0].kind).toStrictEqual('undo');
        expect((await currentQuestion(ctx, bank.schemeId, bank.ids[0])).difficulty?.operationId)
          .toStrictEqual(later);
        const restored = await currentQuestion(ctx, bank.schemeId, bank.ids[1]);
        expect(restored.difficulty?.value).toStrictEqual(null);
        expect(restored.difficulty?.origin).toStrictEqual('undo');
        const browse = await new BankEnrichmentBrowse(db).read(ctx, query(), [
          bank.ids[0],
          bank.ids[1],
          outside,
        ]);
        if (!(browse.ok && browse.value.selection)) expect.unreachable(JSON.stringify(browse));
        expect(browse.value.selection.facets.difficulty.outside).toStrictEqual(105);
        expect(browse.value.selection.rows[bank.ids[1]].difficulty.state).toStrictEqual('outside');
        expect((await listQuestionBank(ctx, query('&difficulty=outside'))).total).toStrictEqual(
          105,
        );
        expect((await listQuestionBank(ctx, query('&difficulty=outdated'))).total).toStrictEqual(0);
        expect((await mutationOutcomes(undo)).filter((q) => q.state === 'protected').length)
          .toStrictEqual(1);
        if (!((await mutations.undo(ctx, undo, id)).ok)) {
          expect.unreachable('Expected (await mutations.undo(ctx, undo, id)).ok');
        }
        await finishMutation(undo, undoExecution);
        const repeated = crypto.randomUUID(), repeatedExecution = crypto.randomUUID();
        if (!((await mutations.undo(ctx, repeated, id)).ok)) {
          expect.unreachable('Expected (await mutations.undo(ctx, repeated, id)).ok');
        }
        if (!((await mutationJobs.queueMutation(ctx, repeated, repeatedExecution)).ok)) {
          expect.unreachable(
            'Expected (await mutationJobs.queueMutation(ctx, repeated, repeatedExecution)).ok',
          );
        }
        await finishMutation(repeated, repeatedExecution);
        expect((await mutationWrites(ctx, repeated)).length).toStrictEqual(0);
        const tasks = await db.select().from(enrichmentTasks).where(
          eq(enrichmentTasks.tenantId, ctx.tenantId),
        );
        if (!(tasks.length >= 4 && tasks.every((t) => t.budgetId === null))) {
          expect.unreachable(
            'Expected tasks.length >= 4 && tasks.every((t) => t.budgetId === null)',
          );
        }
        expect(
          await db.select().from(enrichmentBudgets).where(
            eq(enrichmentBudgets.tenantId, ctx.tenantId),
          ),
        ).toStrictEqual([]);
        expect(
          (await db.select().from(questions).where(eq(questions.tenantId, ctx.tenantId)).orderBy(
            questions.id,
          )).filter((q) => q.id !== outside),
        ).toStrictEqual(originalQuestions);
        expect((await db.select().from(questionRevisions).where(
          eq(questionRevisions.tenantId, ctx.tenantId),
        ).orderBy(questionRevisions.id)).filter((q) => q.questionId !== outside)).toStrictEqual(
          originalRevisions,
        );
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'AI undo preserves later manual dimensions and absence tokens protect against a fresh AI rerun',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const bank = await mutationBank(ctx, 2);
        const id = crypto.randomUUID(), executionId = crypto.randomUUID();
        const prepare = {
          snapshotId: bank.snapshotId,
          versionId: bank.versionId,
          dimensions: ['subject', 'topic', 'difficulty'],
          replacement: 'preserve_manual',
        };
        if (!((await new BankEnrichmentRunStore(db, mutationNow).prepare(ctx, id, prepare)).ok)) {
          expect.unreachable(
            'Expected (await new BankEnrichmentRunStore(db, mutationNow).prepare(ctx, id, prepare)).ok',
          );
        }
        if (!((await mutationJobs.queueRun(ctx, id, executionId, enrichmentConfigFixture)).ok)) {
          expect.unreachable(
            'Expected (await mutationJobs.queueRun(ctx, id, executionId, enrichmentConfigFixture)).ok',
          );
        }
        await finishTestEnrichment(id, executionId);
        const edit = await correctQuestions(ctx, bank.versionId, [bank.ids[0]], {
          ...hard,
          difficulty: assigned('easy'),
        });
        const undo = crypto.randomUUID(), undoExecution = crypto.randomUUID();
        if (!((await mutations.undo(ctx, undo, id)).ok)) {
          expect.unreachable('Expected (await mutations.undo(ctx, undo, id)).ok');
        }
        if (!((await mutationJobs.queueMutation(ctx, undo, undoExecution)).ok)) {
          expect.unreachable(
            'Expected (await mutationJobs.queueMutation(ctx, undo, undoExecution)).ok',
          );
        }
        await finishMutation(undo, undoExecution);
        expect((await mutationWrites(ctx, undo)).length).toStrictEqual(5);
        const current = await currentQuestion(ctx, bank.schemeId, bank.ids[0]);
        expect(current.subject?.value).toStrictEqual(null);
        expect(current.topic?.value).toStrictEqual(null);
        expect(current.difficulty?.operationId).toStrictEqual(edit);
        const query = parseQuestionBankQuery(
          new URLSearchParams(`scheme=${bank.schemeId}&subject=pending`),
        );
        const browse = await new BankEnrichmentBrowse(db).read(ctx, query, bank.ids);
        if (!(browse.ok && browse.value.selection)) expect.unreachable(JSON.stringify(browse));
        expect(browse.value.selection.facets.subject.pending).toStrictEqual(2);
        expect((await listQuestionBank(ctx, query)).total).toStrictEqual(2);
        const rerun = crypto.randomUUID(), rerunExecution = crypto.randomUUID();
        if (
          !((await new BankEnrichmentRunStore(db, mutationNow).prepare(ctx, rerun, prepare)).ok)
        ) {
          expect.unreachable(
            'Expected (await new BankEnrichmentRunStore(db, mutationNow).prepare(ctx, rerun, prepare)).ok',
          );
        }
        if (
          !((await mutationJobs.queueRun(ctx, rerun, rerunExecution, enrichmentConfigFixture)).ok)
        ) {
          expect.unreachable(
            'Expected (await mutationJobs.queueRun(ctx, rerun, rerunExecution, enrichmentConfigFixture)).ok',
          );
        }
        await finishTestEnrichment(rerun, rerunExecution);
        expect((await mutationWrites(ctx, rerun)).length).toStrictEqual(0);
        expect(await currentQuestion(ctx, bank.schemeId, bank.ids[0])).toStrictEqual(current);
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'corrections reject incompatible topics, skip changed source revisions and protect later tokens',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const bank = await mutationBank(ctx, 2);
        const id = crypto.randomUUID(), executionId = crypto.randomUUID();
        expect(
          await mutations.correct(ctx, id, {
            snapshotId: bank.snapshotId,
            versionId: bank.versionId,
            values: { subject: assigned('life'), topic: null, difficulty: null },
          }),
        ).toStrictEqual({ ok: false, code: 'invalid_input' });
        expect(
          await mutations.correct(ctx, id, {
            snapshotId: bank.snapshotId,
            versionId: bank.versionId,
            values: { subject: assigned('life'), topic: assigned('energy'), difficulty: null },
          }),
        ).toStrictEqual({ ok: false, code: 'invalid_input' });
        const initial = await correctQuestions(ctx, bank.versionId, bank.ids, {
          subject: assigned('life'),
          topic: assigned('cells'),
          difficulty: assigned('easy'),
        });
        const invalidTopic = await correctQuestions(ctx, bank.versionId, [bank.ids[0]], {
          subject: null,
          topic: assigned('energy'),
          difficulty: null,
        });
        expect((await mutationWrites(ctx, invalidTopic)).length).toStrictEqual(0);
        if (
          !((await mutations.correct(ctx, id, {
            snapshotId: bank.snapshotId,
            versionId: bank.versionId,
            values: hard,
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await mutations.correct(ctx, id, { snapshotId: bank.snapshotId, versionId: bank.versionId',
          );
        }
        const later = await correctQuestions(ctx, bank.versionId, [bank.ids[0]], {
          ...hard,
          difficulty: assigned('moderate'),
        });
        const [source] = await db.select().from(questionRevisions).where(
          and(eq(questionRevisions.questionId, bank.ids[1]), eq(questionRevisions.revision, 1)),
        );
        await saveQuestionRevisionFixture(ctx, {
          questionId: bank.ids[1],
          title: 'Changed source',
          body: { ...source.body, title: 'Changed source' },
          tags: ['source-science'],
          qtiXml: source.qtiXml,
          provenance: { _tag: 'Revision', operation: 'revised', expectedParentRevision: 1 },
          draftState: 'published',
        });
        if (!((await mutationJobs.queueMutation(ctx, id, executionId)).ok)) {
          expect.unreachable(
            'Expected (await mutationJobs.queueMutation(ctx, id, executionId)).ok',
          );
        }
        await finishMutation(id, executionId);
        expect((await mutationWrites(ctx, id)).length).toStrictEqual(0);
        expect((await mutationOutcomes(id)).map((q) => q.state).sort()).toStrictEqual([
          'outdated',
          'protected',
        ]);
        expect((await currentQuestion(ctx, bank.schemeId, bank.ids[0])).difficulty?.operationId)
          .toStrictEqual(later);
        expect((await currentQuestion(ctx, bank.schemeId, bank.ids[1])).difficulty?.operationId)
          .toStrictEqual(initial);
        await withEnrichmentWorkspace(async (other) => {
          expect(await mutations.undo(other, crypto.randomUUID(), initial)).toStrictEqual({
            ok: false,
            code: 'not_found',
          });
          expect(
            await mutations.correct({ ...ctx, userId: other.userId }, crypto.randomUUID(), {
              snapshotId: bank.snapshotId,
              versionId: bank.versionId,
              values: hard,
            }),
          ).toStrictEqual({ ok: false, code: 'forbidden' });
          expect(await mutationJobs.queueMutation(other, id, crypto.randomUUID())).toStrictEqual({
            ok: false,
            code: 'not_found',
          });
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);

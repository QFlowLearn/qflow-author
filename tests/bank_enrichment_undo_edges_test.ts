import { expect, test as testCase } from 'vitest';

import { currentMutationVocabularyVersion } from './helpers/enrichment_mutation_fixture.ts';

import { db, shutdownDb } from '../lib/db.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { BankEnrichmentRunStore } from '../lib/services/bank_enrichment_run_store.ts';
import { BankEnrichmentGroupChanges } from '../lib/services/bank_enrichment_group_changes.ts';
import { BankEnrichmentJobRead } from '../lib/services/bank_enrichment_job_read.ts';
import { processEnrichmentStep } from '../lib/services/bank_enrichment_processor.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import {
  enrichmentConfigFixture,
  enrichmentProviderFixture,
} from './helpers/enrichment_provider_fixture.ts';
import { finishTestEnrichment } from './helpers/enrichment_test_worker.ts';
import {
  correctQuestions,
  currentQuestion,
  finishMutation,
  mutationBank,
  mutationJobs,
  mutationNow,
  mutations,
  mutationWorker,
  mutationWrites,
} from './helpers/enrichment_mutation_fixture.ts';

const assigned = (id: string) => ({ state: 'assigned', valueIds: [id] }) as const;
testCase('undo restores the previous vocabulary and protects a later dependent topic', async () => {
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      const bank = await mutationBank(ctx, 1);
      await correctQuestions(ctx, bank.versionId, bank.ids, {
        subject: assigned('life'),
        topic: assigned('cells'),
        difficulty: assigned('easy'),
      });
      const v2 = crypto.randomUUID();
      const definition = enrichmentDefinitionFixture();
      if (
        !((await new BankEnrichmentStore(db, mutationNow).saveVersion(ctx, {
          id: v2,
          schemeId: bank.schemeId,
          expectedVersion: await currentMutationVocabularyVersion(ctx, bank.schemeId),
          definition: {
            ...definition,
            audience: 'Grade 9 science',
            difficulty: definition.difficulty.map((d) => ({
              ...d,
              label: `${d.label} for Grade 9`,
            })),
          },
        })).ok)
      ) {
        expect.unreachable(
          'Expected (await new BankEnrichmentStore(db, mutationNow).saveVersion(ctx, { id: v2, schemeId: bank.',
        );
      }
      const source = await correctQuestions(ctx, v2, bank.ids, {
        subject: assigned('physical'),
        topic: assigned('energy'),
        difficulty: assigned('hard'),
      });
      const later = await correctQuestions(ctx, v2, bank.ids, {
        subject: null,
        topic: assigned('energy'),
        difficulty: null,
      });
      const undo = crypto.randomUUID(), execution = crypto.randomUUID();
      if (!((await mutations.undo(ctx, undo, source)).ok)) {
        expect.unreachable('Expected (await mutations.undo(ctx, undo, source)).ok');
      }
      if (!((await mutationJobs.queueMutation(ctx, undo, execution)).ok)) {
        expect.unreachable('Expected (await mutationJobs.queueMutation(ctx, undo, execution)).ok');
      }
      await finishMutation(undo, execution);
      const current = await currentQuestion(ctx, bank.schemeId, bank.ids[0]);
      expect(
        current.subject?.operationId,
        'Restoring life science must not invalidate the later energy topic.',
      ).toStrictEqual(source);
      expect(current.topic?.operationId).toStrictEqual(later);
      expect(current.difficulty?.versionId).toStrictEqual(bank.versionId);
      expect(current.difficulty?.definition.audience).toStrictEqual('Grade 6 science');
      expect(current.difficulty?.value).toStrictEqual(assigned('easy'));
      const result = await new BankEnrichmentJobRead(db, mutationNow).get(ctx, undo);
      if (!(result.ok && result.value.kind === 'undo')) {
        expect.unreachable("Expected result.ok && result.value.kind === 'undo'");
      }
      expect(result.value.changes).toStrictEqual({
        questions: 1,
        dimensions: 1,
        laterEdits: 1,
        noChanges: 0,
      });
    });
  } finally {
    await shutdownDb();
  }
});

testCase('an undo scope does not expand when its cancelled AI source is resumed', async () => {
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      const bank = await mutationBank(ctx, 25);
      const source = crypto.randomUUID(), execution = crypto.randomUUID();
      if (
        !((await new BankEnrichmentRunStore(db, mutationNow).prepare(ctx, source, {
          snapshotId: bank.snapshotId,
          versionId: bank.versionId,
          dimensions: ['subject', 'topic', 'difficulty'],
          replacement: 'preserve_manual',
        })).ok)
      ) {
        expect.unreachable(
          'Expected (await new BankEnrichmentRunStore(db, mutationNow).prepare(ctx, source, { snapshotId: bank',
        );
      }
      if (!((await mutationJobs.queueRun(ctx, source, execution, enrichmentConfigFixture)).ok)) {
        expect.unreachable(
          'Expected (await mutationJobs.queueRun(ctx, source, execution, enrichmentConfigFixture)).ok',
        );
      }
      const first = await processEnrichmentStep({ jobId: source, workflowExecutionId: execution }, {
        ...mutationWorker,
        provider: () => enrichmentProviderFixture,
      });
      if (!(first.ok && first.value.completed > 0 && first.value.completed < 25)) {
        expect.unreachable(
          'Expected first.ok && first.value.completed > 0 && first.value.completed < 25',
        );
      }
      const writesBefore = await mutationWrites(ctx, source);
      if (!((await mutationJobs.cancel(ctx, source)).ok)) {
        expect.unreachable('Expected (await mutationJobs.cancel(ctx, source)).ok');
      }
      const undo = crypto.randomUUID(), undoExecution = crypto.randomUUID();
      if (!((await mutations.undo(ctx, undo, source)).ok)) {
        expect.unreachable('Expected (await mutations.undo(ctx, undo, source)).ok');
      }
      const resumed = crypto.randomUUID();
      if (!((await mutationJobs.resume(ctx, source, resumed)).ok)) {
        expect.unreachable('Expected (await mutationJobs.resume(ctx, source, resumed)).ok');
      }
      if (!((await mutations.undo(ctx, undo, source)).ok)) {
        expect.unreachable('Identical preparation must replay while the source is running.');
      }
      if (!((await mutationJobs.queueMutation(ctx, undo, undoExecution)).ok)) {
        expect.unreachable(
          'Undo and AI processing may share a scheme; current tokens arbitrate writes.',
        );
      }
      expect((await finishTestEnrichment(source, resumed))._tag).toStrictEqual('Completed');
      await finishMutation(undo, undoExecution);
      expect((await mutationWrites(ctx, undo)).length).toStrictEqual(writesBefore.length);
      const newWrites = (await mutationWrites(ctx, source)).filter((w) =>
        !writesBefore.some((old) => old.id === w.id)
      );
      if (!(newWrites.length > 0)) expect.unreachable('Expected newWrites.length > 0');
      for (const written of newWrites) {
        const current = await currentQuestion(ctx, bank.schemeId, written.questionId);
        if (
          !(written.dimension === 'subject' || written.dimension === 'topic' ||
            written.dimension === 'difficulty')
        ) {
          expect.unreachable(
            "Expected written.dimension === 'subject' || written.dimension === 'topic' || written.dimension === ",
          );
        }
        expect(current[written.dimension]?.changeId).toStrictEqual(written.id);
      }
      const result = await new BankEnrichmentJobRead(db, mutationNow).get(ctx, undo);
      if (!(result.ok && result.value.kind === 'undo')) {
        expect.unreachable("Expected result.ok && result.value.kind === 'undo'");
      }
      expect(result.value.changes.noChanges).toStrictEqual(25 - first.value.completed);
    });
  } finally {
    await shutdownDb();
  }
});

testCase(
  'a full-filter correction refuses a changed affected count before queuing changes',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const bank = await mutationBank(ctx, 2);
        const id = crypto.randomUUID();
        await addEnrichmentQuestions(ctx, 1);
        const result = await new BankEnrichmentGroupChanges(db, mutationNow).correct(
          ctx,
          id,
          { _tag: 'Filtered', queryString: '' },
          bank.versionId,
          { subject: null, topic: null, difficulty: assigned('hard') },
          2,
        );
        expect(result).toStrictEqual({ ok: false, code: 'scope_changed' });
        expect((await mutationWrites(ctx, id)).length).toStrictEqual(0);
        expect(await new BankEnrichmentJobRead(db, mutationNow).get(ctx, id)).toStrictEqual({
          ok: false,
          code: 'not_found',
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);

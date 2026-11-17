import { expect, test as testCase } from 'vitest';

import { and, eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { organizationItems, organizationRuns } from '../lib/db/question_organization_schema.ts';
import { organizationMemberships } from '../lib/db/principal_schema.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { enrichmentAssignments, enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import { questions } from '../lib/db/question_schema.ts';
import { workflowDispatches } from '../lib/db/workflow_canvas_schema.ts';
import { queueOrganizationUndo } from '../lib/services/question_organization_undo.ts';
import { cancelOrganizationRun } from '../lib/services/question_organization_cancel.ts';
import { resumeOrganizationRun } from '../lib/services/question_organization_resume.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { settleOrganizationAfterWorkflowTerminal } from '../lib/services/question_organization_settlement.ts';
import { applyBankCollectionCommand } from '../lib/services/bank_collections.ts';
import {
  organizationNow as now,
  withOrganizationWorkspace,
} from './helpers/organization_workspace.ts';

const services = {
  database: db,
  now,
  newId: () => crypto.randomUUID(),
  provider: () => {
    throw new Error('No inference during source organization or undo');
  },
};
const readRun = async (id: string) =>
  (await db.select().from(organizationRuns).where(eq(organizationRuns.id, id)))[0];
const step = async (id: string) =>
  processOrganizationStep(
    { jobId: id, workflowExecutionId: (await readRun(id)).executionId },
    services,
  );
async function finish(id: string) {
  for (let i = 0; i < 200; i++) {
    const result = await step(id);
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    if (result.value.state === 'completed') return;
    expect(result.value.state).toStrictEqual('more');
  }
  throw new Error('Fixture did not finish');
}
const memberships = (collectionId: string) =>
  db.select().from(bankCollectionItems).where(eq(bankCollectionItems.collectionId, collectionId));

testCase(
  'undo checkpoints twenty questions, continues after interruption, and preserves manual changes between batches',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        // Original membership in the source bank must survive all compensation.
        await db.insert(bankCollectionItems).values(
          f.ids.map((questionId, position) => ({
            tenantId: f.ctx.tenantId,
            collectionId: f.originId,
            questionId,
            position,
          })),
        );
        await finish(f.runId);
        const command = { runId: f.runId, expectedExecutionId: f.params.workflowExecutionId };
        expect(
          await Promise.all([
            queueOrganizationUndo(db, f.ctx, command, now()),
            queueOrganizationUndo(db, f.ctx, command, now()),
          ]),
        ).toStrictEqual([{ ok: true, value: f.runId }, { ok: true, value: f.runId }]);
        expect(
          (await memberships(f.destinationId)).length,
          'Queueing undo must not undo in the request',
        ).toStrictEqual(61);
        expect(
          (await db.select().from(workflowDispatches).where(eq(workflowDispatches.jobId, f.runId)))
            .length,
        ).toStrictEqual(2);
        const initialUndo = await readRun(f.runId);
        expect(await processOrganizationStep(f.params, services)).toStrictEqual({
          ok: false,
          code: 'not_found',
        });
        expect(await cancelOrganizationRun(db, f.ctx, f.runId)).toStrictEqual({
          ok: false,
          code: 'conflict',
        });
        expect(await resumeOrganizationRun(db, f.ctx, f.runId, initialUndo.executionId, now()))
          .toStrictEqual({ ok: false, code: 'conflict' });
        expect(await step(f.runId)).toStrictEqual({
          ok: true,
          value: { state: 'more', completed: 20 },
        });
        const checkpoint = await readRun(f.runId);
        expect(checkpoint.undoProcessed).toStrictEqual(20);
        expect((await memberships(f.destinationId)).length).toStrictEqual(41);
        const ordered = await db.select().from(organizationItems).where(
          eq(organizationItems.runId, f.runId),
        ).orderBy(organizationItems.questionId);
        const humanQuestion = ordered[25], changedQuestion = ordered[26];
        if (
          !((await applyBankCollectionCommand(f.ctx, crypto.randomUUID(), {
            _tag: 'AddItems',
            collectionId: f.destinationId,
            questionIds: [humanQuestion.questionId],
          }, { database: db, now })).ok)
        ) {
          expect.unreachable(
            "Expected (await applyBankCollectionCommand(f.ctx, crypto.randomUUID(), { _tag: 'AddItems', collecti",
          );
        }
        const [currentTopic] = await db.select().from(enrichmentAssignments).where(
          and(
            eq(enrichmentAssignments.questionId, humanQuestion.questionId),
            eq(enrichmentAssignments.schemeId, f.schemeId),
            eq(enrichmentAssignments.dimension, 'topic'),
          ),
        );
        const humanChange = crypto.randomUUID();
        await db.insert(enrichmentChanges).values({
          id: humanChange,
          tenantId: f.ctx.tenantId,
          questionId: humanQuestion.questionId,
          revisionId: humanQuestion.revisionId,
          schemeId: f.schemeId,
          versionId: f.versionId,
          dimension: 'topic',
          value: { state: 'assigned', valueIds: ['cells'] },
          origin: 'human',
          operationId: crypto.randomUUID(),
          previousChangeId: currentTopic.changeId,
          createdBy: f.ctx.userId,
          createdAt: now(),
        });
        await db.update(enrichmentAssignments).set({ changeId: humanChange }).where(
          and(
            eq(enrichmentAssignments.questionId, humanQuestion.questionId),
            eq(enrichmentAssignments.schemeId, f.schemeId),
            eq(enrichmentAssignments.dimension, 'topic'),
          ),
        );
        await db.update(questions).set({ latestRevisionId: null }).where(
          eq(questions.id, changedQuestion.questionId),
        );
        expect(
          await db.transaction((tx) =>
            settleOrganizationAfterWorkflowTerminal(tx, {
              jobId: f.runId,
              tenantId: f.ctx.tenantId,
              executionId: initialUndo.executionId,
            })
          ),
        ).toStrictEqual({ _tag: 'Failed' });
        expect((await readRun(f.runId)).state).toStrictEqual('undo_failed');
        // Lost response to the original request cannot restart a later failure.
        if (!((await queueOrganizationUndo(db, f.ctx, command, now())).ok)) {
          expect.unreachable(
            'Expected (await queueOrganizationUndo(db, f.ctx, command, now())).ok',
          );
        }
        expect((await readRun(f.runId)).state).toStrictEqual('undo_failed');
        if (
          !((await queueOrganizationUndo(db, f.ctx, {
            runId: f.runId,
            expectedExecutionId: initialUndo.executionId,
          }, now())).ok)
        ) {
          expect.unreachable(
            'Expected (await queueOrganizationUndo(db, f.ctx, { runId: f.runId, expectedExecutionId: initialUndo',
          );
        }
        expect((await readRun(f.runId)).undoCursor).toStrictEqual(checkpoint.undoCursor);
        expect(
          await processOrganizationStep({
            jobId: f.runId,
            workflowExecutionId: initialUndo.executionId,
          }, services),
        ).toStrictEqual({ ok: false, code: 'not_found' });
        await finish(f.runId);
        expect((await readRun(f.runId)).undoProcessed).toStrictEqual(61);
        expect((await memberships(f.destinationId)).map((m) => m.questionId).sort()).toStrictEqual(
          [humanQuestion.questionId, changedQuestion.questionId].sort(),
        );
        expect((await memberships(f.originId)).length).toStrictEqual(61);
        expect(
          (await db.select().from(enrichmentAssignments).where(
            and(
              eq(enrichmentAssignments.questionId, humanQuestion.questionId),
              eq(enrichmentAssignments.dimension, 'topic'),
            ),
          ))[0].changeId,
        ).toStrictEqual(humanChange);
        const prior = await db.select().from(enrichmentChanges).where(
          and(eq(enrichmentChanges.tenantId, f.ctx.tenantId), eq(enrichmentChanges.origin, 'undo')),
        );
        if (!((await queueOrganizationUndo(db, f.ctx, command, now())).ok)) {
          expect.unreachable(
            'Expected (await queueOrganizationUndo(db, f.ctx, command, now())).ok',
          );
        }
        expect(await step(f.runId)).toStrictEqual({
          ok: true,
          value: { state: 'completed', completed: 61 },
        });
        expect(
          await db.select().from(enrichmentChanges).where(
            and(
              eq(enrichmentChanges.tenantId, f.ctx.tenantId),
              eq(enrichmentChanges.origin, 'undo'),
            ),
          ),
        ).toStrictEqual(prior);
      }, { count: 61, activation: 'disabled' });
    } finally {
      await shutdownDb();
    }
  },
);

testCase('a mid-batch undo failure rolls back changes, filing and cursor together', async () => {
  try {
    await withOrganizationWorkspace(async (f) => {
      await finish(f.runId);
      if (
        !((await queueOrganizationUndo(db, f.ctx, {
          runId: f.runId,
          expectedExecutionId: f.params.workflowExecutionId,
        }, now())).ok)
      ) {
        expect.unreachable(
          'Expected (await queueOrganizationUndo(db, f.ctx, { runId: f.runId, expectedExecutionId: f.params.wo',
        );
      }
      const [second] = await db.select().from(organizationItems).where(
        eq(organizationItems.runId, f.runId),
      ).orderBy(organizationItems.questionId).offset(1).limit(1);
      // The first question is compensated before this second question fails, inside the same transaction.
      // The question UUID comes from the test-owned database row, not user input.
      await db.execute(
        sql.raw(
          `CREATE TRIGGER fail_undo_write BEFORE INSERT ON bank_enrichment_changes FOR EACH ROW WHEN (NEW.question_id = '${second.questionId}'::uuid AND NEW.origin = 'undo') EXECUTE FUNCTION reject_enrichment_record_update()`,
        ),
      );
      try {
        const before = await readRun(f.runId);
        expect(await step(f.runId)).toStrictEqual({ ok: false, code: 'storage_failed' });
        expect(await readRun(f.runId)).toStrictEqual(before);
        expect((await memberships(f.destinationId)).length).toStrictEqual(21);
        expect(
          (await db.select().from(enrichmentChanges).where(
            and(
              eq(enrichmentChanges.tenantId, f.ctx.tenantId),
              eq(enrichmentChanges.origin, 'undo'),
            ),
          )).length,
        ).toStrictEqual(0);
      } finally {
        await db.execute(sql`DROP TRIGGER fail_undo_write ON bank_enrichment_changes`);
      }
      expect(await step(f.runId)).toStrictEqual({
        ok: true,
        value: { state: 'more', completed: 20 },
      });
      await finish(f.runId);
      expect((await memberships(f.destinationId)).length).toStrictEqual(0);
    }, { count: 21 });
  } finally {
    await shutdownDb();
  }
});

testCase(
  'undo queue failure is atomic; every batch rechecks authority and cursor cannot move backwards',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        await finish(f.runId);
        const before = await readRun(f.runId);
        await db.execute(
          sql`CREATE TRIGGER fail_undo_queue BEFORE INSERT ON workflow_dispatches FOR EACH ROW EXECUTE FUNCTION reject_enrichment_record_update()`,
        );
        try {
          expect(
            await queueOrganizationUndo(db, f.ctx, {
              runId: f.runId,
              expectedExecutionId: before.executionId,
            }, now()),
          ).toStrictEqual({ ok: false, code: 'storage_failed' });
          expect(await readRun(f.runId)).toStrictEqual(before);
        } finally {
          await db.execute(sql`DROP TRIGGER fail_undo_queue ON workflow_dispatches`);
        }
        if (
          !((await queueOrganizationUndo(db, f.ctx, {
            runId: f.runId,
            expectedExecutionId: before.executionId,
          }, now())).ok)
        ) {
          expect.unreachable(
            'Expected (await queueOrganizationUndo(db, f.ctx, { runId: f.runId, expectedExecutionId: before.exec',
          );
        }
        if (!((await step(f.runId)).ok)) expect.unreachable('Expected (await step(f.runId)).ok');
        const checkpoint = await readRun(f.runId);
        await expect(
          Promise.resolve().then(() =>
            db.update(organizationRuns).set({ undoProcessed: 0, undoCursor: null }).where(
              eq(organizationRuns.id, f.runId),
            )
          ),
        ).rejects.toBeInstanceOf(Error);
        await db.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
          eq(organizationMemberships.userId, f.ctx.userId),
        );
        expect(await step(f.runId)).toStrictEqual({ ok: false, code: 'forbidden' });
        expect(await readRun(f.runId)).toStrictEqual(checkpoint);
        expect((await memberships(f.destinationId)).length).toStrictEqual(1);
        await db.update(organizationMemberships).set({ role: 'owner' }).where(
          eq(organizationMemberships.userId, f.ctx.userId),
        );
        await finish(f.runId);
        expect((await readRun(f.runId)).state).toStrictEqual('undone');
      }, { count: 21 });
    } finally {
      await shutdownDb();
    }
  },
);

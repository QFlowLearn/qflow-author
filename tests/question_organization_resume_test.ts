import { expect, test as testCase } from 'vitest';

import { fixtureClefProvider } from './helpers/fixture_clef_provider.ts';

import { eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  organizationAttempts,
  organizationItems,
  organizationRuns,
} from '../lib/db/question_organization_schema.ts';
import { workflowDispatches } from '../lib/db/workflow_canvas_schema.ts';
import { organizationMemberships } from '../lib/db/principal_schema.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { questions } from '../lib/db/question_schema.ts';
import {
  type OrganizationWorkerServices,
  processOrganizationStep,
} from '../lib/services/question_organization_processor.ts';
import { resumeOrganizationRun } from '../lib/services/question_organization_resume.ts';
import { cancelOrganizationRun } from '../lib/services/question_organization_cancel.ts';
import { completeOrganizationUndoForTest } from './helpers/organization_undo.ts';
import { settleOrganizationAfterWorkflowTerminal } from '../lib/services/question_organization_settlement.ts';
import { QuestionOrganizationWorkspace } from '../lib/services/question_organization_workspace.ts';
import {
  organizationNow as now,
  withOrganizationWorkspace,
} from './helpers/organization_workspace.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';

const receipt = {
  topicId: 'cells',
  confidence: 0.9,
  probabilities: { cells: 0.9, energy: 0.05, __no_match__: 0.05 },
  model: 'clef',
  inputTokens: 100,
  outputTokens: 20,
};
const base: OrganizationWorkerServices = {
  database: db,
  now,
  newId: () => crypto.randomUUID(),
  provider: () => fixtureClefProvider(() => Promise.resolve({ ok: true, value: receipt })),
};
const readRun = async (id: string) =>
  (await db.select().from(organizationRuns).where(eq(organizationRuns.id, id)))[0];
const invocation = async (id: string) => ({
  jobId: id,
  workflowExecutionId: (await readRun(id)).executionId,
});

testCase(
  'resume migration permits only stopped execution replacement and keeps run inputs immutable',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        for (
          const change of [
            { executionId: crypto.randomUUID() },
            { mode: 'preview' as const },
            { createdBy: crypto.randomUUID() },
          ]
        ) {
          await expect(
            Promise.resolve().then(() =>
              db.update(organizationRuns).set(change).where(eq(organizationRuns.id, f.runId))
            ),
          ).rejects.toBeInstanceOf(Error);
        }
        if (!((await cancelOrganizationRun(db, f.ctx, f.runId)).ok)) {
          expect.unreachable('Expected (await cancelOrganizationRun(db, f.ctx, f.runId)).ok');
        }
        await expect(
          Promise.resolve().then(() =>
            db.update(organizationRuns).set({
              executionId: crypto.randomUUID(),
              state: 'queued',
              reservedMicros: 1,
            }).where(eq(organizationRuns.id, f.runId))
          ),
        ).rejects.toBeInstanceOf(Error);
        const results = await Promise.all([
          resumeOrganizationRun(db, f.ctx, f.runId, f.params.workflowExecutionId, now()),
          resumeOrganizationRun(db, f.ctx, f.runId, f.params.workflowExecutionId, now()),
        ]);
        expect(results).toStrictEqual([{ ok: true, value: f.runId }, { ok: true, value: f.runId }]);
        expect(
          (await db.select().from(workflowDispatches).where(eq(workflowDispatches.jobId, f.runId)))
            .length,
        ).toStrictEqual(2);
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'resume preserves completed work, frozen revisions and saved decisions; replay cannot restart a later cancellation',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        let calls = 0;
        const services: OrganizationWorkerServices = {
          ...base,
          provider: () =>
            fixtureClefProvider(() => {
              calls++;
              return Promise.resolve({ ok: true, value: receipt });
            }),
        };
        if (!((await processOrganizationStep(f.params, services)).ok)) {
          expect.unreachable('Expected (await processOrganizationStep(f.params, services)).ok');
        }
        expect(calls).toStrictEqual(20);
        const before = await db.select().from(organizationItems).where(
          eq(organizationItems.runId, f.runId),
        );
        const pending = before.filter((i) => i.state === 'pending');
        expect(pending.length).toStrictEqual(2);
        await db.update(organizationItems).set({
          state: 'received',
          decision: { kind: 'clef', receipt },
        })
          .where(
            sql`${organizationItems.runId} = ${f.runId} AND ${organizationItems.questionId} = ${
              pending[0].questionId
            }`,
          );
        if (!((await cancelOrganizationRun(db, f.ctx, f.runId)).ok)) {
          expect.unreachable('Expected (await cancelOrganizationRun(db, f.ctx, f.runId)).ok');
        }
        const spent = (await readRun(f.runId)).reservedMicros;
        const result = await resumeOrganizationRun(
          db,
          f.ctx,
          f.runId,
          f.params.workflowExecutionId,
          now(),
        );
        expect(result).toStrictEqual({ ok: true, value: f.runId });
        const resumed = await readRun(f.runId);
        if (!(resumed.executionId !== f.params.workflowExecutionId)) {
          expect.unreachable('Expected resumed.executionId !== f.params.workflowExecutionId');
        }
        expect(resumed.reservedMicros).toStrictEqual(spent);
        expect(await resumeOrganizationRun(db, f.ctx, f.runId, f.params.workflowExecutionId, now()))
          .toStrictEqual(result);
        expect(
          (await db.select().from(workflowDispatches).where(eq(workflowDispatches.jobId, f.runId)))
            .length,
        ).toStrictEqual(2);
        expect(await processOrganizationStep(f.params, services)).toStrictEqual({
          ok: false,
          code: 'not_found',
        });
        if (!((await cancelOrganizationRun(db, f.ctx, f.runId)).ok)) {
          expect.unreachable('Expected (await cancelOrganizationRun(db, f.ctx, f.runId)).ok');
        }
        expect(await resumeOrganizationRun(db, f.ctx, f.runId, f.params.workflowExecutionId, now()))
          .toStrictEqual(result);
        expect((await readRun(f.runId)).state).toStrictEqual('cancelled');
        if (!((await resumeOrganizationRun(db, f.ctx, f.runId, resumed.executionId, now())).ok)) {
          expect.unreachable(
            'Expected (await resumeOrganizationRun(db, f.ctx, f.runId, resumed.executionId, now())).ok',
          );
        }
        // A question edited while stopped must not receive its frozen classification.
        await db.update(questions).set({ latestRevisionId: null }).where(
          eq(questions.id, pending[1].questionId),
        );
        expect(await processOrganizationStep(await invocation(f.runId), services)).toStrictEqual({
          ok: true,
          value: { state: 'completed', completed: 22 },
        });
        expect(calls, 'The saved receipt and changed revision require no new inference')
          .toStrictEqual(20);
        const after = await db.select().from(organizationItems).where(
          eq(organizationItems.runId, f.runId),
        );
        for (const completed of before.filter((i) => i.state === 'applied')) {
          expect(after.find((i) => i.questionId === completed.questionId)).toStrictEqual(completed);
        }
        expect(after.find((i) => i.questionId === pending[1].questionId)?.state).toStrictEqual(
          'outdated',
        );
        expect(
          (await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, f.destinationId),
          )).length,
        ).toStrictEqual(21);
        if (!((await completeOrganizationUndoForTest(db, f.ctx, f.runId, now())).ok)) {
          expect.unreachable(
            'Expected (await completeOrganizationUndoForTest(db, f.ctx, f.runId, now())).ok',
          );
        }
        expect(
          (await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, f.destinationId),
          )).length,
        ).toStrictEqual(0);
        expect(
          await resumeOrganizationRun(
            db,
            f.ctx,
            f.runId,
            (await readRun(f.runId)).executionId,
            now(),
          ),
        ).toStrictEqual({ ok: false, code: 'conflict' });
      }, { clef: true, count: 22 });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'resume fences a response still in flight and retains its uncertain spending reservation',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const services: OrganizationWorkerServices = {
          ...base,
          provider: () =>
            fixtureClefProvider(async () => {
              if (!((await cancelOrganizationRun(db, f.ctx, f.runId)).ok)) {
                expect.unreachable('Expected (await cancelOrganizationRun(db, f.ctx, f.runId)).ok');
              }
              if (
                !((await resumeOrganizationRun(
                  db,
                  f.ctx,
                  f.runId,
                  f.params.workflowExecutionId,
                  now(),
                ))
                  .ok)
              ) {
                expect.unreachable(
                  'Expected (await resumeOrganizationRun( db, f.ctx, f.runId, f.params.workflowExecutionId, now(), )) ',
                );
              }
              return { ok: true, value: receipt };
            }),
        };
        expect(await processOrganizationStep(f.params, services)).toStrictEqual({
          ok: false,
          code: 'not_found',
        });
        const [item] = await db.select().from(organizationItems).where(
          eq(organizationItems.runId, f.runId),
        );
        expect([item.state, item.decision, item.attempts]).toStrictEqual(['pending', null, 0]);
        expect((await readRun(f.runId)).reservedMicros).toStrictEqual(7680);
        expect(await processOrganizationStep(await invocation(f.runId), base)).toStrictEqual({
          ok: true,
          value: { state: 'completed', completed: 1 },
        });
        expect((await readRun(f.runId)).reservedMicros).toStrictEqual(7704);
        expect(
          (await db.select().from(organizationAttempts).where(
            eq(organizationAttempts.runId, f.runId),
          )).length,
        ).toStrictEqual(2);
      }, { clef: true, count: 1 });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'explicit retry permits bounded new attempts without forgiving earlier charges or exceeding the cap',
  async () => {
    try {
      for (const budgetMicros of [7680, 60000]) {
        await withOrganizationWorkspace(async (f) => {
          const failing: OrganizationWorkerServices = {
            ...base,
            provider: () =>
              fixtureClefProvider(() => Promise.resolve({ ok: false, code: 'provider_failed' })),
          };
          for (let step = 0; step < 3; step++) await processOrganizationStep(f.params, failing);
          const before = await readRun(f.runId);
          expect(before.state).toStrictEqual('failed');
          const workspace = new QuestionOrganizationWorkspace(db, now);
          const progress = await workspace.run(f.ctx, f.runId);
          if (!(progress.ok)) expect.unreachable('Expected progress.ok');
          expect(progress.value.recovery).toStrictEqual(
            budgetMicros === 7680 ? { count: 0, budgetBlocked: 1 } : { count: 1, budgetBlocked: 0 },
          );
          const result = await resumeOrganizationRun(db, f.ctx, f.runId, before.executionId, now());
          if (budgetMicros === 7680) {
            expect(result).toStrictEqual({ ok: false, code: 'conflict' });
            expect(await readRun(f.runId)).toStrictEqual(before);
          } else {
            if (!(result.ok)) expect.unreachable('Expected result.ok');
            expect((await readRun(f.runId)).reservedMicros).toStrictEqual(23040);
            if (!((await processOrganizationStep(await invocation(f.runId), base)).ok)) {
              expect.unreachable(
                'Expected (await processOrganizationStep(await invocation(f.runId), base)).ok',
              );
            }
            expect((await readRun(f.runId)).reservedMicros).toStrictEqual(23064);
            expect(
              (await db.select().from(organizationAttempts).where(
                eq(organizationAttempts.runId, f.runId),
              )).length,
            ).toStrictEqual(4);
          }
        }, { clef: true, count: 1, budgetMicros });
      }
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'failed workflows resume saved receipts even at the spend cap; old settlement cannot fail the new execution',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        await db.update(organizationItems).set({
          state: 'received',
          decision: { kind: 'clef', receipt },
        }).where(eq(organizationItems.runId, f.runId));
        await db.update(organizationRuns).set({ reservedMicros: 7680 }).where(
          eq(organizationRuns.id, f.runId),
        );
        expect(
          await db.transaction((tx) =>
            settleOrganizationAfterWorkflowTerminal(tx, {
              jobId: f.runId,
              tenantId: f.ctx.tenantId,
              executionId: f.params.workflowExecutionId,
            })
          ),
        ).toStrictEqual({ _tag: 'Failed' });
        if (
          !((await resumeOrganizationRun(db, f.ctx, f.runId, f.params.workflowExecutionId, now()))
            .ok)
        ) {
          expect.unreachable(
            'Expected (await resumeOrganizationRun(db, f.ctx, f.runId, f.params.workflowExecutionId, now())).ok',
          );
        }
        expect(
          await db.transaction((tx) =>
            settleOrganizationAfterWorkflowTerminal(tx, {
              jobId: f.runId,
              tenantId: f.ctx.tenantId,
              executionId: f.params.workflowExecutionId,
            })
          ),
        ).toStrictEqual({ _tag: 'AlreadyFailed' });
        expect(
          await processOrganizationStep(await invocation(f.runId), {
            ...base,
            provider: () => {
              throw new Error('Receipt must be reused');
            },
          }),
        ).toStrictEqual({ ok: true, value: { state: 'completed', completed: 1 } });
        expect((await readRun(f.runId)).reservedMicros).toStrictEqual(7680);
      }, { clef: true, count: 1, budgetMicros: 7680 });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'resume checks tenant authority, rejects stale input, and rolls back when its outbox cannot commit',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        if (!((await cancelOrganizationRun(db, f.ctx, f.runId)).ok)) {
          expect.unreachable('Expected (await cancelOrganizationRun(db, f.ctx, f.runId)).ok');
        }
        await withEnrichmentWorkspace(async (other) => {
          expect(
            await resumeOrganizationRun(db, other, f.runId, f.params.workflowExecutionId, now()),
          ).toStrictEqual({ ok: false, code: 'not_found' });
        });
        expect(await resumeOrganizationRun(db, f.ctx, f.runId, crypto.randomUUID(), now()))
          .toStrictEqual({
            ok: false,
            code: 'conflict',
          });
        expect(await resumeOrganizationRun(db, f.ctx, f.runId, 'invalid', now())).toStrictEqual({
          ok: false,
          code: 'invalid_input',
        });
        const before = await readRun(f.runId);
        await db.execute(
          sql`CREATE FUNCTION reject_resume_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'question_organization' THEN RAISE EXCEPTION 'test outbox failure'; END IF; RETURN NEW; END; $$`,
        );
        await db.execute(
          sql`CREATE TRIGGER reject_resume_dispatch BEFORE INSERT ON workflow_dispatches FOR EACH ROW EXECUTE FUNCTION reject_resume_dispatch()`,
        );
        try {
          expect(
            await resumeOrganizationRun(db, f.ctx, f.runId, f.params.workflowExecutionId, now()),
          ).toStrictEqual({ ok: false, code: 'storage_failed' });
          expect(await readRun(f.runId)).toStrictEqual(before);
          if (
            !((await db.select().from(organizationItems).where(
              eq(organizationItems.runId, f.runId),
            ))
              .every((i) => i.state === 'cancelled'))
          ) {
            expect.unreachable(
              'Expected (await db.select().from(organizationItems).where(eq(organizationItems.runId, f.runId))) .e',
            );
          }
        } finally {
          await db.execute(sql`DROP TRIGGER reject_resume_dispatch ON workflow_dispatches`);
          await db.execute(sql`DROP FUNCTION reject_resume_dispatch()`);
        }
        await db.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
          eq(organizationMemberships.userId, f.ctx.userId),
        );
        expect(await resumeOrganizationRun(db, f.ctx, f.runId, f.params.workflowExecutionId, now()))
          .toStrictEqual({ ok: false, code: 'forbidden' });
      });
    } finally {
      await shutdownDb();
    }
  },
);

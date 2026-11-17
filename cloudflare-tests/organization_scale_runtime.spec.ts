import { env } from 'cloudflare:workers';
import { introspectWorkflowInstance } from 'cloudflare:test';
import { and, count, eq, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { db, withHyperdriveDatabase } from '../lib/db.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { enrichmentAssignments, enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import {
  organizationItems,
  organizationOrigins,
  organizationRuns,
} from '../lib/db/question_organization_schema.ts';
import { questions, workflowDispatches } from '../lib/db/schema.ts';
import {
  enqueueMigrationCommit,
  processMigrationCommitBatch,
} from '../lib/import/migration_commit_job.ts';
import { runWithRequestRuntime } from '../lib/server/request_runtime_context.ts';
import { cancelOrganizationRun } from '../lib/services/question_organization_cancel.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { resumeOrganizationRun } from '../lib/services/question_organization_resume.ts';
import { settleOrganizationAfterWorkflowTerminal } from '../lib/services/question_organization_settlement.ts';
import { queueOrganizationUndo } from '../lib/services/question_organization_undo.ts';
import { resolveStorage } from '../lib/storage.ts';
import { dispatchPendingWorkflowJobs } from '../lib/workflows/workflow_dispatch.ts';
import {
  scaleQuestionCount,
  withOrganizationScaleImport,
} from './helpers/organization_scale_fixture.ts';

// SAFETY: both bindings are real Workflow classes in wrangler.workflow-test.jsonc.
const bindings = env;

async function completeWorkflow(
  binding: typeof bindings.QFLOW_QUESTION_ORGANIZATION_WORKFLOW,
  run: { id: string; executionId: string; tenantId: string },
) {
  const instance = await introspectWorkflowInstance(binding, run.executionId);
  try {
    expect(
      (await dispatchPendingWorkflowJobs({ bindings }, {
        jobIds: [run.id],
        tenantId: run.tenantId,
      })).ok,
    ).toBe(true);
    await instance.waitForStatus('complete');
    expect(await instance.getOutput()).toEqual({ _tag: 'Completed', jobId: run.id, attempts: 1 });
    expect(
      (await dispatchPendingWorkflowJobs({ bindings }, {
        jobIds: [run.id],
        tenantId: run.tenantId,
      })).ok,
    ).toBe(true);
  } finally {
    await instance.dispose();
  }
}

function checkpoint(run: { id: string; executionId: string }) {
  return withHyperdriveDatabase({ bindings }, (database) =>
    processOrganizationStep({
      jobId: run.id,
      workflowExecutionId: run.executionId,
    }, {
      database,
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
      provider: () => {
        throw new Error('Source mapping and undo must not call AI');
      },
    }));
}

function currentTopics(tenantId: string) {
  return db.select({ value: enrichmentChanges.value, total: count() })
    .from(enrichmentAssignments).innerJoin(
      enrichmentChanges,
      eq(enrichmentChanges.id, enrichmentAssignments.changeId),
    )
    .where(
      and(
        eq(enrichmentAssignments.tenantId, tenantId),
        eq(enrichmentAssignments.dimension, 'topic'),
      ),
    )
    .groupBy(enrichmentChanges.value);
}

it('keeps an established Hyperdrive connection usable beyond its connection deadline', async () => {
  await withHyperdriveDatabase({ bindings }, async (database) => {
    await database.execute(sql`select pg_sleep(31)`);
    expect(await database.execute(sql`select 1 as alive`)).toEqual([{ alive: 1 }]);
  });
}, 45_000);

it(
  'recovers a committed 10,000-question import before dispatch, then resumes organization and undo',
  () =>
    runWithRequestRuntime({ bindings }, async () => {
      const storage = resolveStorage({ bindings });
      await withOrganizationScaleImport(storage, async (f) => {
        await enqueueMigrationCommit(f.ctx, f.runId, f.approvedIds, true);
        const [commit] = await db.select().from(workflowDispatches).where(and(
          eq(workflowDispatches.jobId, f.runId),
          eq(workflowDispatches.kind, 'migration_commit'),
        ));
        await completeWorkflow(bindings.QFLOW_MIGRATION_COMMIT_WORKFLOW, {
          id: f.runId,
          executionId: commit.id,
          tenantId: f.ctx.tenantId,
        });

        // Simulate loss of the publisher after commit and before any organization dispatch.
        // A fresh Hyperdrive client can recover every frozen job from PostgreSQL alone.
        const pending = await withHyperdriveDatabase({ bindings }, (database) =>
          database.select().from(organizationRuns).where(
            eq(organizationRuns.tenantId, f.ctx.tenantId),
          ));
        expect(pending).toHaveLength(20);
        expect(pending.every((run) =>
          run.state === 'queued'
        )).toBe(true);
        const frozen = await db.select().from(organizationItems).where(
          eq(organizationItems.tenantId, f.ctx.tenantId),
        );
        expect(frozen).toHaveLength(scaleQuestionCount);
        expect(
          new Set(frozen.map((item) => item.questionId)).size,
        ).toBe(scaleQuestionCount);
        expect(frozen.every((item) => item.state === 'pending')).toBe(true);
        expect(
          await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, f.destinationId),
          ),
        ).toHaveLength(0);
        const outbox = await db.select().from(workflowDispatches).where(and(
          eq(workflowDispatches.tenantId, f.ctx.tenantId),
          eq(workflowDispatches.kind, 'question_organization'),
        ));
        expect(outbox).toHaveLength(20);
        expect(outbox.every((dispatch) => dispatch.state === 'pending')).toBe(true);
        const published = await db.select({
          id: questions.id,
          revision: questions.latestRevisionId,
        }).from(questions)
          .where(eq(questions.tenantId, f.ctx.tenantId)).orderBy(questions.id);
        expect(published).toHaveLength(scaleQuestionCount);
        expect(
          await db.select().from(organizationOrigins).where(
            eq(organizationOrigins.tenantId, f.ctx.tenantId),
          ),
        ).toHaveLength(scaleQuestionCount);

        // Lost commit responses and repeated delivery must not create new jobs or identities.
        await enqueueMigrationCommit(f.ctx, f.runId, f.approvedIds, true);
        expect(await processMigrationCommitBatch(f.runId, { database: db, storage })).toEqual({
          complete: true,
          completed: scaleQuestionCount,
        });
        expect(
          await db.select().from(organizationRuns).where(
            eq(organizationRuns.tenantId, f.ctx.tenantId),
          ),
        ).toEqual(pending);

        const first = pending[0];
        expect((await checkpoint(first)).ok).toBe(true);
        const receipt = await db.select().from(organizationItems).where(and(
          eq(organizationItems.runId, first.id),
          eq(organizationItems.state, 'applied'),
        )).orderBy(organizationItems.questionId);
        expect(receipt).toHaveLength(20);
        expect((await cancelOrganizationRun(db, f.ctx, first.id)).ok).toBe(true);
        expect((await resumeOrganizationRun(db, f.ctx, first.id, first.executionId, new Date())).ok)
          .toBe(true);
        const runs = await db.select().from(organizationRuns).where(
          eq(organizationRuns.tenantId, f.ctx.tenantId),
        );
        for (const run of runs) {
          await completeWorkflow(bindings.QFLOW_QUESTION_ORGANIZATION_WORKFLOW, run);
        }
        expect(
          await db.select().from(organizationItems).where(and(
            eq(organizationItems.runId, first.id),
            eq(organizationItems.state, 'applied'),
          )).orderBy(organizationItems.questionId).limit(20),
        ).toEqual(receipt);
        expect(
          await db.select({ total: count() }).from(organizationItems).where(and(
            eq(organizationItems.tenantId, f.ctx.tenantId),
            eq(organizationItems.state, 'applied'),
          )),
        ).toEqual([{ total: scaleQuestionCount }]);
        expect(await currentTopics(f.ctx.tenantId)).toEqual([{
          value: { state: 'assigned', valueIds: ['cells'] },
          total: scaleQuestionCount,
        }]);
        expect(
          await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, f.destinationId),
          ),
        ).toHaveLength(scaleQuestionCount);

        for (const [index, run] of runs.entries()) {
          expect(
            (await queueOrganizationUndo(db, f.ctx, {
              runId: run.id,
              expectedExecutionId: run.executionId,
            }, new Date())).ok,
          ).toBe(true);
          let [undo] = await db.select().from(organizationRuns).where(
            eq(organizationRuns.id, run.id),
          );
          if (index === 0) {
            expect(await checkpoint(undo)).toEqual({
              ok: true,
              value: { state: 'more', completed: 20 },
            });
            expect(
              await db.transaction((tx) =>
                settleOrganizationAfterWorkflowTerminal(tx, {
                  jobId: undo.id,
                  tenantId: f.ctx.tenantId,
                  executionId: undo.executionId,
                })
              ),
            ).toEqual({ _tag: 'Failed' });
            expect(
              (await queueOrganizationUndo(db, f.ctx, {
                runId: undo.id,
                expectedExecutionId: undo.executionId,
              }, new Date())).ok,
            ).toBe(true);
            [undo] = await db.select().from(organizationRuns).where(
              eq(organizationRuns.id, run.id),
            );
            expect(undo.undoProcessed).toBe(20);
          }
          await completeWorkflow(bindings.QFLOW_QUESTION_ORGANIZATION_WORKFLOW, undo);
        }
        const undone = await db.select().from(organizationRuns).where(
          eq(organizationRuns.tenantId, f.ctx.tenantId),
        );
        expect(undone.every((run) => run.state === 'undone' && run.reservedMicros === 0)).toBe(
          true,
        );
        expect(undone.reduce((sum, run) => sum + run.undoProcessed, 0)).toBe(scaleQuestionCount);
        expect(await currentTopics(f.ctx.tenantId)).toEqual([{
          value: { state: 'absent' },
          total: scaleQuestionCount,
        }]);
        expect(
          await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, f.destinationId),
          ),
        ).toHaveLength(0);
        expect(
          await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, f.originId),
          ),
        ).toHaveLength(scaleQuestionCount);
        expect(
          await db.select({ id: questions.id, revision: questions.latestRevisionId }).from(
            questions,
          )
            .where(eq(questions.tenantId, f.ctx.tenantId)).orderBy(questions.id),
        ).toEqual(published);
      });
    }),
  480_000,
);

import { fixtureClefProvider } from '../tests/helpers/fixture_clef_provider.ts';
import { organizationNow } from '../tests/helpers/organization_workspace.ts';
import { QuestionOrganizationWorkspace } from '../lib/services/question_organization_workspace.ts';
import {
  parsePreviewTeachingCommand,
  teachOrganizationPreview,
} from '../lib/services/question_organization_preview_teaching.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import { organizationActivation } from '../lib/db/question_organization_schema.ts';
import { env } from 'cloudflare:workers';
import { introspectWorkflowInstance } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { dispatchWorkflowOutbox } from '../deploy/cloudflare/workflows.entry.ts';
import { getDb, withHyperdriveDatabase } from '../lib/db.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { organizationItems, organizationRuns } from '../lib/db/question_organization_schema.ts';
import { workflowDispatches } from '../lib/db/workflow_canvas_schema.ts';
import { cancelOrganizationRun } from '../lib/services/question_organization_cancel.ts';
import { queueOrganizationUndo } from '../lib/services/question_organization_undo.ts';
import { settleOrganizationAfterWorkflowTerminal } from '../lib/services/question_organization_settlement.ts';
import { resumeOrganizationRun } from '../lib/services/question_organization_resume.ts';
import { withOrganizationWorkspace } from '../tests/helpers/organization_workspace.ts';

// SAFETY: the local Wrangler configuration declares this Workflow binding.
const bindings = env;

it(
  'dispatches committed source mappings and recovers saved Clef receipts through Workflow and Hyperdrive',
  async () => {
    const database = getDb({ bindings });
    for (const clef of [false, true]) {
      await withOrganizationWorkspace(
        async (f) => {
          if (clef) {
            // Simulate a worker disappearing after receiving Clef but before applying anything.
            // There is no AI binding: this test must recover every receipt without inference.
            await database.update(organizationItems).set({
              state: 'received',
              decision: {
                kind: 'clef',
                receipt: {
                  topicId: 'cells',
                  confidence: 0.9,
                  probabilities: { cells: 0.9, energy: 0.05, __no_match__: 0.05 },
                  model: 'clef',
                  inputTokens: 700,
                  outputTokens: 20,
                },
              },
              leaseToken: crypto.randomUUID(),
              leaseExpiresAt: new Date(0),
            }).where(eq(organizationItems.runId, f.runId));
          }
          const instance = await introspectWorkflowInstance(
            bindings.QFLOW_QUESTION_ORGANIZATION_WORKFLOW,
            f.params.workflowExecutionId,
          );
          try {
            // Only the transactional outbox starts work; the publisher has already returned.
            expect((await dispatchWorkflowOutbox(bindings)).ok).toBe(true);
            await instance.waitForStatus('complete');
            expect((await dispatchWorkflowOutbox(bindings)).ok).toBe(true);
            expect(await instance.getOutput()).toEqual({
              _tag: 'Completed',
              jobId: f.runId,
              attempts: 1,
            });
            expect(
              await database.select({ state: organizationRuns.state }).from(organizationRuns)
                .where(eq(organizationRuns.id, f.runId)),
            ).toEqual([{ state: 'completed' }]);
            expect(
              await database.select({ state: workflowDispatches.state }).from(workflowDispatches)
                .where(eq(workflowDispatches.id, f.params.workflowExecutionId)),
            )
              .toEqual([{ state: 'complete' }]);
            expect(
              await database.select().from(bankCollectionItems)
                .where(eq(bankCollectionItems.collectionId, f.destinationId)),
            ).toHaveLength(3);
            expect(
              (await queueOrganizationUndo(database, f.ctx, {
                runId: f.runId,
                expectedExecutionId: f.params.workflowExecutionId,
              }, new Date())).ok,
            ).toBe(true);
            const [undo] = await database.select().from(organizationRuns).where(
              eq(organizationRuns.id, f.runId),
            );
            const undoInstance = await introspectWorkflowInstance(
              bindings.QFLOW_QUESTION_ORGANIZATION_WORKFLOW,
              undo.executionId,
            );
            try {
              expect((await dispatchWorkflowOutbox(bindings)).ok).toBe(true);
              await undoInstance.waitForStatus('complete');
              expect(
                (await database.select().from(organizationRuns).where(
                  eq(organizationRuns.id, f.runId),
                ))[0].state,
              ).toBe('undone');
            } finally {
              await undoInstance.dispose();
            }
            expect(
              await database.select().from(bankCollectionItems)
                .where(eq(bankCollectionItems.collectionId, f.destinationId)),
            ).toHaveLength(0);
          } finally {
            await instance.dispose();
          }
        },
        { clef },
        database,
      );
    }
  },
  30_000,
);

it('persists preview lessons and their outbox atomically through Hyperdrive without changing assignments', async () => {
  const database = getDb({ bindings });
  await withOrganizationWorkspace(
    async (f) => {
      const workspace = new QuestionOrganizationWorkspace(database, organizationNow);
      const preview = await workspace.queue(f.ctx, {
        id: crypto.randomUUID(),
        setupId: f.setupId,
        mode: 'preview',
      });
      if (!preview.ok) throw new Error('Preview fixture failed');
      const [run] = await database.select().from(organizationRuns).where(
        eq(organizationRuns.id, preview.value),
      );
      for (let step = 0; step < 30; step++) {
        const completed = await processOrganizationStep({
          jobId: preview.value,
          workflowExecutionId: run.executionId,
        }, {
          database,
          now: organizationNow,
          newId: () => crypto.randomUUID(),
          provider: () =>
            fixtureClefProvider(() =>
              Promise.resolve({
                ok: true,
                value: {
                  topicId: 'cells',
                  confidence: 0.9,
                  probabilities: { cells: 0.9, energy: 0.05, __no_match__: 0.05 },
                  model: 'clef',
                  inputTokens: 700,
                  outputTokens: 20,
                },
              })
            ),
        });
        expect(completed.ok).toBe(true);
        if (!completed.ok) throw new Error('Preview processing failed');
        if (completed.value.state === 'completed') break;
        expect(completed.value.state).toBe('more');
        expect(step).toBeLessThan(29);
      }
      const view = await workspace.run(f.ctx, preview.value);
      if (!view.ok) throw new Error('Missing preview');
      expect(view.value.sample).toHaveLength(20);
      expect(view.value.counts.reduce((total, c) => total + c.count, 0)).toBe(100);
      const sample = view.value.sample[0];
      const command = parsePreviewTeachingCommand({
        operationId: crypto.randomUUID(),
        corrections: [{
          questionId: sample.questionId,
          revisionId: sample.revisionId,
          topicId: 'energy',
        }],
      });
      if (!command) throw new Error('Invalid test lesson');
      const taught = await teachOrganizationPreview(
        database,
        f.ctx,
        preview.value,
        command,
        organizationNow(),
      );
      expect(taught).toEqual({ ok: true, value: command.operationId });
      expect(
        await teachOrganizationPreview(database, f.ctx, preview.value, command, organizationNow()),
      ).toEqual(taught);
      const next = await workspace.run(f.ctx, command.operationId);
      if (!next.ok) throw new Error('Missing corrected preview');
      expect(next.value.definition.examples[0].classification.topic).toEqual({
        state: 'assigned',
        valueIds: ['energy'],
      });
      expect(next.value.definition.examples[0].classification.difficulty).toBe(null);
      expect(
        await database.select().from(enrichmentChanges).where(
          eq(enrichmentChanges.tenantId, f.ctx.tenantId),
        ),
      ).toHaveLength(0);
      expect(
        await database.select().from(organizationActivation).where(
          eq(organizationActivation.tenantId, f.ctx.tenantId),
        ),
      ).toHaveLength(0);
      expect(
        await database.select().from(workflowDispatches).where(
          eq(workflowDispatches.jobId, command.operationId),
        ),
      ).toHaveLength(1);
    },
    { clef: true, activation: 'disabled', difficulty: 'none', count: 105 },
    database,
  );
});

it(
  'resumes a stopped 500-question workflow and releases Hyperdrive step clients on success and failure',
  async () => {
    const database = getDb({ bindings });
    const successfulPid = await withHyperdriveDatabase({ bindings }, async (stepDb) => {
      const result = await stepDb.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      return result[0].pid;
    });
    let failedPid = 0;
    await expect(withHyperdriveDatabase({ bindings }, async (stepDb) => {
      const result = await stepDb.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      failedPid = result[0].pid;
      throw new Error('intentional step failure');
    })).rejects.toThrow('intentional step failure');
    expect(
      await database.execute(
        sql`select pid from pg_stat_activity where pid in (${successfulPid}, ${failedPid})`,
      ),
    ).toHaveLength(0);
    const before = await database.execute<{ total: number }>(
      sql`select count(*)::int as total from pg_stat_activity where datname = current_database()`,
    );
    await withOrganizationWorkspace(
      async (f) => {
        for (let step = 0; step < 13; step++) {
          const result = await withHyperdriveDatabase(
            { bindings },
            (stepDb) =>
              processOrganizationStep(f.params, {
                database: stepDb,
                now: organizationNow,
                newId: () => crypto.randomUUID(),
                provider: () => {
                  throw new Error('Source rules must not use AI');
                },
              }),
          );
          expect(result.ok).toBe(true);
        }
        const completedBeforeStop = await database.select().from(organizationItems).where(
          sql`${organizationItems.runId} = ${f.runId} AND ${organizationItems.state} = 'applied'`,
        ).orderBy(organizationItems.questionId);
        expect(completedBeforeStop).toHaveLength(260);
        expect((await cancelOrganizationRun(database, f.ctx, f.runId)).ok).toBe(true);
        expect(
          (await resumeOrganizationRun(
            database,
            f.ctx,
            f.runId,
            f.params.workflowExecutionId,
            organizationNow(),
          )).ok,
        ).toBe(true);
        const [resumed] = await database.select().from(organizationRuns).where(
          eq(organizationRuns.id, f.runId),
        );
        const instance = await introspectWorkflowInstance(
          bindings.QFLOW_QUESTION_ORGANIZATION_WORKFLOW,
          resumed.executionId,
        );
        try {
          expect((await dispatchWorkflowOutbox(bindings)).ok).toBe(true);
          await instance.waitForStatus('complete');
          expect(await instance.getOutput()).toEqual({
            _tag: 'Completed',
            jobId: f.runId,
            attempts: 1,
          });
          expect(
            await database.select().from(bankCollectionItems).where(
              eq(bankCollectionItems.collectionId, f.destinationId),
            ),
          ).toHaveLength(500);
          const completedAfterResume = await database.select().from(organizationItems).where(
            eq(organizationItems.runId, f.runId),
          ).orderBy(organizationItems.questionId);
          expect(completedAfterResume.slice(0, 260)).toEqual(completedBeforeStop);
          const after = await database.execute<{ total: number }>(
            sql`select count(*)::int as total from pg_stat_activity where datname = current_database()`,
          );
          // The dispatcher can own a small request pool; 125 durable steps must not retain 125 clients.
          expect(after[0].total - before[0].total).toBeLessThanOrEqual(10);
          expect(
            (await queueOrganizationUndo(database, f.ctx, {
              runId: f.runId,
              expectedExecutionId: resumed.executionId,
            }, organizationNow())).ok,
          ).toBe(true);
          const [undo] = await database.select().from(organizationRuns).where(
            eq(organizationRuns.id, f.runId),
          );
          for (let batch = 0; batch < 2; batch++) {
            const result = await withHyperdriveDatabase(
              { bindings },
              (stepDb) =>
                processOrganizationStep({
                  jobId: f.runId,
                  workflowExecutionId: undo.executionId,
                }, {
                  database: stepDb,
                  now: organizationNow,
                  newId: () => crypto.randomUUID(),
                  provider: () => {
                    throw new Error('Undo must not use AI');
                  },
                }),
            );
            expect(result).toEqual({
              ok: true,
              value: { state: 'more', completed: (batch + 1) * 20 },
            });
          }
          expect(
            await database.transaction((tx) =>
              settleOrganizationAfterWorkflowTerminal(tx, {
                jobId: f.runId,
                tenantId: f.ctx.tenantId,
                executionId: undo.executionId,
              })
            ),
          ).toEqual({ _tag: 'Failed' });
          expect(
            (await queueOrganizationUndo(database, f.ctx, {
              runId: f.runId,
              expectedExecutionId: undo.executionId,
            }, organizationNow())).ok,
          ).toBe(true);
          const [continued] = await database.select().from(organizationRuns).where(
            eq(organizationRuns.id, f.runId),
          );
          expect(continued.undoProcessed).toBe(40);
          const undoInstance = await introspectWorkflowInstance(
            bindings.QFLOW_QUESTION_ORGANIZATION_WORKFLOW,
            continued.executionId,
          );
          try {
            expect((await dispatchWorkflowOutbox(bindings)).ok).toBe(true);
            await undoInstance.waitForStatus('complete');
            const [done] = await database.select().from(organizationRuns).where(
              eq(organizationRuns.id, f.runId),
            );
            expect([done.state, done.undoProcessed]).toEqual(['undone', 500]);
            expect(
              await database.select().from(bankCollectionItems).where(
                eq(bankCollectionItems.collectionId, f.destinationId),
              ),
            ).toHaveLength(0);
          } finally {
            await undoInstance.dispose();
          }
        } finally {
          await instance.dispose();
        }
      },
      { count: 500 },
      database,
    );
  },
  60_000,
);

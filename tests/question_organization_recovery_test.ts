import { expect, test as testCase } from 'vitest';

import { fixtureClefProvider } from './helpers/fixture_clef_provider.ts';

import { eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  organizationAttempts,
  organizationItems,
  organizationRuns,
} from '../lib/db/question_organization_schema.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { draftSessions } from '../lib/db/draft_schema.ts';
import { questions } from '../lib/db/question_schema.ts';
import { workflowDispatches } from '../lib/db/workflow_canvas_schema.ts';
import { createDraftSessionId } from '../lib/draft_session_id.ts';
import { createBankDraft, publishBankDraft } from '../lib/services/bank_drafts.ts';
import { getDraftSession } from '../lib/services/drafts.ts';
import { applyBankCollectionCommand } from '../lib/services/bank_collections.ts';
import { cancelOrganizationRun } from '../lib/services/question_organization_cancel.ts';
import {
  type OrganizationWorkerServices,
  processOrganizationStep,
} from '../lib/services/question_organization_processor.ts';
import { queueOrganizationInTransaction } from '../lib/services/question_organization_store.ts';
import {
  organizationNow as now,
  withOrganizationWorkspace,
} from './helpers/organization_workspace.ts';

const base: Omit<OrganizationWorkerServices, 'provider'> = {
  database: db,
  now,
  newId: () => crypto.randomUUID(),
};

testCase(
  'uncertain Clef calls retain their reservations and stop before exceeding the cap',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        let calls = 0;
        const services: OrganizationWorkerServices = {
          ...base,
          provider: () =>
            fixtureClefProvider(() => {
              calls++;
              return Promise.resolve({ ok: false, code: 'provider_failed' });
            }),
        };
        if (!((await processOrganizationStep(f.params, services)).ok)) {
          expect.unreachable('Expected (await processOrganizationStep(f.params, services)).ok');
        }
        expect(calls).toStrictEqual(1);
        expect(await processOrganizationStep(f.params, services)).toStrictEqual({
          ok: true,
          value: { state: 'failed', completed: 1 },
        });
        expect(calls).toStrictEqual(1);
        const [run] = await db.select().from(organizationRuns).where(
          eq(organizationRuns.id, f.runId),
        );
        expect(run.reservedMicros).toStrictEqual(7680);
        const attempts = await db.select().from(organizationAttempts).where(
          eq(organizationAttempts.runId, f.runId),
        );
        expect(attempts.map((a) => [a.state, a.chargedMicros])).toStrictEqual([[
          'uncertain',
          null,
        ]]);
        const [item] = await db.select().from(organizationItems).where(
          eq(organizationItems.runId, f.runId),
        );
        expect(item.detail).toStrictEqual('budget_exceeded');
      }, { clef: true, count: 1, budgetMicros: 7680 });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'cancelling during inference acquires the database and prevents the late decision from writing',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const services: OrganizationWorkerServices = {
          ...base,
          provider: () =>
            fixtureClefProvider(async () => {
              // This transaction would deadlock if the model request held the tenant/run locks.
              if (!((await cancelOrganizationRun(db, f.ctx, f.runId)).ok)) {
                expect.unreachable('Expected (await cancelOrganizationRun(db, f.ctx, f.runId)).ok');
              }
              return {
                ok: true,
                value: {
                  topicId: 'cells',
                  confidence: 0.9,
                  probabilities: { cells: 0.9, energy: 0.05, __no_match__: 0.05 },
                  model: 'clef',
                  inputTokens: 100,
                  outputTokens: 20,
                },
              };
            }),
        };
        if (!((await processOrganizationStep(f.params, services)).ok)) {
          expect.unreachable('Expected (await processOrganizationStep(f.params, services)).ok');
        }
        const [run] = await db.select().from(organizationRuns).where(
          eq(organizationRuns.id, f.runId),
        );
        expect(run.state).toStrictEqual('cancelled');
        expect(
          await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, f.destinationId),
          ),
        ).toStrictEqual([]);
      }, { clef: true, count: 1 });
    } finally {
      await shutdownDb();
    }
  },
);

testCase('manual removal before processing survives source-driven filing', async () => {
  try {
    await withOrganizationWorkspace(async (f) => {
      for (const action of ['AddItems', 'RemoveItems'] as const) {
        if (
          !((await applyBankCollectionCommand(f.ctx, crypto.randomUUID(), {
            _tag: action,
            collectionId: f.destinationId,
            questionIds: f.ids,
          }, { database: db, now })).ok)
        ) {
          expect.unreachable(
            'Expected (await applyBankCollectionCommand(f.ctx, crypto.randomUUID(), { _tag: action, collectionId',
          );
        }
      }
      if (
        !((await processOrganizationStep(f.params, {
          ...base,
          provider: () => {
            throw new Error('No inference expected');
          },
        })).ok)
      ) {
        expect.unreachable(
          "Expected (await processOrganizationStep(f.params, { ...base, provider: () => { throw new Error('No ",
        );
      }
      expect(
        await db.select().from(bankCollectionItems).where(
          eq(bankCollectionItems.collectionId, f.destinationId),
        ),
      ).toStrictEqual([]);
      const items = await db.select().from(organizationItems).where(
        eq(organizationItems.runId, f.runId),
      );
      if (!(items.every((item) => item.state === 'applied'))) {
        expect.unreachable("Expected items.every((item) => item.state === 'applied')");
      }
    });
  } finally {
    await shutdownDb();
  }
});

testCase('saved no-match receipts are reused only when their model matches full Clef', async () => {
  try {
    for (const model of ['clef', 'retired-classifier-1.13.0']) {
      await withOrganizationWorkspace(async (f) => {
        if (
          !((await processOrganizationStep(f.params, {
            ...base,
            provider: () =>
              fixtureClefProvider(() =>
                Promise.resolve({
                  ok: true,
                  value: {
                    topicId: null,
                    confidence: 0.9,
                    probabilities: { cells: 0.05, energy: 0.05, __no_match__: 0.9 },
                    model,
                    inputTokens: 100,
                    outputTokens: 20,
                  },
                })
              ),
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await processOrganizationStep(f.params, { ...base, provider: () => fixtureClefProvider(()',
          );
        }
        const id = crypto.randomUUID();
        if (
          !((await db.transaction((tx) =>
            queueOrganizationInTransaction(tx, f.ctx, {
              id,
              setupId: f.setupId,
              mode: 'apply',
              questionIds: f.ids,
            }, now())
          )).ok)
        ) {
          expect.unreachable(
            'Expected (await db.transaction((tx) => queueOrganizationInTransaction(tx, f.ctx, { id, setupId: f.s',
          );
        }
        const [run] = await db.select().from(organizationRuns).where(eq(organizationRuns.id, id));
        let calls = 0;
        const result = await processOrganizationStep({
          jobId: id,
          workflowExecutionId: run.executionId,
        }, {
          ...base,
          provider: () =>
            fixtureClefProvider(() => {
              calls++;
              return Promise.resolve({
                ok: true,
                value: {
                  topicId: null,
                  confidence: 1,
                  probabilities: { cells: 0, energy: 0, __no_match__: 1 },
                  model: 'clef',
                  inputTokens: 100,
                  outputTokens: 0,
                },
              });
            }),
        });
        expect(result).toStrictEqual({ ok: true, value: { state: 'completed', completed: 1 } });
        expect(calls).toStrictEqual(model === 'clef' ? 0 : 1);
        expect(
          (await db.select().from(organizationAttempts).where(eq(organizationAttempts.runId, id)))
            .length,
        ).toStrictEqual(model === 'clef' ? 0 : 1);
      }, { clef: true, count: 1 });
    }
  } finally {
    await shutdownDb();
  }
});

testCase(
  'bank publication commits pending organization atomically and exact save replay does not queue twice',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const id = createDraftSessionId();
        try {
          if (
            !((await createBankDraft(f.ctx, {
              id,
              collectionId: f.originId,
              type: 'single_select',
            }))
              .ok)
          ) {
            expect.unreachable(
              "Expected (await createBankDraft(f.ctx, { id, collectionId: f.originId, type: 'single_select' })) .o",
            );
          }
          const session = await getDraftSession(f.ctx, id);
          if (!session) expect.unreachable('Expected session');
          const draft = { ...session.draft, title: 'Saved in the configured collection' };
          await db.execute(
            sql`CREATE FUNCTION fail_organization_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.kind = 'question_organization' THEN RAISE EXCEPTION 'test outbox failure'; END IF; RETURN NEW; END; $$`,
          );
          await db.execute(
            sql`CREATE TRIGGER fail_organization_outbox BEFORE INSERT ON workflow_dispatches FOR EACH ROW EXECUTE FUNCTION fail_organization_outbox()`,
          );
          try {
            await expect(Promise.resolve().then(() => publishBankDraft(f.ctx, { id, draft })))
              .rejects.toBeInstanceOf(Error);
            expect(
              (await db.select().from(questions).where(eq(questions.tenantId, f.ctx.tenantId)))
                .length,
            ).toStrictEqual(f.ids.length);
            expect(
              (await db.select().from(organizationRuns).where(
                eq(organizationRuns.tenantId, f.ctx.tenantId),
              )).length,
            ).toStrictEqual(1);
          } finally {
            await db.execute(sql`DROP TRIGGER fail_organization_outbox ON workflow_dispatches`);
            await db.execute(sql`DROP FUNCTION fail_organization_outbox()`);
          }
          const saved = await publishBankDraft(f.ctx, { id, draft });
          if (!(saved.ok)) expect.unreachable('Expected saved.ok');
          expect(await publishBankDraft(f.ctx, { id, draft })).toStrictEqual(saved);
          const runs = await db.select().from(organizationRuns).where(
            eq(organizationRuns.tenantId, f.ctx.tenantId),
          );
          expect(runs.length).toStrictEqual(2);
          if (!(runs.every((run) => run.state === 'queued'))) {
            expect.unreachable("Expected runs.every((run) => run.state === 'queued')");
          }
          expect(
            (await db.select().from(workflowDispatches).where(
              eq(workflowDispatches.tenantId, f.ctx.tenantId),
            )).length,
          ).toStrictEqual(2);
        } finally {
          await db.delete(draftSessions).where(eq(draftSessions.tenantId, f.ctx.tenantId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

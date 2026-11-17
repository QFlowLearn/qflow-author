import { expect, test as testCase } from 'vitest';

import { fixtureClefProvider } from './helpers/fixture_clef_provider.ts';

import { and, eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  organizationFiling,
  organizationItems,
  organizationRuns,
  organizationSetups,
} from '../lib/db/question_organization_schema.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { enrichmentAssignments, enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import { workflowDispatches } from '../lib/db/workflow_canvas_schema.ts';
import { questions } from '../lib/db/question_schema.ts';
import {
  type OrganizationWorkerServices,
  processOrganizationStep,
} from '../lib/services/question_organization_processor.ts';
import { queueOrganizationInTransaction } from '../lib/services/question_organization_store.ts';
import { completeOrganizationUndoForTest } from './helpers/organization_undo.ts';
import { applyBankCollectionCommand } from '../lib/services/bank_collections.ts';
import {
  organizationNow as now,
  withOrganizationWorkspace,
} from './helpers/organization_workspace.ts';

const noInference: OrganizationWorkerServices = {
  database: db,
  now,
  newId: () => crypto.randomUUID(),
  provider: () => {
    throw new Error('Source mappings must not call a model.');
  },
};
const receipt = {
  topicId: 'cells',
  confidence: 0.9,
  probabilities: { cells: 0.9, energy: 0.05, __no_match__: 0.05 },
  model: 'clef',
  inputTokens: 700,
  outputTokens: 20,
};

testCase(
  'organization commits outbox, applies source mappings without inference, and replays without duplicate filing',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const dispatch = await db.select().from(workflowDispatches).where(
          eq(workflowDispatches.jobId, f.runId),
        );
        expect(dispatch.length).toStrictEqual(1);
        expect(dispatch[0].kind).toStrictEqual('question_organization');
        expect(
          await db.transaction((tx) =>
            queueOrganizationInTransaction(tx, f.ctx, {
              id: f.runId,
              setupId: f.setupId,
              mode: 'apply',
              questionIds: f.ids,
            }, now())
          ),
        ).toStrictEqual({ ok: true, value: f.runId });
        expect(await processOrganizationStep(f.params, noInference)).toStrictEqual({
          ok: true,
          value: { state: 'completed', completed: 3 },
        });
        const changes = await db.select().from(enrichmentChanges).where(
          eq(enrichmentChanges.operationId, f.runId),
        );
        expect(changes.length).toStrictEqual(6);
        if (!(changes.every((row) => row.origin === 'source'))) {
          expect.unreachable("Expected changes.every((row) => row.origin === 'source')");
        }
        expect(
          (await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, f.destinationId),
          )).length,
        ).toStrictEqual(3);
        await processOrganizationStep(f.params, noInference);
        expect(
          (await db.select().from(enrichmentChanges).where(
            eq(enrichmentChanges.operationId, f.runId),
          )).length,
        ).toStrictEqual(6);
        await expect(
          Promise.resolve().then(() =>
            db.update(organizationSetups).set({ version: 2 }).where(
              eq(organizationSetups.id, f.setupId),
            )
          ),
        ).rejects.toBeInstanceOf(Error);
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'organization protects later manual clears, stale revisions, and later filing edits during undo',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const [item] = await db.select().from(organizationItems).where(
          and(eq(organizationItems.runId, f.runId), eq(organizationItems.questionId, f.ids[0])),
        );
        const changeId = crypto.randomUUID();
        await db.insert(enrichmentChanges).values({
          id: changeId,
          tenantId: f.ctx.tenantId,
          questionId: item.questionId,
          revisionId: item.revisionId,
          schemeId: f.schemeId,
          versionId: f.versionId,
          dimension: 'topic',
          value: { state: 'unassigned', reason: 'outside_scheme' },
          origin: 'human',
          operationId: crypto.randomUUID(),
          createdBy: f.ctx.userId,
          createdAt: now(),
        });
        await db.insert(enrichmentAssignments).values({
          tenantId: f.ctx.tenantId,
          questionId: item.questionId,
          schemeId: f.schemeId,
          dimension: 'topic',
          changeId,
        });
        await db.update(questions).set({ latestRevisionId: null }).where(
          eq(questions.id, f.ids[1]),
        );
        const result = await processOrganizationStep(f.params, noInference);
        if (!(result.ok)) expect.unreachable('Expected result.ok');
        const rows = await db.select().from(organizationItems).where(
          eq(organizationItems.runId, f.runId),
        );
        expect(rows.find((r) => r.questionId === f.ids[0])?.state).toStrictEqual('protected');
        expect(rows.find((r) => r.questionId === f.ids[1])?.state).toStrictEqual('outdated');
        expect(rows.find((r) => r.questionId === f.ids[2])?.state).toStrictEqual('applied');
        // An explicit same-value Add is still a human ownership change.
        const human = await applyBankCollectionCommand(
          f.ctx,
          crypto.randomUUID(),
          { _tag: 'AddItems', collectionId: f.destinationId, questionIds: [f.ids[2]] },
          { database: db, now },
        );
        if (!(human.ok)) expect.unreachable('Expected human.ok');
        if (!((await completeOrganizationUndoForTest(db, f.ctx, f.runId, now())).ok)) {
          expect.unreachable(
            'Expected (await completeOrganizationUndoForTest(db, f.ctx, f.runId, now())).ok',
          );
        }
        expect((await db.select().from(bankCollectionItems).where(
          eq(bankCollectionItems.collectionId, f.destinationId),
        )).map((r) => r.questionId)).toStrictEqual([f.ids[2]]);
        const assignments = await db.select().from(enrichmentAssignments).where(
          eq(enrichmentAssignments.tenantId, f.ctx.tenantId),
        );
        if (!(assignments.some((row) => row.changeId === changeId))) {
          expect.unreachable('Expected assignments.some((row) => row.changeId === changeId)');
        }
        const restored = await db.select().from(enrichmentChanges).where(
          eq(enrichmentChanges.origin, 'undo'),
        );
        expect(restored.length).toStrictEqual(2);
        if (!(restored.every((row) => JSON.stringify(row.value) === '{"state":"absent"}'))) {
          expect.unreachable(
            'Expected restored.every((row) => JSON.stringify(row.value) === \'{"state":"absent"}\')',
          );
        }
        if (!((await completeOrganizationUndoForTest(db, f.ctx, f.runId, now())).ok)) {
          expect.unreachable(
            'Expected (await completeOrganizationUndoForTest(db, f.ctx, f.runId, now())).ok',
          );
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'Clef receipts survive a crash before apply, retain distributions, and are not inferred again',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const [first] = await db.select().from(organizationItems).where(
          eq(organizationItems.runId, f.runId),
        );
        await db.update(organizationItems).set({
          state: 'received',
          decision: { kind: 'clef', receipt },
          leaseToken: crypto.randomUUID(),
          leaseExpiresAt: new Date(now().getTime() - 1),
        }).where(
          and(
            eq(organizationItems.runId, f.runId),
            eq(organizationItems.questionId, first.questionId),
          ),
        );
        let calls = 0;
        const services: OrganizationWorkerServices = {
          ...noInference,
          provider: () =>
            fixtureClefProvider(() => {
              calls++;
              return Promise.resolve({ ok: true, value: receipt });
            }),
        };
        if (!((await processOrganizationStep(f.params, services)).ok)) {
          expect.unreachable('Expected (await processOrganizationStep(f.params, services)).ok');
        }
        expect(calls).toStrictEqual(2);
        const items = await db.select().from(organizationItems).where(
          eq(organizationItems.runId, f.runId),
        );
        if (!(items.every((item) => item.state === 'applied'))) {
          expect.unreachable("Expected items.every((item) => item.state === 'applied')");
        }
        if (!(items.every((item) => JSON.stringify(item.decision).includes('probabilities')))) {
          expect.unreachable(
            "Expected items.every((item) => JSON.stringify(item.decision).includes('probabilities'))",
          );
        }
        await processOrganizationStep(f.params, noInference);
        expect(calls).toStrictEqual(2);
        const [run] = await db.select().from(organizationRuns).where(
          eq(organizationRuns.id, f.runId),
        );
        expect(run.reservedMicros).toStrictEqual(336);
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
        if (
          !((await db.select().from(organizationFiling).where(
            eq(organizationFiling.tenantId, f.ctx.tenantId),
          )).every((row) => row.state === 'removed'))
        ) {
          expect.unreachable(
            'Expected (await db.select().from(organizationFiling).where( eq(organizationFiling.tenantId, f.ctx.t',
          );
        }
      }, { clef: true });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'historical model receipts still apply and undo without dispatching another model',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const historical = { ...receipt, model: 'retired-classifier-1.13.0' };
        await db.update(organizationItems).set({
          state: 'received',
          decision: { kind: 'clef', receipt: historical },
        }).where(eq(organizationItems.runId, f.runId));
        if (!((await processOrganizationStep(f.params, noInference)).ok)) {
          expect.unreachable('Expected (await processOrganizationStep(f.params, noInference)).ok');
        }
        const items = await db.select().from(organizationItems).where(
          eq(organizationItems.runId, f.runId),
        );
        if (!(items.every((item) => item.state === 'applied'))) {
          expect.unreachable("Expected items.every((item) => item.state === 'applied')");
        }
        if (
          !(items.every((item) =>
            JSON.stringify(item.decision).includes('retired-classifier-1.13.0')
          ))
        ) {
          expect.unreachable(
            "Expected items.every((item) => JSON.stringify(item.decision).includes('retired-classifier-1.13.0') ",
          );
        }
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
      }, { clef: true });
    } finally {
      await shutdownDb();
    }
  },
);

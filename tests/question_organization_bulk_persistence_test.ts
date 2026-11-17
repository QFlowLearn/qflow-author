import { expect, test as testCase } from 'vitest';

import { and, eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { enrichmentAssignments, enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import {
  organizationAttempts,
  organizationFiling,
  organizationItems,
  organizationRuns,
} from '../lib/db/question_organization_schema.ts';
import {
  type OrganizationWorkerServices,
  processOrganizationStep,
} from '../lib/services/question_organization_processor.ts';
import {
  queueOrganizationInTransaction,
  saveOrganizationSetup,
} from '../lib/services/question_organization_store.ts';
import { completeOrganizationUndoForTest } from './helpers/organization_undo.ts';
import {
  organizationNow as now,
  withOrganizationWorkspace,
} from './helpers/organization_workspace.ts';

const receipt = {
  topicId: 'cells',
  confidence: 0.99,
  probabilities: { cells: 0.99, energy: 0.01, __no_match__: 0 },
  model: 'clef',
  inputTokens: 70,
  outputTokens: 3,
};
const base: OrganizationWorkerServices = {
  database: db,
  now,
  newId: () => crypto.randomUUID(),
  provider: () => (questions) =>
    Promise.resolve({
      ok: true,
      value: questions.map((q) => ({
        questionId: q.questionId,
        receipt,
        chargedMicros: 3,
      })),
    }),
};

testCase(
  'bulk receipts fence a replaced lease and protect an in-flight human edit without dropping sibling results',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const [leased, edited, unmatched] = f.ids;
        const humanChange = crypto.randomUUID();
        const services: OrganizationWorkerServices = {
          ...base,
          provider: () => async (questions) => {
            await db.update(organizationItems).set({ leaseToken: crypto.randomUUID() }).where(and(
              eq(organizationItems.runId, f.runId),
              eq(organizationItems.questionId, leased),
            ));
            const item = await db.select().from(organizationItems).where(and(
              eq(organizationItems.runId, f.runId),
              eq(organizationItems.questionId, edited),
            ));
            await db.insert(enrichmentChanges).values({
              id: humanChange,
              tenantId: f.ctx.tenantId,
              questionId: edited,
              revisionId: item[0].revisionId,
              schemeId: f.schemeId,
              versionId: f.versionId,
              dimension: 'topic',
              value: { state: 'assigned', valueIds: ['energy'] },
              origin: 'human',
              operationId: crypto.randomUUID(),
              createdBy: f.ctx.userId,
              createdAt: now(),
            });
            await db.insert(enrichmentAssignments).values({
              tenantId: f.ctx.tenantId,
              questionId: edited,
              schemeId: f.schemeId,
              dimension: 'topic',
              changeId: humanChange,
            });
            return {
              ok: true,
              value: questions.map((q) => ({
                questionId: q.questionId,
                chargedMicros: 3,
                receipt: q.questionId === unmatched
                  ? {
                    ...receipt,
                    topicId: null,
                    probabilities: { cells: 0, energy: 0, __no_match__: 1 },
                  }
                  : receipt,
              })),
            };
          },
        };
        if (!((await processOrganizationStep(f.params, services)).ok)) {
          expect.unreachable('Expected (await processOrganizationStep(f.params, services)).ok');
        }
        const items = await db.select().from(organizationItems).where(
          eq(organizationItems.runId, f.runId),
        );
        expect(items.find((i) => i.questionId === leased)?.decision).toStrictEqual(null);
        expect(items.find((i) => i.questionId === leased)?.state).toStrictEqual('processing');
        expect(items.find((i) => i.questionId === edited)?.state).toStrictEqual('protected');
        expect(items.find((i) => i.questionId === unmatched)?.state).toStrictEqual('unassigned');
        expect(items.filter((i) => i.state === 'applied').length).toStrictEqual(7);
        const attempts = await db.select().from(organizationAttempts).where(
          eq(organizationAttempts.runId, f.runId),
        );
        expect(attempts.filter((a) => a.state === 'received').length).toStrictEqual(9);
        expect(attempts.find((a) => a.questionId === leased)?.chargedMicros).toStrictEqual(null);
        const [run] = await db.select().from(organizationRuns).where(
          eq(organizationRuns.id, f.runId),
        );
        expect(run.reservedMicros).toStrictEqual(7680 + 27);
        const [current] = await db.select().from(enrichmentAssignments).where(and(
          eq(enrichmentAssignments.questionId, edited),
          eq(enrichmentAssignments.dimension, 'topic'),
        ));
        expect(current.changeId).toStrictEqual(humanChange);
        expect(
          (await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, f.destinationId),
          )).length,
        ).toStrictEqual(7);
      }, { clef: true, count: 10 });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'bulk filing appends to multiple destinations, preserves existing positions and removals, and undoes only owned additions',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const setupId = crypto.randomUUID(), runId = crypto.randomUUID();
        if (
          !((await saveOrganizationSetup(db, f.ctx, {
            id: setupId,
            collectionId: f.originId,
            expectedVersion: 1,
            policy: {
              versionId: f.versionId,
              classifier: { kind: 'source_only' },
              filing: [
                { topicId: 'cells', collectionId: f.destinationId },
                { topicId: 'energy', collectionId: f.originId },
              ],
              sourceMappings: [
                { sourceId: f.sourceId, sectionKey: 'cells', topicId: 'cells' },
                { sourceId: f.sourceId, sectionKey: 'energy', topicId: 'energy' },
              ],
            },
          }, now())).ok)
        ) {
          expect.unreachable(
            'Expected (await saveOrganizationSetup(db, f.ctx, { id: setupId, collectionId: f.originId, expectedV',
          );
        }
        await db.insert(bankCollectionItems).values([
          {
            tenantId: f.ctx.tenantId,
            collectionId: f.destinationId,
            questionId: f.ids[0],
            position: 7,
          },
          { tenantId: f.ctx.tenantId, collectionId: f.originId, questionId: f.ids[4], position: 4 },
        ]);
        const removalId = crypto.randomUUID();
        await db.insert(organizationFiling).values({
          tenantId: f.ctx.tenantId,
          collectionId: f.destinationId,
          questionId: f.ids[1],
          changeId: removalId,
          origin: 'human',
          state: 'removed',
        });
        if (
          !((await db.transaction((tx) =>
            queueOrganizationInTransaction(tx, f.ctx, {
              id: runId,
              setupId,
              mode: 'apply',
              questionIds: f.ids,
            }, now())
          )).ok)
        ) {
          expect.unreachable(
            'Expected (await db.transaction((tx) => queueOrganizationInTransaction(tx, f.ctx, { id: runId, setup',
          );
        }
        const [run] = await db.select().from(organizationRuns).where(
          eq(organizationRuns.id, runId),
        );
        const params = { jobId: runId, workflowExecutionId: run.executionId };
        const services: OrganizationWorkerServices = {
          ...base,
          provider: () => {
            throw new Error('Mapped questions do not need inference');
          },
        };
        expect(await processOrganizationStep(params, services)).toStrictEqual({
          ok: true,
          value: { state: 'completed', completed: 10 },
        });
        const members = await db.select().from(bankCollectionItems).where(
          eq(bankCollectionItems.tenantId, f.ctx.tenantId),
        );
        expect(
          members.filter((m) => m.collectionId === f.destinationId).map((m) => m.position).sort((
            a,
            b,
          ) => a - b),
        ).toStrictEqual([7, 8, 9, 10]);
        expect(
          members.filter((m) => m.collectionId === f.originId).map((m) => m.position).sort((a, b) =>
            a - b
          ),
        ).toStrictEqual([4, 5, 6, 7, 8, 9]);
        const [removed] = await db.select().from(organizationFiling).where(
          eq(organizationFiling.questionId, f.ids[1]),
        );
        expect(removed.changeId).toStrictEqual(removalId);
        expect(removed.state).toStrictEqual('removed');
        const pointers = await db.select().from(enrichmentAssignments).innerJoin(
          enrichmentChanges,
          eq(enrichmentChanges.id, enrichmentAssignments.changeId),
        )
          .where(eq(enrichmentAssignments.tenantId, f.ctx.tenantId));
        expect(pointers.length).toStrictEqual(20);
        for (
          const { bank_enrichment_assignments: assignment, bank_enrichment_changes: change }
            of pointers
        ) {
          expect(change.questionId).toStrictEqual(assignment.questionId);
          expect(change.dimension).toStrictEqual(assignment.dimension);
          const topic = f.ids.slice(0, 5).includes(change.questionId) ? 'cells' : 'energy';
          expect(change.value).toStrictEqual({
            state: 'assigned',
            valueIds: [
              change.dimension === 'topic' ? topic : topic === 'cells' ? 'life' : 'physical',
            ],
          });
        }
        if (!((await processOrganizationStep(params, services)).ok)) {
          expect.unreachable('Expected (await processOrganizationStep(params, services)).ok');
        }
        if (!((await completeOrganizationUndoForTest(db, f.ctx, runId, now())).ok)) {
          expect.unreachable(
            'Expected (await completeOrganizationUndoForTest(db, f.ctx, runId, now())).ok',
          );
        }
        const retained = await db.select().from(bankCollectionItems).where(
          eq(bankCollectionItems.tenantId, f.ctx.tenantId),
        );
        expect(retained.map((m) => m.questionId).sort()).toStrictEqual([f.ids[0], f.ids[4]].sort());
        expect(retained.map((m) => m.position).sort()).toStrictEqual([4, 7]);
      }, { count: 10, sourceSections: [...Array(5).fill('cells'), ...Array(5).fill('energy')] });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'failure while saving batch charges rolls back every new receipt and retains the original reservations',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        await db.execute(
          sql`CREATE FUNCTION fail_bulk_charge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected charge failure'; END $$`,
        );
        await db.execute(
          sql`CREATE TRIGGER fail_bulk_charge BEFORE UPDATE ON question_organization_attempts FOR EACH ROW WHEN (NEW.state = 'received') EXECUTE FUNCTION fail_bulk_charge()`,
        );
        try {
          expect(await processOrganizationStep(f.params, base)).toStrictEqual({
            ok: false,
            code: 'storage_failed',
          });
        } finally {
          await db.execute(sql`DROP TRIGGER fail_bulk_charge ON question_organization_attempts`);
          await db.execute(sql`DROP FUNCTION fail_bulk_charge()`);
        }
        const items = await db.select().from(organizationItems).where(
          eq(organizationItems.runId, f.runId),
        );
        expect(items.length).toStrictEqual(10);
        if (!(items.every((i) => i.state === 'processing' && i.decision === null))) {
          expect.unreachable(
            "Expected items.every((i) => i.state === 'processing' && i.decision === null)",
          );
        }
        const attempts = await db.select().from(organizationAttempts).where(
          eq(organizationAttempts.runId, f.runId),
        );
        if (!(attempts.every((a) => a.state === 'reserved' && a.chargedMicros === null))) {
          expect.unreachable(
            "Expected attempts.every((a) => a.state === 'reserved' && a.chargedMicros === null)",
          );
        }
        const [run] = await db.select().from(organizationRuns).where(
          eq(organizationRuns.id, f.runId),
        );
        expect(run.reservedMicros).toStrictEqual(76800);
        expect(
          (await db.select().from(enrichmentChanges).where(
            eq(enrichmentChanges.operationId, f.runId),
          )).length,
        ).toStrictEqual(0);
      }, { clef: true, count: 10 });
    } finally {
      await shutdownDb();
    }
  },
);

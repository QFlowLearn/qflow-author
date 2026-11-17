import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import {
  organizationActivation,
  organizationItems,
  organizationOrigins,
  organizationRuns,
  organizationSetups,
} from '../lib/db/question_organization_schema.ts';
import { enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import { setOrganizationActivation } from '../lib/services/question_organization_activation.ts';
import { queueSavedQuestionOrganization } from '../lib/services/question_organization_intake.ts';
import {
  queueOrganizationInTransaction,
  saveOrganizationSetup,
} from '../lib/services/question_organization_store.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { completeOrganizationUndoForTest } from './helpers/organization_undo.ts';

testCase(
  'saved rules are inactive; activation is explicit, retry safe, and disabling fences stale tabs',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const queue = () =>
        db.transaction((tx) => queueSavedQuestionOrganization(tx, f.ctx, f.ids, organizationNow()));
      const runs = () =>
        db.select().from(organizationRuns).where(eq(organizationRuns.tenantId, f.ctx.tenantId));
      await queue();
      expect((await runs()).length).toStrictEqual(1);
      await db.delete(organizationOrigins).where(eq(organizationOrigins.questionId, f.ids[0]));
      await db.insert(bankCollectionItems).values({
        tenantId: f.ctx.tenantId,
        collectionId: f.originId,
        questionId: f.ids[0],
        position: 0,
      });

      const enable = {
        collectionId: f.originId,
        setupId: f.setupId,
        expectedRevision: 0,
        operationId: crypto.randomUUID(),
      };
      expect(await setOrganizationActivation(db, f.ctx, enable, organizationNow())).toStrictEqual({
        ok: true,
        value: 1,
      });
      expect(await setOrganizationActivation(db, f.ctx, enable, organizationNow())).toStrictEqual({
        ok: true,
        value: 1,
      });
      await queue();
      expect((await runs()).length).toStrictEqual(2);
      expect(
        (await db.select().from(organizationOrigins).where(
          eq(organizationOrigins.questionId, f.ids[0]),
        ))[0].collectionId,
      ).toStrictEqual(f.originId);
      expect(
        await setOrganizationActivation(
          db,
          { ...f.ctx, userId: crypto.randomUUID() },
          { ...enable, operationId: crypto.randomUUID(), expectedRevision: 1 },
          organizationNow(),
        ),
      ).toStrictEqual({ ok: false, code: 'forbidden' });

      const [saved] = await db.select().from(organizationSetups).where(
        eq(organizationSetups.id, f.setupId),
      );
      const nextId = crypto.randomUUID();
      if (
        !((await saveOrganizationSetup(db, f.ctx, {
          id: nextId,
          collectionId: f.originId,
          expectedVersion: 1,
          policy: saved.policy,
        }, organizationNow())).ok)
      ) {
        expect.unreachable(
          'Expected (await saveOrganizationSetup(db, f.ctx, { id: nextId, collectionId: f.originId, expectedVe',
        );
      }
      expect(
        (await db.select().from(organizationActivation).where(
          eq(organizationActivation.collectionId, f.originId),
        ))[0].setupId,
      ).toStrictEqual(f.setupId);
      expect(
        await setOrganizationActivation(db, f.ctx, {
          ...enable,
          setupId: null,
          expectedRevision: 1,
          operationId: crypto.randomUUID(),
        }, organizationNow()),
      ).toStrictEqual({ ok: true, value: 2 });
      expect(await setOrganizationActivation(db, f.ctx, enable, organizationNow())).toStrictEqual({
        ok: false,
        code: 'conflict',
      });
      await queue();
      expect((await runs()).length).toStrictEqual(2);
      expect(
        await setOrganizationActivation(db, f.ctx, {
          ...enable,
          collectionId: f.destinationId,
          expectedRevision: 0,
          operationId: crypto.randomUUID(),
        }, organizationNow()),
      ).toStrictEqual({ ok: false, code: 'invalid_input' });
    }, { activation: 'disabled' });
  },
);

testCase(
  'a preview records decisions without tags, filing or activation; its mode cannot be changed on replay',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const runId = crypto.randomUUID();
      const input = { id: runId, setupId: f.setupId, mode: 'preview' as const, questionIds: f.ids };
      if (
        !((await db.transaction((tx) =>
          queueOrganizationInTransaction(tx, f.ctx, input, organizationNow())
        )).ok)
      ) {
        expect.unreachable(
          'Expected (await db.transaction((tx) => queueOrganizationInTransaction(tx, f.ctx, input, organizatio',
        );
      }
      const [run] = await db.select().from(organizationRuns).where(eq(organizationRuns.id, runId));
      const result = await processOrganizationStep({
        jobId: runId,
        workflowExecutionId: run.executionId,
      }, {
        database: db,
        now: organizationNow,
        newId: () => crypto.randomUUID(),
        provider: () => {
          throw new Error('Source mapping must not call AI');
        },
      });
      if (!(result.ok)) expect.unreachable('Expected result.ok');
      expect(result.value.state).toStrictEqual('completed');
      if (
        !((await db.select().from(organizationItems).where(eq(organizationItems.runId, runId)))
          .every(
            (i) => i.state === 'previewed',
          ))
      ) {
        expect.unreachable(
          'Expected (await db.select().from(organizationItems).where(eq(organizationItems.runId, runId))).ever',
        );
      }
      expect(
        (await db.select().from(enrichmentChanges).where(
          eq(enrichmentChanges.tenantId, f.ctx.tenantId),
        )).length,
      ).toStrictEqual(0);
      expect(
        (await db.select().from(bankCollectionItems).where(
          eq(bankCollectionItems.collectionId, f.destinationId),
        )).length,
      ).toStrictEqual(0);
      expect(
        (await db.select().from(organizationActivation).where(
          eq(organizationActivation.collectionId, f.originId),
        )).length,
      ).toStrictEqual(0);
      expect(
        await db.transaction((tx) =>
          queueOrganizationInTransaction(tx, f.ctx, { ...input, mode: 'apply' }, organizationNow())
        ),
      ).toStrictEqual({ ok: false, code: 'conflict' });
      expect(await completeOrganizationUndoForTest(db, f.ctx, runId, organizationNow()))
        .toStrictEqual({
          ok: false,
          code: 'invalid_input',
        });
    }, { activation: 'disabled' });
  },
);

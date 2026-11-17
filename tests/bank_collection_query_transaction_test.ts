import { expect, test as testCase } from 'vitest';

import { getBankCollectionOrder } from '../lib/services/bank_collection_order.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { bankCollectionItems, bankCollections, editorialEvents } from '../lib/db/bank_schema.ts';
import { organizationMemberships, tenants, users } from '../lib/db/principal_schema.ts';
import { questionRevisions, questions } from '../lib/db/question_schema.ts';
import { applyBankCollectionCommand } from '../lib/services/bank_collections.ts';
import { parseQuestionBankQuery } from '../lib/services/question_bank_query.ts';
import { listQuestionBank } from '../lib/services/question_bank_read.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase(
  'bank collection queries compose with search and preserve filing order and Unfiled semantics',
  async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const collectionId = crypto.randomUUID();
    const ctx: RequestContext = { tenantId, userId, role: 'owner' };
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const apply = (command: unknown) =>
      applyBankCollectionCommand(ctx, crypto.randomUUID(), command);
    const list = (query: string) =>
      listQuestionBank(ctx, parseQuestionBankQuery(new URLSearchParams(query)));
    try {
      await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Query fixture' });
      await db.insert(users).values({
        id: userId,
        email: `${userId}@example.com`,
        emailNormalized: `${userId}@example.com`,
      });
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'owner',
      });
      const draft = {
        ...TYPE_DRIVERS.single_select.defaults(),
        itemLanguage: newAuthoringItemLanguage(),
      };
      const xml = exportQti3AssessmentItemXml(
        'single_select',
        prepareDriverDraftForBuild('single_select', draft),
        { identifier: 'collection-query' },
      );
      for (const [index, questionId] of ids.entries()) {
        await saveQuestionRevisionFixture(ctx, {
          questionId,
          title: `Question ${index}`,
          body: { ...draft, type: 'single_select', title: `Question ${index}` },
          tags: [index === 0 ? 'genetics' : 'biology'],
          provenance: { _tag: 'Authored' },
          qtiXml: xml,
          draftState: 'published',
        });
      }
      expect((await list('')).total).toStrictEqual(3);
      expect((await list('collection=unfiled')).total).toStrictEqual(3);
      if (
        !((await apply({
          _tag: 'Create',
          collectionId,
          name: 'Genetics',
          description: '',
          position: 0,
        })).ok)
      ) {
        expect.unreachable(
          "Expected (await apply({ _tag: 'Create', collectionId, name: 'Genetics', description: '', position: ",
        );
      }
      if (!((await apply({ _tag: 'AddItems', collectionId, questionIds: [ids[1], ids[0]] })).ok)) {
        expect.unreachable(
          "Expected (await apply({ _tag: 'AddItems', collectionId, questionIds: [ids[1], ids[0]] })).ok",
        );
      }
      expect((await list(`collection=${collectionId}`)).items.map((item) => item.id)).toStrictEqual(
        [
          ids[1],
          ids[0],
        ],
      );
      expect((await list(`collection=${collectionId}&tags=genetics`)).items.map((item) => item.id))
        .toStrictEqual([ids[0]]);
      expect((await list('collection=unfiled')).items.map((item) => item.id)).toStrictEqual([
        ids[2],
      ]);
      expect((await list(`collection=${crypto.randomUUID()}`)).total).toStrictEqual(0);
      if (
        !((await apply({ _tag: 'ReorderItems', collectionId, questionIds: [ids[0], ids[1]] })).ok)
      ) {
        expect.unreachable(
          "Expected (await apply({ _tag: 'ReorderItems', collectionId, questionIds: [ids[0], ids[1]] })).ok",
        );
      }
      expect((await list(`collection=${collectionId}`)).items.map((item) => item.id)).toStrictEqual(
        [
          ids[0],
          ids[1],
        ],
      );
      expect(await getBankCollectionOrder(ctx, collectionId)).toStrictEqual({
        ok: true,
        items: [{ id: ids[0], title: 'Question 0' }, { id: ids[1], title: 'Question 1' }],
      });
      if (!((await apply({ _tag: 'Archive', collectionId })).ok)) {
        expect.unreachable("Expected (await apply({ _tag: 'Archive', collectionId })).ok");
      }
      expect(await getBankCollectionOrder(ctx, collectionId)).toStrictEqual({
        ok: false,
        code: 'unavailable',
      });
      // Archiving preserves filing; it must not silently reclassify these items as Unfiled.
      expect((await list('collection=unfiled')).items.map((item) => item.id)).toStrictEqual([
        ids[2],
      ]);
      expect((await list('')).total).toStrictEqual(3);
      if (!((await apply({ _tag: 'Restore', collectionId })).ok)) {
        expect.unreachable("Expected (await apply({ _tag: 'Restore', collectionId })).ok");
      }
      if (!((await apply({ _tag: 'RemoveItems', collectionId, questionIds: [ids[0]] })).ok)) {
        expect.unreachable(
          "Expected (await apply({ _tag: 'RemoveItems', collectionId, questionIds: [ids[0]] })).ok",
        );
      }
      expect((await list('collection=unfiled')).total).toStrictEqual(2);
      expect((await list(`collection=${collectionId}`)).total).toStrictEqual(1);
      const extraIds = Array.from({ length: 501 }, () => crypto.randomUUID());
      await db.insert(questions).values(
        extraIds.map((id) => ({
          id,
          tenantId,
          ownerUserId: userId,
          stableKey: id,
          title: 'Large collection fixture',
          lifecycleState: 'active',
        })),
      );
      await db.insert(bankCollectionItems).values(
        extraIds.map((questionId, position) => ({
          tenantId,
          collectionId,
          questionId,
          position: position + 10,
        })),
      );
      expect(await getBankCollectionOrder(ctx, collectionId)).toStrictEqual({
        ok: false,
        code: 'too_large',
      });
    } finally {
      await db.delete(editorialEvents).where(eq(editorialEvents.tenantId, tenantId));
      await db.delete(bankCollectionItems).where(eq(bankCollectionItems.tenantId, tenantId));
      await db.delete(bankCollections).where(eq(bankCollections.tenantId, tenantId));
      await db.update(questions).set({ latestRevisionId: null }).where(
        eq(questions.tenantId, tenantId),
      );
      await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
      await db.delete(questions).where(eq(questions.tenantId, tenantId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
      await db.delete(users).where(eq(users.id, userId));
      await shutdownDb();
    }
  },
);

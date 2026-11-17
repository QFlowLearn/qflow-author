import { expect, test as testCase } from 'vitest';

import { canStartBankIntake } from '../lib/services/bank_intake_access.ts';

import { eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  assessments,
  bankCollectionItems,
  bankCollections,
  draftSessions,
  editorialEvents,
  organizationMemberships,
  questionRevisions,
  questions,
  tenants,
  users,
} from '../lib/db/schema.ts';
import { createDraftSessionId } from '../lib/draft_session_id.ts';
import { createBankDraft, publishBankDraft } from '../lib/services/bank_drafts.ts';
import {
  getDraftSession,
  listBankDraftSessions,
  updateDraftSession,
} from '../lib/services/drafts.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase(
  'bank drafts resume before first publication and commit filing with a stable retry receipt',
  async () => {
    if (!(/test/.test(new URL(process.env['DATABASE_URL'] ?? '').pathname))) {
      expect.unreachable('Use an isolated test database.');
    }
    const tenantId = crypto.randomUUID(),
      userId = crypto.randomUUID(),
      otherId = crypto.randomUUID();
    const collectionId = crypto.randomUUID();
    const ctx: RequestContext = { tenantId, userId, role: 'owner' };
    const id = createDraftSessionId();
    try {
      await db.insert(tenants).values({
        id: tenantId,
        slug: tenantId,
        name: 'Bank authoring test',
      });
      await db.insert(users).values(
        [userId, otherId].map((id) => ({
          id,
          email: `${id}@example.test`,
          emailNormalized: `${id}@example.test`,
        })),
      );
      await db.insert(organizationMemberships).values(
        [userId, otherId].map((userId) => ({
          id: crypto.randomUUID(),
          tenantId,
          userId,
          role: 'owner',
        })),
      );
      await db.insert(bankCollections).values({
        id: collectionId,
        tenantId,
        name: 'Test collection',
        description: '',
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.transaction(async (writer) => {
        await writer.select().from(tenants).where(eq(tenants.id, tenantId)).for('update');
        await db.transaction(async (reader) => {
          await reader.execute(sql`SET LOCAL lock_timeout = '200ms'`);
          expect(await canStartBankIntake(ctx, collectionId, reader)).toStrictEqual(true);
        });
      });
      const command = { id, collectionId, type: 'single_select' as const };
      expect(await createBankDraft(ctx, command)).toStrictEqual({ ok: true, id });
      expect(await createBankDraft(ctx, command)).toStrictEqual({ ok: true, id });
      const session = await getDraftSession(ctx, id);
      if (!session) expect.unreachable('Expected session');
      expect(session.binding).toStrictEqual({
        _tag: 'Bank',
        collectionId,
        publishedQuestionId: null,
      });
      expect(await getDraftSession({ ...ctx, userId: otherId }, id)).toStrictEqual(null);
      expect((await listBankDraftSessions(ctx)).map((draft) => draft.id)).toStrictEqual([id]);
      expect(await db.select().from(questions).where(eq(questions.tenantId, tenantId)))
        .toStrictEqual([]);
      const draft = { ...session.draft, title: 'Resumed bank question' };
      expect(await updateDraftSession(ctx, id, draft)).toStrictEqual({ ok: true });
      expect((await getDraftSession(ctx, id))?.draft.title).toStrictEqual(draft.title);
      await db.update(bankCollections).set({ archivedAt: new Date() }).where(
        eq(bankCollections.id, collectionId),
      );
      expect((await publishBankDraft(ctx, { id, draft })).ok).toStrictEqual(false);
      expect(await updateDraftSession(ctx, id, { ...draft, title: 'Archived destination edit' }))
        .toStrictEqual({ ok: false, code: 'not_found' });
      expect((await getDraftSession(ctx, id))?.draft.title).toStrictEqual(draft.title);
      await db.update(bankCollections).set({ archivedAt: null }).where(
        eq(bankCollections.id, collectionId),
      );
      await db.execute(
        sql`CREATE FUNCTION fail_bank_draft_filing() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'bank draft rollback'; END; $$`,
      );
      await db.execute(
        sql`CREATE TRIGGER fail_bank_draft_filing BEFORE INSERT ON bank_collection_items FOR EACH ROW EXECUTE FUNCTION fail_bank_draft_filing()`,
      );
      await expect(Promise.resolve().then(() => publishBankDraft(ctx, { id, draft }))).rejects
        .toBeInstanceOf(Error);
      await db.execute(sql`DROP TRIGGER fail_bank_draft_filing ON bank_collection_items`);
      await db.execute(sql`DROP FUNCTION fail_bank_draft_filing()`);
      expect(await db.select().from(questions).where(eq(questions.tenantId, tenantId)))
        .toStrictEqual([]);
      expect((await getDraftSession(ctx, id))?.binding).toStrictEqual(session.binding);
      const [beforeFiling] = await db.select().from(bankCollections).where(
        eq(bankCollections.id, collectionId),
      );
      const [saved, concurrent] = await Promise.all([
        publishBankDraft(ctx, { id, draft }),
        publishBankDraft(ctx, { id, draft }),
      ]);
      if (!(saved.ok)) expect.unreachable('Expected saved.ok');
      expect(saved).toStrictEqual(concurrent);
      const receipts = await db.select().from(editorialEvents).where(
        eq(editorialEvents.tenantId, tenantId),
      );
      expect(receipts.length).toStrictEqual(1);
      expect(receipts[0].action).toStrictEqual('AddItems');
      const [afterFiling] = await db.select().from(bankCollections).where(
        eq(bankCollections.id, collectionId),
      );
      if (!(afterFiling.updatedAt.getTime() > beforeFiling.updatedAt.getTime())) {
        expect.unreachable(
          'Expected afterFiling.updatedAt.getTime() > beforeFiling.updatedAt.getTime()',
        );
      }
      expect(await publishBankDraft(ctx, { id, draft })).toStrictEqual(saved);
      expect(
        (await publishBankDraft(ctx, { id, draft: { ...draft, title: 'Changed replay' } })).status,
      ).toStrictEqual(409);
      expect(await updateDraftSession(ctx, id, draft)).toStrictEqual({
        ok: false,
        code: 'not_found',
      });
      expect(await listBankDraftSessions(ctx)).toStrictEqual([]);
      expect(
        (await db.select().from(questionRevisions).where(eq(questionRevisions.tenantId, tenantId)))
          .length,
      ).toStrictEqual(1);
      expect((await db.select().from(bankCollectionItems).where(
        eq(bankCollectionItems.tenantId, tenantId),
      )).map((row) => row.questionId)).toStrictEqual([saved.body.itemId]);
      expect(await db.select().from(assessments).where(eq(assessments.tenantId, tenantId)))
        .toStrictEqual([]);
      await db.update(bankCollectionItems).set({ position: 2147483647 }).where(
        eq(bankCollectionItems.collectionId, collectionId),
      );
      const overflowId = createDraftSessionId();
      expect(await createBankDraft(ctx, { ...command, id: overflowId })).toStrictEqual({
        ok: true,
        id: overflowId,
      });
      const overflowSession = await getDraftSession(ctx, overflowId);
      if (!overflowSession) expect.unreachable('Expected overflowSession');
      expect((await publishBankDraft(ctx, { id: overflowId, draft: overflowSession.draft })).status)
        .toStrictEqual(409);
      expect((await db.select().from(questions).where(eq(questions.tenantId, tenantId))).length)
        .toStrictEqual(1);
      expect((await getDraftSession(ctx, overflowId))?.binding).toStrictEqual(
        overflowSession.binding,
      );
      expect(
        (await db.select().from(editorialEvents).where(eq(editorialEvents.tenantId, tenantId)))
          .length,
      ).toStrictEqual(1);
      await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId));
      expect(await getDraftSession(ctx, id)).toStrictEqual(null);
      expect((await publishBankDraft(ctx, { id, draft })).status).toStrictEqual(404);
      expect(await createBankDraft(ctx, { ...command, id: createDraftSessionId() })).toStrictEqual({
        ok: false,
        code: 'forbidden',
      });
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS fail_bank_draft_filing ON bank_collection_items`);
      await db.execute(sql`DROP FUNCTION IF EXISTS fail_bank_draft_filing()`);
      await db.delete(draftSessions).where(eq(draftSessions.tenantId, tenantId));
      await db.delete(bankCollectionItems).where(eq(bankCollectionItems.tenantId, tenantId));
      await db.delete(editorialEvents).where(eq(editorialEvents.tenantId, tenantId));
      await db.delete(bankCollections).where(eq(bankCollections.tenantId, tenantId));
      await db.update(questions).set({ latestRevisionId: null }).where(
        eq(questions.tenantId, tenantId),
      );
      await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
      await db.delete(questions).where(eq(questions.tenantId, tenantId));
      await db.delete(organizationMemberships).where(
        eq(organizationMemberships.tenantId, tenantId),
      );
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(users).where(eq(users.id, otherId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
      await shutdownDb();
    }
  },
);

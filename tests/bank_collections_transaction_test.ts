import { expect, test as testCase } from 'vitest';

import { runStep } from './helpers/ordered_step.ts';

import { and, eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { bankCollectionItems, bankCollections, editorialEvents } from '../lib/db/bank_schema.ts';
import { organizationMemberships, tenants, users } from '../lib/db/principal_schema.ts';
import { questions } from '../lib/db/question_schema.ts';
import {
  applyBankCollectionCommand,
  listBankCollections,
} from '../lib/services/bank_collections.ts';
import { removeMember, updateMemberRole } from '../lib/services/memberships.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase(
  'collections preserve the populated pool, tenant boundaries, receipts, and membership authority',
  async () => {
    const tenantId = crypto.randomUUID();
    const otherTenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const secondOwner = crypto.randomUUID();
    const ctx: RequestContext = { tenantId, userId, role: 'instructor' };
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const item = crypto.randomUUID();
    const otherItem = crypto.randomUUID();
    const collection = (collectionId: string, name = 'Biology / Genetics') => ({
      _tag: 'Create',
      collectionId,
      name,
      description: 'Flat label',
      position: 0,
    });
    const apply = (command: unknown, operationId = crypto.randomUUID()) =>
      applyBankCollectionCommand(ctx, operationId, command);
    try {
      await db.insert(tenants).values(
        [tenantId, otherTenantId].map((id) => ({ id, slug: id, name: 'Collection test' })),
      );
      await db.insert(users).values({
        id: userId,
        email: `${userId}@example.com`,
        emailNormalized: `${userId}@example.com`,
        displayName: 'Editorial member',
      });
      await db.insert(users).values({
        id: secondOwner,
        email: secondOwner + '@example.com',
        emailNormalized: secondOwner + '@example.com',
      });
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId: secondOwner,
        role: 'owner',
      });
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'instructor',
      });
      await db.insert(questions).values(
        [{ id: item, tenantId }, { id: otherItem, tenantId: otherTenantId }].map((row) => ({
          ...row,
          stableKey: row.id,
          title: 'Existing question',
          ownerUserId: userId,
          lifecycleState: 'active',
        })),
      );
      const original = await db.select().from(questions).where(eq(questions.id, item));

      await runStep('empty collection list leaves an existing workspace usable', async () => {
        expect(await listBankCollections(ctx)).toStrictEqual({ ok: true, collections: [] });
        expect(await db.select().from(questions).where(eq(questions.id, item))).toStrictEqual(
          original,
        );
      });
      await runStep(
        'concurrent duplicate creation creates one receipt and mismatched retries fail',
        async () => {
          const operation = crypto.randomUUID();
          const results = await Promise.all([
            apply(collection(first), operation),
            apply(collection(first), operation),
          ]);
          expect(results).toStrictEqual([{ ok: true, collectionId: first }, {
            ok: true,
            collectionId: first,
          }]);
          expect(await apply(collection(first, 'Changed'), operation)).toStrictEqual({
            ok: false,
            code: 'operation_conflict',
          });
          const events = await db.select().from(editorialEvents).where(
            eq(editorialEvents.operationId, operation),
          );
          expect(events.length).toStrictEqual(1);
          expect(events[0].actorLabel).toStrictEqual('Editorial member');
          expect(await apply(collection(second))).toStrictEqual({ ok: true, collectionId: second });
        },
      );
      await runStep(
        'mixed-tenant selection is rejected atomically and constraints reject direct forgery',
        async () => {
          expect(
            await apply({ _tag: 'AddItems', collectionId: first, questionIds: [item, otherItem] }),
          ).toStrictEqual({ ok: false, code: 'invalid_selection' });
          expect(
            await db.select().from(bankCollectionItems).where(
              eq(bankCollectionItems.collectionId, first),
            ),
          ).toStrictEqual([]);
          await expect(
            Promise.resolve().then(() =>
              db.insert(bankCollectionItems).values({
                tenantId,
                collectionId: first,
                questionId: otherItem,
                position: 0,
              })
            ),
          ).rejects.toBeInstanceOf(Error);
          await expect(
            Promise.resolve().then(() =>
              db.insert(bankCollectionItems).values({
                tenantId: otherTenantId,
                collectionId: first,
                questionId: otherItem,
                position: 0,
              })
            ),
          ).rejects.toBeInstanceOf(Error);
        },
      );
      await runStep(
        'one question can be filed twice without changing any question fields',
        async () => {
          for (const collectionId of [first, second]) {
            expect(await apply({ _tag: 'AddItems', collectionId, questionIds: [item] }))
              .toStrictEqual({
                ok: true,
                collectionId,
              });
          }
          expect(await db.select().from(questions).where(eq(questions.id, item))).toStrictEqual(
            original,
          );
          expect(
            (await db.select().from(bankCollectionItems).where(
              eq(bankCollectionItems.questionId, item),
            )).length,
          ).toStrictEqual(2);
        },
      );
      await runStep('receipt write failure rolls back the collection mutation', async () => {
        const operation = crypto.randomUUID();
        // Force a real receipt constraint failure without changing the production adapter.
        await db.execute(
          sql.raw(
            `ALTER TABLE editorial_events ADD CONSTRAINT test_receipt_failure CHECK (operation_id <> '${operation}')`,
          ),
        );
        try {
          await expect(
            Promise.resolve().then(() =>
              apply({ _tag: 'RemoveItems', collectionId: first, questionIds: [item] }, operation)
            ),
          ).rejects.toBeInstanceOf(Error);
          expect(
            (await db.select().from(bankCollectionItems).where(
              eq(bankCollectionItems.collectionId, first),
            )).length,
          ).toStrictEqual(1);
        } finally {
          await db.execute(sql`ALTER TABLE editorial_events DROP CONSTRAINT test_receipt_failure`);
        }
      });
      await runStep('archive preserves filing, blocks edits, and restores visibility', async () => {
        if (!((await apply({ _tag: 'Archive', collectionId: first })).ok)) {
          expect.unreachable("Expected (await apply({ _tag: 'Archive', collectionId: first })).ok");
        }
        const visible = await listBankCollections(ctx);
        if (!(visible.ok)) expect.unreachable('Expected visible.ok');
        expect(visible.collections.map((row) => row.id)).toStrictEqual([second]);
        expect(await apply({ _tag: 'RemoveItems', collectionId: first, questionIds: [item] }))
          .toStrictEqual({
            ok: false,
            code: 'archived',
          });
        expect(
          (await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, first),
          )).length,
        ).toStrictEqual(1);
        if (!((await apply({ _tag: 'Restore', collectionId: first })).ok)) {
          expect.unreachable("Expected (await apply({ _tag: 'Restore', collectionId: first })).ok");
        }
        if (
          !((await apply({ _tag: 'RemoveItems', collectionId: first, questionIds: [item] })).ok)
        ) {
          expect.unreachable(
            "Expected (await apply({ _tag: 'RemoveItems', collectionId: first, questionIds: [item] })).ok",
          );
        }
        expect(await db.select().from(questions).where(eq(questions.id, item))).toStrictEqual(
          original,
        );
      });
      await runStep(
        'reorder rejects incomplete sets and update persists navigation order and labels',
        async () => {
          expect(await apply({ _tag: 'ReorderItems', collectionId: first, questionIds: [item] }))
            .toStrictEqual({ ok: false, code: 'invalid_selection' });
          if (
            !((await apply({ _tag: 'ReorderItems', collectionId: second, questionIds: [item] })).ok)
          ) {
            expect.unreachable(
              "Expected (await apply({ _tag: 'ReorderItems', collectionId: second, questionIds: [item] })).ok",
            );
          }
          if (
            !((await apply({
              _tag: 'Update',
              collectionId: first,
              name: 'Renamed',
              description: '',
              position: 10,
            })).ok)
          ) {
            expect.unreachable(
              "Expected (await apply({ _tag: 'Update', collectionId: first, name: 'Renamed', description: '', posi",
            );
          }
          const list = await listBankCollections(ctx);
          if (!(list.ok)) expect.unreachable('Expected list.ok');
          expect(list.collections.map((row) => [row.id, row.name])).toStrictEqual([[
            second,
            'Biology / Genetics',
          ], [first, 'Renamed']]);
        },
      );
      await runStep(
        'current persisted membership overrides a stale request role, including retries',
        async () => {
          const operation = crypto.randomUUID();
          const command = { _tag: 'Archive', collectionId: first };
          if (!((await apply(command, operation)).ok)) {
            expect.unreachable('Expected (await apply(command, operation)).ok');
          }
          if (
            !((await updateMemberRole({
              actor: { tenantId, userId: secondOwner, role: 'owner' },
              tenantId,
              userId,
              role: 'teaching_assistant',
            })).ok)
          ) {
            expect.unreachable(
              "Expected (await updateMemberRole({ actor: { tenantId, userId: secondOwner, role: 'owner' }, tenantI",
            );
          }
          expect(await apply(command, operation)).toStrictEqual({ ok: false, code: 'forbidden' });
          if (!((await listBankCollections(ctx)).ok)) {
            expect.unreachable('Expected (await listBankCollections(ctx)).ok');
          }
          if (
            !((await removeMember({
              actor: { tenantId, userId: secondOwner, role: 'owner' },
              tenantId,
              userId,
            })).ok)
          ) {
            expect.unreachable(
              "Expected (await removeMember({ actor: { tenantId, userId: secondOwner, role: 'owner' }, tenantId, u",
            );
          }
          expect(await listBankCollections(ctx)).toStrictEqual({ ok: false, code: 'forbidden' });
          expect(await apply(command)).toStrictEqual({ ok: false, code: 'forbidden' });
        },
      );
    } finally {
      await db.delete(editorialEvents).where(eq(editorialEvents.tenantId, tenantId));
      await db.delete(bankCollectionItems).where(eq(bankCollectionItems.tenantId, tenantId));
      await db.delete(bankCollections).where(eq(bankCollections.tenantId, tenantId));
      await db.delete(questions).where(and(eq(questions.ownerUserId, userId)));
      for (const id of [tenantId, otherTenantId]) {
        await db.delete(tenants).where(eq(tenants.id, id));
      }
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(users).where(eq(users.id, secondOwner));
      await shutdownDb();
    }
  },
);

import { and, eq } from 'drizzle-orm';
import { db, type QflowDatabase } from '../db.ts';
import { bankCollectionItems, bankCollections } from '../db/bank_schema.ts';
import { organizationMemberships } from '../db/principal_schema.ts';
import { questions } from '../db/question_schema.ts';
import { hasCapability, parseRole } from '../roles.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';

/** A complete bounded filing order, including archived questions, or an explicit inability to arrange. */
export type BankCollectionOrder =
  | {
    readonly ok: true;
    readonly items: readonly { readonly id: string; readonly title: string }[];
  }
  | { readonly ok: false; readonly code: 'unavailable' | 'too_large' };

/** Load the entire collection for arrangement; never turn a filtered page into a reorder command. */
export async function getBankCollectionOrder(
  ctx: RequestContext,
  collectionId: string,
  database: QflowDatabase = db,
): Promise<BankCollectionOrder> {
  if (!isCanonicalUuid(collectionId)) return { ok: false, code: 'unavailable' };
  const membership = await database.select({ role: organizationMemberships.role }).from(
    organizationMemberships,
  )
    .where(
      and(
        eq(organizationMemberships.tenantId, ctx.tenantId),
        eq(organizationMemberships.userId, ctx.userId),
      ),
    );
  const role = parseRole(membership[0]?.role);
  if (!role || !hasCapability(role, 'manage_content')) return { ok: false, code: 'unavailable' };
  const collection = await database.select({ archivedAt: bankCollections.archivedAt }).from(
    bankCollections,
  )
    .where(and(eq(bankCollections.tenantId, ctx.tenantId), eq(bankCollections.id, collectionId)));
  if (!collection.length || collection[0].archivedAt) return { ok: false, code: 'unavailable' };
  const items = await database.select({ id: questions.id, title: questions.title }).from(
    bankCollectionItems,
  )
    .innerJoin(
      questions,
      and(
        eq(questions.id, bankCollectionItems.questionId),
        eq(questions.tenantId, bankCollectionItems.tenantId),
      ),
    )
    .where(
      and(
        eq(bankCollectionItems.tenantId, ctx.tenantId),
        eq(bankCollectionItems.collectionId, collectionId),
      ),
    )
    .orderBy(bankCollectionItems.position, bankCollectionItems.questionId).limit(501);
  return items.length > 500 ? { ok: false, code: 'too_large' } : { ok: true, items };
}

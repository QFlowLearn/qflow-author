import { and, eq, inArray, sql } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { bankCollectionItems, bankCollections } from '../db/bank_schema.ts';
import { organizationFiling } from '../db/question_organization_schema.ts';
import type { OrganizationRun } from './question_organization_read.ts';

/** File a locked application batch, retaining existing memberships and human removal tombstones. */
export async function fileOrganizationQuestions(
  tx: QflowDatabaseTransaction,
  context: OrganizationRun,
  requests: readonly { readonly questionId: string; readonly collectionId: string }[],
  now: Date,
): Promise<void> {
  if (!requests.length) return;
  const collectionIds = [...new Set(requests.map((r) => r.collectionId))];
  const questionIds = requests.map((r) => r.questionId);
  const tenantId = context.ctx.tenantId;
  // Stable lock order also serializes append positions with other organization runs.
  const collections = await tx.select().from(bankCollections).where(and(
    eq(bankCollections.tenantId, tenantId),
    inArray(bankCollections.id, collectionIds),
  )).orderBy(bankCollections.id).for('update');
  if (collections.length !== collectionIds.length || collections.some((c) => c.archivedAt)) {
    throw new Error('Organization destination is unavailable.');
  }
  const existing = await tx.select().from(bankCollectionItems).where(and(
    eq(bankCollectionItems.tenantId, tenantId),
    inArray(bankCollectionItems.collectionId, collectionIds),
    inArray(bankCollectionItems.questionId, questionIds),
  ));
  const ownership = await tx.select().from(organizationFiling).where(and(
    eq(organizationFiling.tenantId, tenantId),
    inArray(organizationFiling.collectionId, collectionIds),
    inArray(organizationFiling.questionId, questionIds),
  ));
  const additions = requests.filter((r) =>
    !existing.some((e) => e.collectionId === r.collectionId && e.questionId === r.questionId) &&
    !ownership.some((o) =>
      o.collectionId === r.collectionId && o.questionId === r.questionId && o.state === 'removed'
    )
  );
  if (!additions.length) return;
  const last = await tx.select({
    collectionId: bankCollectionItems.collectionId,
    position: sql<number>`max(${bankCollectionItems.position}) + 1`.mapWith(Number),
  }).from(bankCollectionItems).where(and(
    eq(bankCollectionItems.tenantId, tenantId),
    inArray(bankCollectionItems.collectionId, collectionIds),
  )).groupBy(bankCollectionItems.collectionId);
  // An empty collection starts at zero. Existing positions are never renumbered.
  const next = new Map(collectionIds.map((id) => [id, 0]));
  for (const row of last) next.set(row.collectionId, row.position);
  const memberships = additions.map((r) => {
    const position = next.get(r.collectionId);
    if (position === undefined) throw new Error('Organization destination was not locked.');
    next.set(r.collectionId, position + 1);
    return { tenantId, collectionId: r.collectionId, questionId: r.questionId, position };
  });
  await tx.insert(bankCollectionItems).values(memberships);
  await tx.insert(organizationFiling).values(additions.map((r) => ({
    tenantId,
    collectionId: r.collectionId,
    questionId: r.questionId,
    changeId: context.run.id,
    origin: 'organization',
    state: 'present',
  }))).onConflictDoUpdate({
    target: [organizationFiling.collectionId, organizationFiling.questionId],
    set: { changeId: context.run.id, origin: 'organization', state: 'present' },
  });
  await tx.update(bankCollections).set({ updatedAt: now }).where(and(
    eq(bankCollections.tenantId, tenantId),
    inArray(bankCollections.id, [...new Set(additions.map((r) => r.collectionId))]),
  ));
}

import { expect, test as testCase } from 'vitest';

import { asc, eq, inArray } from 'drizzle-orm';

import { db, shutdownDb } from '../lib/db.ts';
import {
  assessmentParts,
  assessmentPlacements,
  assessments,
  organizationMemberships,
  questionRevisions,
  questions,
  tenants,
  users,
} from '../lib/db/schema.ts';
import { ensureDemoPresidents } from '../lib/demo_presidents_seed.ts';
import {
  DEMO_PRESIDENT_PARTS,
  DEMO_PRESIDENT_SOURCES,
  DEMO_PRESIDENTS_VERSION,
} from '../lib/demo_presidents_catalog.ts';
import {
  getPlacementQuestionViews,
  getQuestionRevisionHistory,
} from '../lib/services/questions.ts';
import { bankCollectionItems, bankCollections, editorialEvents } from '../lib/db/bank_schema.ts';
import { seedDemoBankCollections } from '../tools/seed_bank_collections.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase('demo persists every catalog item and refreshes provenance atomically', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const email = `demo-history-${userId.slice(0, 8)}@example.com`;
  const ctx: RequestContext = { tenantId, userId, role: 'owner' };

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `demo-history-${tenantId.slice(0, 8)}`,
      name: 'Demo History Test',
    });
    await db.insert(users).values({
      id: userId,
      email,
      emailNormalized: email,
      displayName: 'Demo History Author',
    });

    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });
    await expect(Promise.resolve().then(() => seedDemoBankCollections(ctx))).rejects.toSatisfy((
      caught: unknown,
    ) => caught instanceof Error && caught.message.includes('Create the presidents demo'));
    expect(await db.select().from(bankCollections).where(eq(bankCollections.tenantId, tenantId)))
      .toStrictEqual([]);

    const [assessmentId, concurrentAssessmentId] = await Promise.all([
      ensureDemoPresidents(ctx),
      ensureDemoPresidents(ctx),
    ]);
    expect(concurrentAssessmentId).toStrictEqual(assessmentId);
    await assertCompleteDemoState(ctx, assessmentId, 1);

    await db.update(assessments).set({
      metadata: { demoVersion: 'presidents-v6' },
    }).where(eq(assessments.id, assessmentId));
    expect(await ensureDemoPresidents(ctx)).toStrictEqual(assessmentId);
    await assertCompleteDemoState(ctx, assessmentId, 2);
    const beforeQuestions = await db.select().from(questions).where(
      eq(questions.tenantId, tenantId),
    ).orderBy(questions.id);
    const beforeRevisions = await db.select().from(questionRevisions).where(
      eq(questionRevisions.tenantId, tenantId),
    ).orderBy(questionRevisions.id);
    const beforeAssessments = await db.select().from(assessments).where(
      eq(assessments.tenantId, tenantId),
    ).orderBy(assessments.id);
    const collectionIds = await seedDemoBankCollections(ctx);
    expect(await seedDemoBankCollections(ctx)).toStrictEqual(collectionIds);
    expect(collectionIds.length).toStrictEqual(2);
    const filings = await db.select().from(bankCollectionItems).where(
      eq(bankCollectionItems.tenantId, tenantId),
    );
    expect(filings.length).toStrictEqual(10);
    expect(new Set(filings.map((row) => row.questionId)).size).toStrictEqual(8);
    expect(
      (await db.select().from(editorialEvents).where(eq(editorialEvents.tenantId, tenantId)))
        .length,
    ).toStrictEqual(4);
    expect(
      await db.select().from(questions).where(eq(questions.tenantId, tenantId)).orderBy(
        questions.id,
      ),
    ).toStrictEqual(beforeQuestions);
    expect(
      await db.select().from(questionRevisions).where(eq(questionRevisions.tenantId, tenantId))
        .orderBy(questionRevisions.id),
    ).toStrictEqual(beforeRevisions);
    expect(
      await db.select().from(assessments).where(eq(assessments.tenantId, tenantId)).orderBy(
        assessments.id,
      ),
    ).toStrictEqual(beforeAssessments);
  } finally {
    try {
      await db.delete(editorialEvents).where(eq(editorialEvents.tenantId, tenantId));
      await db.delete(bankCollectionItems).where(eq(bankCollectionItems.tenantId, tenantId));
      await db.delete(bankCollections).where(eq(bankCollections.tenantId, tenantId));
      await db.delete(assessments).where(eq(assessments.tenantId, tenantId));
      await db.delete(questions).where(eq(questions.tenantId, tenantId));
      await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    } catch {
      // Ignore cleanup failures.
    }
    await shutdownDb().catch(() => {});
  }
});

async function assertCompleteDemoState(
  ctx: RequestContext,
  assessmentId: string,
  expectedRevision: number,
): Promise<void> {
  const assessmentRows = await db.select({ metadata: assessments.metadata })
    .from(assessments)
    .where(eq(assessments.id, assessmentId));
  expect(assessmentRows.map((row) => row.metadata.demoVersion)).toStrictEqual([
    DEMO_PRESIDENTS_VERSION,
  ]);

  const questionRows = await db.select({
    id: questions.id,
    stableKey: questions.stableKey,
    latestRevisionId: questions.latestRevisionId,
  }).from(questions).where(eq(questions.tenantId, ctx.tenantId));
  expect(questionRows.length).toStrictEqual(DEMO_PRESIDENT_SOURCES.length);
  expect(questionRows.map((row) => row.stableKey).sort()).toStrictEqual(
    DEMO_PRESIDENT_SOURCES.map((source) => source.stableKey).sort(),
  );

  const revisionRows = await db.select({
    id: questionRevisions.id,
    questionId: questionRevisions.questionId,
    revision: questionRevisions.revision,
  }).from(questionRevisions)
    .where(eq(questionRevisions.tenantId, ctx.tenantId))
    .orderBy(asc(questionRevisions.questionId), asc(questionRevisions.revision));
  expect(revisionRows.length).toStrictEqual(DEMO_PRESIDENT_SOURCES.length * expectedRevision);
  const latestByQuestionId = new Map(
    revisionRows.filter((row) => row.revision === expectedRevision).map((row) => [
      row.questionId,
      row.id,
    ]),
  );
  for (const question of questionRows) {
    expect(question.latestRevisionId).toStrictEqual(latestByQuestionId.get(question.id));
    const history = await getQuestionRevisionHistory(ctx, question.id);
    if (!history) throw new Error('Expected complete demo question history.');
    expect(history.revisions.map((revision) => revision.event.operation)).toStrictEqual(
      expectedRevision === 1 ? ['created'] : ['revised', 'created'],
    );
    expect(history.origin).toStrictEqual({ _tag: 'Authored' });
    expect(history.revisions[0]?.event.author.id).toStrictEqual(ctx.userId);
  }

  const partRows = await db.select({ id: assessmentParts.id })
    .from(assessmentParts)
    .where(eq(assessmentParts.assessmentId, assessmentId));
  expect(partRows.length).toStrictEqual(DEMO_PRESIDENT_PARTS.length);
  const partIds = partRows.map((part) => part.id);
  const placementRows = await db.select({
    id: assessmentPlacements.id,
    questionId: assessmentPlacements.questionId,
    pinnedRevision: assessmentPlacements.pinnedRevision,
  }).from(assessmentPlacements).where(inArray(assessmentPlacements.assessmentPartId, partIds));
  expect(placementRows.length).toStrictEqual(DEMO_PRESIDENT_SOURCES.length);
  expect(new Set(placementRows.map((placement) => placement.questionId)).size).toStrictEqual(
    placementRows.length,
  );
  expect(placementRows.every((placement) => placement.pinnedRevision === expectedRevision))
    .toStrictEqual(true);
  const placementViews = await getPlacementQuestionViews(
    ctx,
    placementRows.map((placement) => {
      if (!(placement.questionId !== null)) {
        expect.unreachable('Expected placement.questionId !== null');
      }
      return {
        placementId: placement.id,
        itemId: placement.questionId,
        revision: placement.pinnedRevision,
      };
    }),
  );
  expect(Object.keys(placementViews).length).toStrictEqual(DEMO_PRESIDENT_SOURCES.length);
}

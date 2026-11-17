import { and, eq } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { bankCollectionItems } from '../db/bank_schema.ts';
import { enrichmentAssignments, enrichmentChanges } from '../db/bank_enrichment_schema.ts';
import { organizationFiling, organizationItems } from '../db/question_organization_schema.ts';
import { questions } from '../db/question_schema.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { loadCurrentEnrichmentChanges, loadEnrichmentChanges } from './bank_enrichment_changes.ts';
import { type EnrichmentUndoTargets, planEnrichmentUndo } from './bank_enrichment_undo_policy.ts';
import type { OrganizationRun } from './question_organization_read.ts';

/** Restore current tokens only; question and tenant locks protect concurrent human edits. */
export async function undoOrganizationItem(
  tx: QflowDatabaseTransaction,
  context: OrganizationRun,
  item: typeof organizationItems.$inferSelect,
  now: Date,
): Promise<void> {
  const ctx = context.ctx, runId = context.run.id;
  const undoId = await uuidV5(runId, 'undo');
  const [question] = await tx.select().from(questions).where(
    and(eq(questions.id, item.questionId), eq(questions.tenantId, ctx.tenantId)),
  ).for('update');
  if (!question || question.latestRevisionId !== item.revisionId) return;
  const rows = await tx.select().from(enrichmentChanges).where(
    and(
      eq(enrichmentChanges.tenantId, ctx.tenantId),
      eq(enrichmentChanges.operationId, runId),
      eq(enrichmentChanges.questionId, item.questionId),
    ),
  );
  if (rows.length) {
    const records = await loadEnrichmentChanges(tx, ctx.tenantId, context.schemeId, [
      ...rows.map((r) => r.id),
      ...rows.flatMap((r) => r.previousChangeId ? [r.previousChangeId] : []),
    ]);
    const targets: Record<
      keyof EnrichmentUndoTargets,
      EnrichmentUndoTargets[keyof EnrichmentUndoTargets]
    > = { subject: null, topic: null, difficulty: null };
    for (const row of rows) {
      const written = records.get(row.id);
      if (!written) throw new Error('Organization history is missing.');
      targets[written.dimension] = {
        written,
        previous: written.previousChangeId ? records.get(written.previousChangeId) ?? null : null,
      };
    }
    const current = (await loadCurrentEnrichmentChanges(tx, ctx.tenantId, context.schemeId, [
      item.questionId,
    ])).get(item.questionId);
    if (!current) throw new Error('Organization current assignment is missing.');
    const plan = planEnrichmentUndo(current, targets);
    for (const dimension of ['subject', 'topic'] as const) {
      const restoration = plan.writes[dimension];
      if (!restoration) continue;
      const id = await uuidV5(undoId, `${item.questionId}:${dimension}`);
      await tx.insert(enrichmentChanges).values({
        id,
        tenantId: ctx.tenantId,
        questionId: item.questionId,
        revisionId: restoration.revisionId,
        schemeId: context.schemeId,
        versionId: restoration.versionId,
        dimension,
        value: restoration.value ?? { state: 'absent' },
        origin: 'undo',
        operationId: undoId,
        previousChangeId: current[dimension]?.changeId,
        createdBy: ctx.userId,
        createdAt: now,
      });
      await tx.update(enrichmentAssignments).set({ changeId: id }).where(
        and(
          eq(enrichmentAssignments.tenantId, ctx.tenantId),
          eq(enrichmentAssignments.schemeId, context.schemeId),
          eq(enrichmentAssignments.questionId, item.questionId),
          eq(enrichmentAssignments.dimension, dimension),
        ),
      );
    }
  }
  const memberships = await tx.select().from(organizationFiling).where(
    and(
      eq(organizationFiling.tenantId, ctx.tenantId),
      eq(organizationFiling.changeId, runId),
      eq(organizationFiling.origin, 'organization'),
      eq(organizationFiling.questionId, item.questionId),
    ),
  );
  for (const membership of memberships) {
    await tx.delete(bankCollectionItems).where(
      and(
        eq(bankCollectionItems.tenantId, ctx.tenantId),
        eq(bankCollectionItems.collectionId, membership.collectionId),
        eq(bankCollectionItems.questionId, membership.questionId),
      ),
    );
    await tx.update(organizationFiling).set({
      changeId: undoId,
      origin: 'undo',
      state: 'removed',
    }).where(
      and(
        eq(organizationFiling.tenantId, ctx.tenantId),
        eq(organizationFiling.collectionId, membership.collectionId),
        eq(organizationFiling.questionId, membership.questionId),
      ),
    );
  }
}

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../lib/db.ts';
import { enrichmentAssignments, enrichmentChanges } from '../../lib/db/bank_enrichment_schema.ts';
import { questions } from '../../lib/db/question_schema.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentClassification,
} from '../../lib/services/bank_enrichment_contract.ts';

/** Persist current assignment pointers and their history in an owned test workspace, without AI calls. */
export async function assignOverviewFixture(
  ctx: RequestContext,
  schemeId: string,
  versionId: string,
  ids: readonly string[],
  classification: Readonly<Partial<EnrichmentClassification>>,
): Promise<void> {
  const source = await db.select({ id: questions.id, revisionId: questions.latestRevisionId })
    .from(questions).where(
      and(eq(questions.tenantId, ctx.tenantId), inArray(questions.id, [...ids])),
    );
  const previous = await db.select().from(enrichmentAssignments).where(and(
    eq(enrichmentAssignments.tenantId, ctx.tenantId),
    eq(enrichmentAssignments.schemeId, schemeId),
    inArray(enrichmentAssignments.questionId, [...ids]),
  ));
  await db.transaction(async (tx) => {
    for (const question of source) {
      if (!question.revisionId) throw new Error('Fixture question must be published.');
      for (const dimension of ENRICHMENT_DIMENSIONS) {
        const value = classification[dimension];
        if (!value) continue;
        const id = crypto.randomUUID();
        await tx.insert(enrichmentChanges).values({
          id,
          tenantId: ctx.tenantId,
          schemeId,
          questionId: question.id,
          versionId,
          revisionId: question.revisionId,
          dimension,
          value,
          origin: 'human',
          operationId: crypto.randomUUID(),
          createdBy: ctx.userId,
          createdAt: new Date(),
          previousChangeId:
            previous.find((row) => row.questionId === question.id && row.dimension === dimension)
              ?.changeId ?? null,
        });
        await tx.insert(enrichmentAssignments).values({
          tenantId: ctx.tenantId,
          schemeId,
          questionId: question.id,
          dimension,
          changeId: id,
        }).onConflictDoUpdate({
          target: [
            enrichmentAssignments.tenantId,
            enrichmentAssignments.schemeId,
            enrichmentAssignments.questionId,
            enrichmentAssignments.dimension,
          ],
          set: { changeId: id },
        });
      }
    }
  });
}

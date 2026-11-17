import { and, asc, eq, sql } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { enrichmentAssignments, enrichmentChanges } from '../db/schema.ts';
import type { ProposalMode } from '../bank_question_proposal.ts';
import type { RequestContext } from '../tenants.ts';
import type { QuestionBankQuestionsQuery } from './question_bank_query.ts';
import { enrichmentBrowseScope } from './bank_enrichment_browse_sql.ts';
import { ENRICHMENT_DIMENSIONS } from './bank_enrichment_contract.ts';

export type CategorizedBankCandidate = {
  readonly itemId: string;
  readonly revisionId: string;
  readonly versionId: string;
  readonly categoryId: string;
};

/** Current classifications in an explicit chooser dimension within the complete tenant-authorized bank scope. */
export async function loadCategorizedBankCandidates(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  query: QuestionBankQuestionsQuery,
  mode: ProposalMode,
): Promise<CategorizedBankCandidate[]> {
  const filter = query.enrichment;
  if (!filter) throw new Error('Proposal scope requires a category set.');
  const bank = enrichmentBrowseScope(tx, ctx, query).as('proposal_bank');
  const conditions = [
    eq(enrichmentAssignments.tenantId, ctx.tenantId),
    eq(enrichmentAssignments.schemeId, filter.schemeId),
    eq(enrichmentAssignments.dimension, mode),
    eq(enrichmentChanges.revisionId, bank.revisionId),
    sql`${enrichmentChanges.value} ->> 'state' = 'assigned'`,
  ];
  // Requested category identities must describe this same revision and producing version.
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    const value = filter[dimension];
    if (value?.kind !== 'value') continue;
    conditions.push(eq(enrichmentChanges.versionId, value.versionId));
    conditions.push(
      sql`EXISTS (SELECT 1 FROM bank_enrichment_assignments ca JOIN bank_enrichment_changes cc ON cc.id = ca.change_id
      WHERE ca.tenant_id = ${ctx.tenantId} AND ca.scheme_id = ${filter.schemeId} AND ca.question_id = ${bank.id} AND ca.dimension = ${dimension}
        AND cc.revision_id = ${bank.revisionId} AND cc.version_id = ${value.versionId})`,
    );
  }
  const rows = await tx.select({
    itemId: bank.id,
    revisionId: enrichmentChanges.revisionId,
    versionId: enrichmentChanges.versionId,
    categoryIds: sql<unknown>`${enrichmentChanges.value} -> 'valueIds'`,
  })
    .from(bank).innerJoin(enrichmentAssignments, eq(enrichmentAssignments.questionId, bank.id))
    .innerJoin(enrichmentChanges, eq(enrichmentChanges.id, enrichmentAssignments.changeId))
    .where(and(...conditions)).orderBy(asc(bank.id));
  return rows.flatMap((row) => {
    if (
      !Array.isArray(row.categoryIds) || !row.categoryIds.length ||
      !row.categoryIds.every((id): id is string => typeof id === 'string') ||
      (mode === 'difficulty' && row.categoryIds.length !== 1)
    ) {
      throw new Error('Invalid persisted category identities.');
    }
    return row.categoryIds.map((categoryId) => ({
      itemId: row.itemId,
      revisionId: row.revisionId,
      versionId: row.versionId,
      categoryId,
    }));
  });
}

import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { QflowDatabaseTransaction } from '../db.ts';
import { questionReviewRequests, questionRevisions, questions } from '../db/question_schema.ts';
import type { RequestContext } from '../tenants.ts';
import type { EnrichmentDimension } from './bank_enrichment_contract.ts';
import type { QuestionBankQuery } from './question_bank_query.ts';
import { questionBankConditions } from './question_bank_scope.ts';
import { bankEnrichmentStatusFilter } from './bank_enrichment_query.ts';
import {
  bankEnrichmentParticipationSql,
  bankEnrichmentValueSql,
  ENRICHMENT_VOCABULARY_KEYS,
} from './bank_enrichment_query_sql.ts';

/** Apply the supplied bank selection without changing its filters. */
export function enrichmentBrowseScope(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  query: QuestionBankQuery,
) {
  const latest = alias(questionRevisions, 'enrichment_browse_latest');
  const first = alias(questionRevisions, 'enrichment_browse_first');
  return tx.select({ id: questions.id, revisionId: questions.latestRevisionId })
    .from(questions)
    .innerJoin(latest, eq(latest.id, questions.latestRevisionId))
    .innerJoin(first, and(eq(first.questionId, questions.id), eq(first.revision, 1)))
    .leftJoin(
      questionReviewRequests,
      and(
        eq(questionReviewRequests.revisionId, latest.id),
        eq(questionReviewRequests.tenantId, ctx.tenantId),
      ),
    )
    .where(and(...questionBankConditions(ctx, query, latest, first)));
}

/** Full-scope alternative counts, independent of the 100-row page. */
export async function enrichmentBrowseStateCounts(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  query: QuestionBankQuery,
  schemeId: string,
  dimension: EnrichmentDimension,
) {
  const predicate = (kind: 'unassigned' | 'pending' | 'outside' | 'outdated') =>
    bankEnrichmentValueSql(
      ctx.tenantId,
      schemeId,
      sql`bank.id`,
      sql`bank.latest_revision_id`,
      dimension,
      bankEnrichmentStatusFilter(kind),
    );
  const rows = await tx.execute<
    { unassigned: number; pending: number; outside: number; outdated: number }
  >(sql`
    WITH bank AS (${enrichmentBrowseScope(tx, ctx, query)})
    SELECT count(*) FILTER (WHERE ${predicate('unassigned')})::int AS unassigned,
      count(*) FILTER (WHERE ${predicate('pending')})::int AS pending,
      count(*) FILTER (WHERE ${predicate('outside')})::int AS outside,
      count(*) FILTER (WHERE ${predicate('outdated')})::int AS outdated
    FROM bank
  `);
  if (rows.length !== 1) throw new Error('Invalid enrichment state counts.');
  return rows[0];
}

/** Page-only projections read assigned labels, never full historical prompts or examples. */
export function enrichmentBrowseRowsSql(
  tenantId: string,
  schemeId: string,
  ids: readonly string[],
  dimension: EnrichmentDimension,
) {
  return sql`
    SELECT q.id, ec.value, ev.id AS "versionId", ev.version, ev.definition ->> 'audience' AS audience,
      ec.revision_id <> q.latest_revision_id AS outdated,
      ${bankEnrichmentParticipationSql(tenantId, schemeId, sql`q.id`, dimension)} AS participated,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', category ->> 'id', 'label', category ->> 'label')), '[]'::jsonb)
        FROM jsonb_array_elements(ev.definition -> ${
          ENRICHMENT_VOCABULARY_KEYS[dimension]
        }) category
        WHERE ec.value -> 'valueIds' ? (category ->> 'id')) AS vocabulary
    FROM questions q
    LEFT JOIN bank_enrichment_assignments ea ON ea.tenant_id = q.tenant_id AND ea.question_id = q.id AND ea.scheme_id = ${schemeId} AND ea.dimension = ${dimension}
    LEFT JOIN bank_enrichment_changes ec ON ec.id = ea.change_id
    LEFT JOIN bank_enrichment_scheme_versions ev ON ev.id = ec.version_id
    WHERE q.tenant_id = ${tenantId} AND q.id IN (SELECT value::uuid FROM jsonb_array_elements_text(${
      JSON.stringify(ids)
    }::jsonb))
  `;
}

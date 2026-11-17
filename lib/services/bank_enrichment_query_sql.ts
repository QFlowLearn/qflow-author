import { type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { EnrichmentDimension } from './bank_enrichment_contract.ts';
import type { BankEnrichmentValueFilter } from './bank_enrichment_query.ts';

/** Fixed JSON keys shared by filter validation and result projections. */
export const ENRICHMENT_VOCABULARY_KEYS = {
  subject: 'subjects',
  topic: 'topics',
  difficulty: 'difficulty',
} as const;

/** One lateral projection supplies both version and configured position for difficulty ordering. */
export function bankEnrichmentDifficultyRank(
  tenantId: string,
  schemeId: string,
  questionId: AnyPgColumn,
): { readonly source: SQL; readonly version: SQL; readonly position: SQL } {
  return {
    source: sql`LATERAL (
      SELECT ev.version, levels.position
      FROM bank_enrichment_assignments ea
      JOIN bank_enrichment_changes ec ON ec.id = ea.change_id
      JOIN bank_enrichment_scheme_versions ev ON ev.id = ec.version_id
        AND ev.tenant_id = ${tenantId} AND ev.scheme_id = ${schemeId}
      CROSS JOIN LATERAL jsonb_array_elements(ev.definition -> 'difficulty')
        WITH ORDINALITY AS levels(category, position)
      WHERE ea.tenant_id = ${tenantId} AND ea.scheme_id = ${schemeId}
        AND ea.question_id = ${questionId} AND ea.dimension = 'difficulty'
        AND ec.value ->> 'state' = 'assigned'
        AND category ->> 'id' = ec.value -> 'valueIds' ->> 0
    ) AS bank_difficulty_rank`,
    version: sql`bank_difficulty_rank.version`,
    position: sql`bank_difficulty_rank.position`,
  };
}

/** Participation excludes previews and prepared work that has never been queued. */
export function bankEnrichmentParticipationSql(
  tenantId: string,
  schemeId: string,
  questionId: AnyPgColumn | SQL,
  dimension: EnrichmentDimension,
): SQL {
  return sql`EXISTS (
    SELECT 1 FROM bank_enrichment_run_items eri
    JOIN bank_enrichment_runs er ON er.id = eri.run_id
    JOIN bank_enrichment_tasks et ON et.id = er.id AND et.kind = 'classify'
    WHERE eri.tenant_id = ${tenantId} AND eri.scheme_id = ${schemeId}
      AND eri.question_id = ${questionId}
      AND er.dimensions @> ${JSON.stringify([dimension])}::jsonb
  )`;
}

/** Correlated SQL uses current change tokens and exact producing versions without joining duplicate rows. */
export function bankEnrichmentValueSql(
  tenantId: string,
  schemeId: string,
  questionId: AnyPgColumn | SQL,
  latestRevisionId: AnyPgColumn | SQL,
  dimension: EnrichmentDimension,
  filter: BankEnrichmentValueFilter,
): SQL {
  const identity = sql`ea.tenant_id = ${tenantId} AND ea.scheme_id = ${schemeId}
    AND ea.question_id = ${questionId} AND ea.dimension = ${dimension}`;
  if (filter.kind === 'pending' || filter.kind === 'outside') {
    const included = bankEnrichmentParticipationSql(tenantId, schemeId, questionId, dimension);
    return sql`NOT EXISTS (SELECT 1 FROM bank_enrichment_assignments ea
        JOIN bank_enrichment_changes ec ON ec.id = ea.change_id
        WHERE ${identity} AND ec.value ->> 'state' <> 'absent')
      AND ${filter.kind === 'pending' ? included : sql`NOT ${included}`}`;
  }
  const category = filter.kind === 'value'
    ? sql`ec.version_id = ${filter.versionId} AND ec.value ->> 'state' = 'assigned'
        AND ec.value -> 'valueIds' ? ${filter.valueId}`
    : filter.kind === 'unassigned'
    ? sql`ec.value ->> 'state' = 'unassigned'`
    : sql`ec.value ->> 'state' <> 'absent'`;
  const condition = filter.freshness === 'outdated'
    ? sql`${category} AND ec.revision_id <> ${latestRevisionId}`
    : category;
  return sql`EXISTS (
    SELECT 1 FROM bank_enrichment_assignments ea
    JOIN bank_enrichment_changes ec ON ec.id = ea.change_id
    WHERE ${identity} AND ${condition}
  )`;
}

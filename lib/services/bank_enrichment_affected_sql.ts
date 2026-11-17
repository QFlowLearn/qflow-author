import { type SQL, sql } from 'drizzle-orm';
import { enrichmentSnapshotItems } from '../db/bank_enrichment_schema.ts';
import { ENRICHMENT_DIMENSIONS, type EnrichmentDimension } from './bank_enrichment_contract.ts';
import { ENRICHMENT_VOCABULARY_KEYS } from './bank_enrichment_query_sql.ts';

/** Match current values from the same uninterrupted category identity, including earlier versions. */
export function enrichmentAffectedSql(
  tenantId: string,
  schemeId: string,
  baseVersion: number,
  removed: Readonly<Record<EnrichmentDimension, readonly string[]>>,
): SQL {
  const filters = ENRICHMENT_DIMENSIONS.flatMap((dimension) => {
    const ids = removed[dimension];
    if (!ids.length) return [];
    const key = ENRICHMENT_VOCABULARY_KEYS[dimension];
    return [sql`(ec.dimension = ${dimension} AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(ec.value -> 'valueIds') changed(value_id)
      WHERE changed.value_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        AND NOT EXISTS (
          SELECT 1 FROM bank_enrichment_scheme_versions gap
          WHERE gap.tenant_id = ${tenantId} AND gap.scheme_id = ${schemeId}
            AND gap.version > producing.version AND gap.version <= ${baseVersion}
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(gap.definition -> ${key}) category
              WHERE category ->> 'id' = changed.value_id)
        )
    ))`];
  });
  if (!filters.length) throw new Error('An affected scope requires changed category identities.');
  return sql`EXISTS (
    SELECT 1 FROM bank_enrichment_assignments ea
    JOIN bank_enrichment_changes ec ON ec.id = ea.change_id
    JOIN bank_enrichment_scheme_versions producing ON producing.id = ec.version_id
    WHERE ea.tenant_id = ${tenantId} AND ea.scheme_id = ${schemeId}
      AND ea.question_id = ${enrichmentSnapshotItems.questionId}
      AND ec.value ->> 'state' = 'assigned' AND producing.version <= ${baseVersion}
      AND (${sql.join(filters, sql` OR `)})
  )`;
}

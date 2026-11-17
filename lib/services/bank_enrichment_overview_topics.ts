import { sql } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import type { RequestContext } from '../tenants.ts';
import type { QuestionBankQuery } from './question_bank_query.ts';
import {
  enrichmentOverviewClassificationSql,
  parseOverviewCategory,
  parseOverviewCount,
  parseOverviewIdentity,
} from './bank_enrichment_overview_sql.ts';

/** Topics overlap; each cell counts distinct questions within its subject and difficulty. */
export async function loadEnrichmentOverviewTopics(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  query: QuestionBankQuery,
  schemeId: string,
) {
  const selected = query.enrichment?.topic;
  if (selected && selected.kind !== 'value' && selected.kind !== 'unconstrained') return [];
  const topicSelection = selected?.kind === 'value'
    ? sql`AND "topicVersion" = ${selected.versionId} AND topic_id = ${selected.valueId}`
    : sql``;
  const rows = await tx.execute<Record<string, unknown>>(sql`
    WITH classified AS (${enrichmentOverviewClassificationSql(tx, ctx, query, schemeId)}),
    counts AS (
      SELECT "subjectState", "subjectVersion", "subjectValue",
        "difficultyState", "difficultyVersion", "difficultyValue",
        "topicVersion", topic_id, count(DISTINCT id)::int AS count
      FROM classified
      CROSS JOIN LATERAL jsonb_array_elements_text("topicValues") AS topics(topic_id)
      WHERE "topicState" = 'assigned' ${topicSelection}
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
    )
    SELECT counts.*, ev.id AS "versionId", ev.version,
      ev.definition ->> 'audience' AS audience,
      category ->> 'id' AS id, category ->> 'label' AS label
    FROM counts
    JOIN bank_enrichment_scheme_versions ev ON ev.id = "topicVersion"
      AND ev.tenant_id = ${ctx.tenantId} AND ev.scheme_id = ${schemeId}
    CROSS JOIN LATERAL jsonb_array_elements(ev.definition -> 'topics')
      WITH ORDINALITY AS vocabulary(category, position)
    WHERE category ->> 'id' = topic_id
    ORDER BY ev.version DESC, position
  `);
  return rows.map((row) => ({
    subject: parseOverviewIdentity(row.subjectState, row.subjectVersion, row.subjectValue),
    difficulty: parseOverviewIdentity(
      row.difficultyState,
      row.difficultyVersion,
      row.difficultyValue,
    ),
    topic: parseOverviewCategory(row),
    count: parseOverviewCount(row.count),
  }));
}

import type { EnrichmentOverviewBucket } from './bank_enrichment_browse_contract.ts';
import { sql } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import type { EnrichmentDimension } from './bank_enrichment_contract.ts';
import { enrichmentBrowseScope } from './bank_enrichment_browse_sql.ts';
import { bankEnrichmentParticipationSql } from './bank_enrichment_query_sql.ts';
import type { BankEnrichmentValueFilter } from './bank_enrichment_query.ts';
import type { QuestionBankQuery } from './question_bank_query.ts';

/** Parsed persistence projection; group identities are independent of URL serialization. */
export type EnrichmentOverviewGroup = {
  readonly subject: BankEnrichmentValueFilter;
  readonly difficulty: BankEnrichmentValueFilter;
  readonly count: number;
  readonly subjectOutdated: number;
  readonly difficultyOutdated: number;
  readonly topicOutdated: number;
  readonly topicUnassigned: number;
  readonly topicPending: number;
  readonly topicOutside: number;
};

/** Count the matrix and remaining status totals together over one authorized selection. */
export async function loadEnrichmentOverviewGroups(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  query: QuestionBankQuery,
  schemeId: string,
): Promise<readonly EnrichmentOverviewGroup[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    WITH classified AS (${enrichmentOverviewClassificationSql(tx, ctx, query, schemeId)})
    SELECT "subjectState", "subjectVersion", "subjectValue",
      "difficultyState", "difficultyVersion", "difficultyValue", count(*)::int AS count,
      count(*) FILTER (WHERE "subjectOutdated")::int AS "subjectOutdated",
      count(*) FILTER (WHERE "difficultyOutdated")::int AS "difficultyOutdated",
      count(*) FILTER (WHERE "topicOutdated")::int AS "topicOutdated",
      count(*) FILTER (WHERE "topicState" = 'unassigned')::int AS "topicUnassigned",
      count(*) FILTER (WHERE "topicState" = 'pending')::int AS "topicPending",
      count(*) FILTER (WHERE "topicState" = 'outside')::int AS "topicOutside"
    FROM classified GROUP BY 1, 2, 3, 4, 5, 6
  `);
  return rows.map((row) => ({
    subject: parseOverviewIdentity(row.subjectState, row.subjectVersion, row.subjectValue),
    difficulty: parseOverviewIdentity(
      row.difficultyState,
      row.difficultyVersion,
      row.difficultyValue,
    ),
    count: parseOverviewCount(row.count),
    subjectOutdated: parseOverviewCount(row.subjectOutdated),
    difficultyOutdated: parseOverviewCount(row.difficultyOutdated),
    topicOutdated: parseOverviewCount(row.topicOutdated),
    topicUnassigned: parseOverviewCount(row.topicUnassigned),
    topicPending: parseOverviewCount(row.topicPending),
    topicOutside: parseOverviewCount(row.topicOutside),
  }));
}

export function parseOverviewIdentity(
  state: unknown,
  versionId: unknown,
  valueId: unknown,
): BankEnrichmentValueFilter {
  if (state === 'assigned') {
    if (
      typeof versionId !== 'string' || !isCanonicalUuid(versionId) ||
      typeof valueId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(valueId)
    ) {
      throw new Error('Invalid overview category identity.');
    }
    return { kind: 'value', versionId, valueId, freshness: 'any' };
  }
  if (
    versionId !== null || valueId !== null ||
    (state !== 'unassigned' && state !== 'pending' && state !== 'outside')
  ) {
    throw new Error('Invalid overview missing state.');
  }
  return { kind: state, freshness: 'any' };
}

export function parseOverviewCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid overview count.');
  }
  return value;
}

/** Project current assignments once per question; callers aggregate without reading question bodies. */
export function enrichmentOverviewClassificationSql(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  query: QuestionBankQuery,
  schemeId: string,
) {
  const columns = (dimension: EnrichmentDimension) => {
    const change = sql.identifier(`${dimension}_change`);
    return sql`
      CASE WHEN ${change}.value ->> 'state' IN ('assigned', 'unassigned')
        THEN ${change}.value ->> 'state'
        WHEN ${bankEnrichmentParticipationSql(ctx.tenantId, schemeId, sql`bank.id`, dimension)}
          THEN 'pending' ELSE 'outside' END AS ${sql.identifier(`${dimension}State`)},
      CASE WHEN ${change}.value ->> 'state' = 'assigned' THEN ${change}.version_id END
        AS ${sql.identifier(`${dimension}Version`)},
      CASE WHEN ${change}.value ->> 'state' = 'assigned' THEN ${change}.value -> 'valueIds' ->> 0 END
        AS ${sql.identifier(`${dimension}Value`)},
      ${change}.value ->> 'state' <> 'absent' AND ${change}.revision_id <> bank.latest_revision_id
        AS ${sql.identifier(`${dimension}Outdated`)}`;
  };
  const join = (dimension: EnrichmentDimension) => {
    const assignment = sql.identifier(`${dimension}_assignment`);
    const change = sql.identifier(`${dimension}_change`);
    return sql`LEFT JOIN bank_enrichment_assignments ${assignment}
      ON ${assignment}.tenant_id = ${ctx.tenantId} AND ${assignment}.question_id = bank.id
      AND ${assignment}.scheme_id = ${schemeId} AND ${assignment}.dimension = ${dimension}
      LEFT JOIN bank_enrichment_changes ${change} ON ${change}.id = ${assignment}.change_id`;
  };
  return sql`
    WITH bank AS (${enrichmentBrowseScope(tx, ctx, query)})
    SELECT bank.id, ${columns('subject')}, ${columns('difficulty')}, ${columns('topic')},
      topic_change.value -> 'valueIds' AS "topicValues"
    FROM bank ${join('subject')} ${join('difficulty')} ${join('topic')}
  `;
}

/** Parse a producing version and its category label into an exact drill-down bucket. */
export function parseOverviewCategory(row: Record<string, unknown>): EnrichmentOverviewBucket {
  if (
    !isCanonicalUuid(row.versionId) || typeof row.version !== 'number' ||
    !Number.isSafeInteger(row.version) || row.version < 1 ||
    typeof row.id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(row.id) ||
    typeof row.label !== 'string' || !row.label.trim() || row.label.length > 80 ||
    typeof row.audience !== 'string' || !row.audience.trim() || row.audience.length > 1000
  ) {
    throw new Error('Invalid enrichment overview category.');
  }
  const filter = {
    kind: 'value',
    versionId: row.versionId,
    valueId: row.id,
    freshness: 'any',
  } as const;
  return {
    key: overviewBucketKey(filter),
    filter,
    category: { label: row.label, version: row.version, audience: row.audience },
  };
}

/** Stable internal category identity, independent of URL encoding. */
export function overviewBucketKey(filter: BankEnrichmentValueFilter): string {
  return filter.kind === 'value' ? JSON.stringify([filter.versionId, filter.valueId]) : filter.kind;
}

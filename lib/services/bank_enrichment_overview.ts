import { sql } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import type { RequestContext } from '../tenants.ts';
import { ENRICHMENT_DIMENSIONS } from './bank_enrichment_contract.ts';
import type {
  EnrichmentBrowseScheme,
  EnrichmentOverview,
  EnrichmentOverviewBucket,
} from './bank_enrichment_browse_contract.ts';
import { ENRICHMENT_VOCABULARY_KEYS } from './bank_enrichment_query_sql.ts';
import type { QuestionBankQuery } from './question_bank_query.ts';
import {
  type EnrichmentOverviewGroup,
  loadEnrichmentOverviewGroups,
  overviewBucketKey,
  parseOverviewCategory,
} from './bank_enrichment_overview_sql.ts';
import { loadEnrichmentOverviewTopics } from './bank_enrichment_overview_topics.ts';

/** Whole-selection aggregates and versioned labels share the authorized browse snapshot. */
export async function loadEnrichmentOverview(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  query: QuestionBankQuery,
  scheme: EnrichmentBrowseScheme,
): Promise<EnrichmentOverview> {
  const [groups, topicGroups] = await Promise.all([
    loadEnrichmentOverviewGroups(tx, ctx, query, scheme.id),
    loadEnrichmentOverviewTopics(tx, ctx, query, scheme.id),
  ]);
  const [subjects, columns] = await Promise.all([
    loadBuckets(tx, ctx, query, scheme, groups, 'subject'),
    loadBuckets(tx, ctx, query, scheme, groups, 'difficulty'),
  ]);
  const counts = new Map<string, number>();
  for (const group of groups) {
    counts.set(
      cellKey(overviewBucketKey(group.subject), overviewBucketKey(group.difficulty)),
      group.count,
    );
  }
  const rows = subjects.map((bucket) => {
    const row = columns.map((column) => counts.get(cellKey(bucket.key, column.key)) ?? 0);
    const topics = new Map<
      string,
      { bucket: EnrichmentOverviewBucket; counts: number[]; total: number }
    >();
    for (const group of topicGroups) {
      if (overviewBucketKey(group.subject) !== bucket.key) continue;
      const index = columns.findIndex((column) =>
        column.key === overviewBucketKey(group.difficulty)
      );
      if (index < 0) throw new Error('Missing topic difficulty column.');
      let topic = topics.get(group.topic.key);
      if (!topic) {
        topic = { bucket: group.topic, counts: columns.map(() => 0), total: 0 };
        topics.set(group.topic.key, topic);
      }
      topic.counts[index] += group.count;
      topic.total += group.count;
    }
    return {
      bucket,
      counts: row,
      total: row.reduce((sum, value) => sum + value, 0),
      topics: [...topics.values()],
    };
  });
  return {
    columns,
    rows,
    statuses: statusCounts(groups),
    totals: columns.map((_, index) => rows.reduce((sum, row) => sum + row.counts[index], 0)),
    total: rows.reduce((sum, row) => sum + row.total, 0),
  };
}

async function loadBuckets(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  query: QuestionBankQuery,
  scheme: EnrichmentBrowseScheme,
  groups: readonly EnrichmentOverviewGroup[],
  dimension: 'subject' | 'difficulty',
): Promise<readonly EnrichmentOverviewBucket[]> {
  const selected = query.enrichment?.[dimension];
  const present = new Map(
    groups.map((group) => [overviewBucketKey(group[dimension]), group[dimension]]),
  );
  const missing: EnrichmentOverviewBucket[] = [];
  for (const kind of ['unassigned', 'pending', 'outside'] as const) {
    if (present.has(kind)) {
      missing.push({ key: kind, filter: { kind, freshness: 'any' }, category: null });
    }
  }
  if (selected && selected.kind !== 'value' && selected.kind !== 'unconstrained') return missing;

  const identities = [...present.values()].flatMap((filter) =>
    filter.kind === 'value' ? [{ versionId: filter.versionId, valueId: filter.valueId }] : []
  );
  const selection = selected?.kind === 'value'
    ? sql`ev.id = ${selected.versionId} AND category ->> 'id' = ${selected.valueId}`
    : sql`(ev.id = ${scheme.versionId} OR EXISTS (
      SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(identities)}::jsonb)
        AS present("versionId" uuid, "valueId" text)
      WHERE present."versionId" = ev.id AND present."valueId" = category ->> 'id'
    ))`;
  const categories = await tx.execute<{
    versionId: string;
    version: number;
    audience: string;
    id: string;
    label: string;
  }>(sql`
    SELECT ev.id AS "versionId", ev.version, ev.definition ->> 'audience' AS audience,
      category ->> 'id' AS id, category ->> 'label' AS label
    FROM bank_enrichment_scheme_versions ev
    CROSS JOIN LATERAL jsonb_array_elements(ev.definition -> ${
      ENRICHMENT_VOCABULARY_KEYS[dimension]
    })
      WITH ORDINALITY vocab(category, position)
    WHERE ev.tenant_id = ${ctx.tenantId} AND ev.scheme_id = ${scheme.id} AND ${selection}
    ORDER BY ev.version DESC, position
  `);
  const values = categories.map(parseOverviewCategory);
  const buckets = [...values, ...missing];
  const loaded = new Set(buckets.map((bucket) => bucket.key));
  for (const key of present.keys()) {
    if (!loaded.has(key)) throw new Error('Missing overview category.');
  }
  return buckets;
}

function statusCounts(groups: readonly EnrichmentOverviewGroup[]): EnrichmentOverview['statuses'] {
  const counts = {
    subject: { unassigned: 0, pending: 0, outside: 0, outdated: 0 },
    topic: { unassigned: 0, pending: 0, outside: 0, outdated: 0 },
    difficulty: { unassigned: 0, pending: 0, outside: 0, outdated: 0 },
  };
  for (const group of groups) {
    for (const dimension of ['subject', 'difficulty'] as const) {
      const kind = group[dimension].kind;
      if (kind === 'unassigned' || kind === 'pending' || kind === 'outside') {
        counts[dimension][kind] += group.count;
      }
    }
    counts.subject.outdated += group.subjectOutdated;
    counts.difficulty.outdated += group.difficultyOutdated;
    counts.topic.outdated += group.topicOutdated;
    counts.topic.unassigned += group.topicUnassigned;
    counts.topic.pending += group.topicPending;
    counts.topic.outside += group.topicOutside;
  }
  return ENRICHMENT_DIMENSIONS.flatMap((dimension) =>
    (['unassigned', 'pending', 'outside', 'outdated'] as const).flatMap((kind) =>
      counts[dimension][kind] > 0 ? [{ dimension, kind, count: counts[dimension][kind] }] : []
    )
  );
}

function cellKey(subject: string, difficulty: string): string {
  return JSON.stringify([subject, difficulty]);
}

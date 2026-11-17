import { bankEnrichmentDifficultyRank } from './bank_enrichment_query_sql.ts';
import { DOMParser } from '@xmldom/xmldom';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, type DbReadConnection, type QflowDatabase } from '../db.ts';
import { questionReviewRequests, questionRevisions, questions, users } from '../db/schema.ts';
import {
  parseQuestionCompatibility,
  QUESTION_LIFECYCLE_STATES,
  type QuestionLifecycleState,
  type QuestionReviewFacetState,
} from '../question_bank.ts';
import { parseTimestamp } from '../persistence_parse.ts';
import { normalizeStandardCollection } from '../standards.ts';
import {
  isQuestionTypeId,
  labelForTypeId,
  QUESTION_TYPE_IDS,
  type QuestionTypeId,
} from '../types/registry.ts';
import type { RequestContext } from '../tenants.ts';
import { listSelectableAssessmentExportTargets } from '../export/assessment_export_targets.ts';
import {
  QUESTION_BANK_ORIGINS,
  QUESTION_BANK_REVIEW_FACETS,
  type QuestionBankQuery,
} from './question_bank_query.ts';
import { questionBankConditions } from './question_bank_scope.ts';
import { questionDuplicateCountSql } from './question_bank_sql.ts';
import { normalizeQuestionBankTags } from './question_bank_tags.ts';
import type { InterfaceLocale } from '../i18n/locale.ts';

type QuestionBankItem = {
  readonly id: string;
  readonly title: string;
  readonly excerpt?: string;
  readonly tags: readonly string[];
  readonly type: QuestionTypeId;
  readonly typeLabel: string;
  readonly standards: readonly { readonly id: string; readonly label: string }[];
  readonly origin: 'Authored' | 'Imported' | 'Variant';
  readonly owner: { readonly userId: string; readonly label: string };
  readonly lifecycle: QuestionLifecycleState;
  readonly reviewState: QuestionReviewFacetState;
  readonly revision: number;
  readonly updatedAt: string;
  readonly duplicateCount: number;
  readonly compatibility: ReturnType<typeof parseQuestionCompatibility>;
};

type QuestionBankFacets = {
  readonly tags: readonly string[];
  readonly standards: readonly { readonly id: string; readonly label: string }[];
  readonly owners: readonly { readonly userId: string; readonly label: string }[];
  readonly types: readonly { readonly id: QuestionTypeId; readonly label: string }[];
  readonly targets: ReturnType<typeof listSelectableAssessmentExportTargets>;
};

/** Selection totals and filter choices, independent of pagination or page presentation. */
export type QuestionBankSummary = {
  readonly facets: QuestionBankFacets;
  readonly total: number;
};

export type QuestionBankPage = QuestionBankSummary & {
  readonly items: readonly QuestionBankItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
};

export type QuestionBankItemDetail = QuestionBankItem & {
  readonly duplicateItems: readonly { readonly id: string; readonly title: string }[];
  readonly duplicateItemCount: number;
};

const FACET_LIMIT = 200;
const DUPLICATE_PREVIEW_LIMIT = 10;

/** Request-scoped presentation inputs for user-visible question-bank facets. */
export type QuestionBankFacetPresentation = Readonly<{
  locale: InterfaceLocale;
  typeLabel?: (type: QuestionTypeId) => string;
}>;

/** Sort a localized facet by label, then its stable identifier. */
export function sortQuestionBankFacet<T extends { readonly id: string; readonly label: string }>(
  values: readonly T[],
  collator: Intl.Collator,
): T[] {
  return [...values].sort((a, b) =>
    collator.compare(a.label, b.label) || compareStableValue(a.id, b.id)
  );
}

function compareStableValue(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Lists a tenant bank with SQL-side filtering, pagination, duplicate counts, and bounded facets. */
export async function listQuestionBank(
  ctx: RequestContext,
  query: QuestionBankQuery,
  presentation: QuestionBankFacetPresentation = { locale: 'en-US' },
  connection: Pick<QflowDatabase, 'select' | 'selectDistinct' | 'execute'> = db,
): Promise<QuestionBankPage> {
  const latest = alias(questionRevisions, 'bank_latest_revision');
  const first = alias(questionRevisions, 'bank_first_revision');
  const conditions = questionBankConditions(ctx, query, latest, first);
  const reviewState = sql<string>`COALESCE(${questionReviewRequests.state}, 'not_requested')`;
  const sortColumns = {
    title: sql`lower(${questions.title})`,
    type: sql`${latest.body} ->> 'type'`,
    origin: sql`${first.provenance} -> 'origin' ->> '_tag'`,
    review: reviewState,
    owner: sql`lower(COALESCE(NULLIF(${users.displayName}, ''), ${users.email}))`,
    revision: latest.revision,
    updated: questions.updatedAt,
  };
  if (query.sort?.field === 'difficulty' && !query.enrichment) {
    throw new Error('Difficulty sorting requires a category set.');
  }
  const difficultyRank = query.sort?.field === 'difficulty' && query.enrichment
    ? bankEnrichmentDifficultyRank(ctx.tenantId, query.enrichment.schemeId, questions.id)
    : null;
  const ordering = difficultyRank
    ? [
      sql`${difficultyRank.version} DESC NULLS LAST`,
      sql`${difficultyRank.position} ${
        query.sort?.direction === 'desc' ? sql`DESC` : sql`ASC`
      } NULLS LAST`,
      asc(questions.id),
    ]
    : query.sort && query.sort.field !== 'difficulty'
    ? [
      (query.sort.direction === 'asc' ? asc : desc)(sortColumns[query.sort.field]),
      asc(questions.id),
    ]
    : query.collection?._tag === 'Collection'
    ? [
      asc(sql`(SELECT filing.position FROM bank_collection_items filing
        WHERE filing.tenant_id = ${ctx.tenantId}
          AND filing.collection_id = ${query.collection.collectionId}
          AND filing.question_id = ${questions.id})`),
      asc(questions.id),
    ]
    : [desc(questions.updatedAt), asc(questions.id)];
  const offset = (query.page - 1) * query.pageSize;
  const base = connection.select({
    id: questions.id,
    title: questions.title,
    tags: questions.tags,
    ownerUserId: questions.ownerUserId,
    ownerEmail: users.email,
    ownerDisplayName: users.displayName,
    lifecycle: questions.lifecycleState,
    updatedAt: questions.updatedAt,
    revision: latest.revision,
    body: latest.body,
    compatibility: latest.compatibility,
    origin: sql<string>`${first.provenance} -> 'origin' ->> '_tag'`,
    reviewState,
    contentHash: latest.contentHash,
  })
    .from(questions)
    .innerJoin(latest, eq(latest.id, questions.latestRevisionId))
    .innerJoin(first, and(eq(first.questionId, questions.id), eq(first.revision, 1)))
    .innerJoin(users, eq(users.id, questions.ownerUserId))
    .leftJoin(
      questionReviewRequests,
      and(
        eq(questionReviewRequests.revisionId, latest.id),
        eq(questionReviewRequests.tenantId, ctx.tenantId),
      ),
    )
    .where(and(...conditions)).$dynamic();
  const ranked = difficultyRank ? base.leftJoin(difficultyRank.source, sql`true`) : base;
  const [rows, summary] = await Promise.all([
    ranked.orderBy(...ordering).limit(query.pageSize).offset(
      offset,
    ),
    summarizeQuestionBank(ctx, query, presentation, connection),
  ]);
  const hashes = [...new Set(rows.map((row) => row.contentHash))];
  const duplicates = hashes.length
    ? await connection.select({ hash: latest.contentHash, total: count() })
      .from(questions)
      .innerJoin(latest, eq(latest.id, questions.latestRevisionId))
      .where(
        and(
          eq(questions.tenantId, ctx.tenantId),
          eq(questions.lifecycleState, 'active'),
          inArray(latest.contentHash, hashes),
        ),
      )
      .groupBy(latest.contentHash)
    : [];
  const duplicateCounts = new Map(duplicates.map((row) => [row.hash, Number(row.total)]));
  // Archived questions may have no active match, so their hash has no grouped count row.
  return {
    ...summary,
    items: rows.map((row) =>
      mapBankItem({ ...row, duplicateCount: duplicateCounts.get(row.contentHash) ?? 0 })
    ),
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(summary.total / query.pageSize)),
  };
}

/** Count the selection and load bounded facets without fetching question bodies. */
export async function summarizeQuestionBank(
  ctx: RequestContext,
  query: QuestionBankQuery,
  presentation: QuestionBankFacetPresentation,
  connection: Pick<QflowDatabase, 'select' | 'selectDistinct' | 'execute'>,
): Promise<QuestionBankSummary> {
  const latest = alias(questionRevisions, 'bank_latest_revision');
  const first = alias(questionRevisions, 'bank_first_revision');
  const conditions = questionBankConditions(ctx, query, latest, first);
  const [totals, facets] = await Promise.all([
    connection.select({ value: count() })
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
      .where(and(...conditions)),
    loadQuestionBankFacets(ctx, query.lifecycle, presentation, connection),
  ]);
  return { facets, total: Number(totals[0]?.value ?? 0) };
}

/** Loads one bank item and its exact semantic duplicates without falling back to title matching. */
export async function getQuestionBankItemDetail(
  ctx: RequestContext,
  questionId: string,
  conn: DbReadConnection = db,
): Promise<QuestionBankItemDetail | null> {
  const latest = alias(questionRevisions, 'detail_latest_revision');
  const first = alias(questionRevisions, 'detail_first_revision');
  const reviewState = sql<string>`COALESCE(${questionReviewRequests.state}, 'not_requested')`;
  const duplicateCount = questionDuplicateCountSql(ctx.tenantId, latest.contentHash);
  const rows = await conn.select({
    id: questions.id,
    title: questions.title,
    tags: questions.tags,
    ownerUserId: questions.ownerUserId,
    ownerEmail: users.email,
    ownerDisplayName: users.displayName,
    lifecycle: questions.lifecycleState,
    updatedAt: questions.updatedAt,
    revision: latest.revision,
    body: latest.body,
    compatibility: latest.compatibility,
    contentHash: latest.contentHash,
    origin: sql<string>`${first.provenance} -> 'origin' ->> '_tag'`,
    reviewState,
    duplicateCount,
  }).from(questions)
    .innerJoin(latest, eq(latest.id, questions.latestRevisionId))
    .innerJoin(first, and(eq(first.questionId, questions.id), eq(first.revision, 1)))
    .innerJoin(users, eq(users.id, questions.ownerUserId))
    .leftJoin(
      questionReviewRequests,
      and(
        eq(questionReviewRequests.revisionId, latest.id),
        eq(questionReviewRequests.tenantId, ctx.tenantId),
      ),
    )
    .where(and(eq(questions.id, questionId), eq(questions.tenantId, ctx.tenantId)))
    .limit(1);
  if (!rows.length) return null;
  const duplicateLatest = alias(questionRevisions, 'duplicate_latest_revision');
  const duplicateItems = await conn.select({ id: questions.id, title: questions.title })
    .from(questions)
    .innerJoin(duplicateLatest, eq(duplicateLatest.id, questions.latestRevisionId))
    .where(and(
      eq(questions.tenantId, ctx.tenantId),
      eq(questions.lifecycleState, 'active'),
      eq(duplicateLatest.contentHash, rows[0].contentHash),
      sql`${questions.id} <> ${questionId}`,
    ))
    .orderBy(questions.title, questions.id)
    .limit(DUPLICATE_PREVIEW_LIMIT);
  const detail = mapBankItem(rows[0]);
  const duplicateItemCount = Math.max(
    0,
    detail.duplicateCount - (detail.lifecycle === 'active' ? 1 : 0),
  );
  return { ...detail, duplicateItems, duplicateItemCount };
}

async function loadQuestionBankFacets(
  ctx: RequestContext,
  lifecycle: QuestionLifecycleState,
  presentation: QuestionBankFacetPresentation,
  connection: Pick<QflowDatabase, 'select' | 'selectDistinct' | 'execute'>,
): Promise<QuestionBankFacets> {
  const conditions = and(
    eq(questions.tenantId, ctx.tenantId),
    eq(questions.lifecycleState, lifecycle),
  );
  const tagValue = sql<string>`jsonb_array_elements_text(${questions.tags})`;
  const typeValue = sql<string>`${questionRevisions.body} ->> 'type'`;
  const ownerLabel = sql<string>`COALESCE(
    NULLIF(btrim(${users.displayName}), ''),
    ${users.email}
  )`;
  const [tagRows, standardRows, ownerRows, typeRows] = await Promise.all([
    connection.selectDistinct({ value: tagValue }).from(questions).where(conditions).orderBy(
      tagValue,
    )
      .limit(
        FACET_LIMIT,
      ),
    connection.execute<{ readonly id: string; readonly label: string }>(sql`
      SELECT DISTINCT
        standard.value ->> 'standardId' AS id,
        COALESCE(
          NULLIF(standard.value ->> 'label', ''),
          NULLIF(standard.value ->> 'code', ''),
          standard.value ->> 'standardId'
        ) AS label
      FROM ${questions}
      INNER JOIN ${questionRevisions}
        ON ${questionRevisions.id} = ${questions.latestRevisionId}
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(${questionRevisions.body} -> 'standards', '[]'::jsonb)
      ) AS standard(value)
      WHERE ${questions.tenantId} = ${ctx.tenantId}
        AND ${questions.lifecycleState} = ${lifecycle}
        AND NULLIF(standard.value ->> 'standardId', '') IS NOT NULL
      ORDER BY label, id
      LIMIT ${FACET_LIMIT}
    `),
    connection.selectDistinct({
      userId: questions.ownerUserId,
      label: ownerLabel,
    }).from(questions).innerJoin(users, eq(users.id, questions.ownerUserId)).where(conditions)
      .orderBy(ownerLabel, questions.ownerUserId).limit(FACET_LIMIT),
    connection.selectDistinct({ value: typeValue }).from(questions)
      .innerJoin(questionRevisions, eq(questionRevisions.id, questions.latestRevisionId)).where(
        conditions,
      ).orderBy(typeValue).limit(QUESTION_TYPE_IDS.length),
  ]);
  const types = typeRows.flatMap((row) => {
    return isQuestionTypeId(row.value) ? [row.value] : [];
  });
  const collator = new Intl.Collator(presentation.locale);
  const standards = sortQuestionBankFacet(
    standardRows.map((row) => ({ id: row.id, label: row.label })),
    collator,
  );
  const localizedTypes = sortQuestionBankFacet(
    types.map((id) => ({ id, label: presentation.typeLabel?.(id) ?? labelForTypeId(id) })),
    collator,
  );
  return {
    tags: tagRows.map((row) => row.value).sort(),
    standards,
    owners: ownerRows.map((row) => ({ userId: row.userId, label: row.label })),
    types: localizedTypes,
    targets: listSelectableAssessmentExportTargets(),
  };
}

function mapBankItem(row: {
  readonly id: string;
  readonly title: string;
  readonly tags: string[];
  readonly ownerUserId: string;
  readonly ownerEmail: string;
  readonly ownerDisplayName: string | null;
  readonly lifecycle: string;
  readonly updatedAt: Date | null;
  readonly revision: number;
  readonly body: Record<string, unknown>;
  readonly compatibility: Array<Record<string, unknown>>;
  readonly origin: string;
  readonly reviewState: string;
  readonly duplicateCount: number;
}): QuestionBankItem {
  const type = isQuestionTypeId(row.body.type) ? row.body.type : undefined;
  const origin = QUESTION_BANK_ORIGINS.find((candidate) => candidate === row.origin);
  const lifecycle = QUESTION_LIFECYCLE_STATES.find((candidate) => candidate === row.lifecycle);
  const reviewState = QUESTION_BANK_REVIEW_FACETS.find((candidate) =>
    candidate === row.reviewState
  );
  if (!type || !origin || !lifecycle || !reviewState) {
    throw new Error('Question bank row is invalid.');
  }
  return {
    id: row.id,
    title: row.title,
    excerpt: questionBankExcerpt(row.body),
    tags: normalizeQuestionBankTags(row.tags),
    type,
    typeLabel: labelForTypeId(type),
    standards: normalizeStandardCollection(row.body.standards).map((standard) => ({
      id: standard.standardId,
      label: standard.label ?? standard.code ?? standard.standardId,
    })),
    origin,
    owner: {
      userId: row.ownerUserId,
      label: row.ownerDisplayName?.trim() || row.ownerEmail,
    },
    lifecycle,
    reviewState,
    revision: Number(row.revision),
    updatedAt: parseTimestamp(row.updatedAt, 'Question bank timestamp is invalid.'),
    duplicateCount: Number(row.duplicateCount),
    compatibility: parseQuestionCompatibility(row.compatibility),
  };
}

/** Plain question wording only; omit answer choices and mark truncated excerpts. */
/** Plain-text excerpt shared by browsing and bounded selection previews. */
export function questionBankExcerpt(body: Record<string, unknown>): string {
  const text = [body.bodyHtml, body.promptHtml]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((html) =>
      new DOMParser().parseFromString(`<div>${html.replace(/<[^>]*>/g, ' ')}</div>`, 'text/html')
        .documentElement.textContent ?? ''
    )
    .join(' ').replace(/\s+/g, ' ').trim();
  return text.length > 240 ? `${text.slice(0, 237).replace(/\s+\S*$/, '')}…` : text;
}

import { ENRICHMENT_DIMENSIONS } from './bank_enrichment_contract.ts';
import { bankEnrichmentValueSql } from './bank_enrichment_query_sql.ts';
import { eq, ilike, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { questionReviewRequests, questions } from '../db/question_schema.ts';
import { type RequestContext, resolveUserId } from '../tenants.ts';
import type { QuestionBankQuery } from './question_bank_query.ts';

/** Shared SQL predicate for bank pages and complete enrichment scopes. */
export function questionBankConditions(
  ctx: RequestContext,
  query: QuestionBankQuery,
  latest: {
    readonly tenantId: AnyPgColumn;
    readonly body: AnyPgColumn;
    readonly searchText: AnyPgColumn;
    readonly compatibility: AnyPgColumn;
    readonly contentHash: AnyPgColumn;
  },
  first: { readonly tenantId: AnyPgColumn; readonly provenance: AnyPgColumn },
) {
  const conditions = [
    eq(questions.tenantId, ctx.tenantId),
    eq(latest.tenantId, ctx.tenantId),
    eq(first.tenantId, ctx.tenantId),
    eq(questions.lifecycleState, query.lifecycle),
  ];
  if (query.collection) {
    const filed = sql`EXISTS (SELECT 1 FROM bank_collection_items filing
      WHERE filing.tenant_id = ${ctx.tenantId}
        AND filing.question_id = ${questions.id}
        ${
          query.collection._tag === 'Collection'
            ? sql`AND filing.collection_id = ${query.collection.collectionId}`
            : sql``
        })`;
    conditions.push(query.collection._tag === 'Unfiled' ? sql`NOT ${filed}` : filed);
  }
  if (query.enrichment) {
    for (const dimension of ENRICHMENT_DIMENSIONS) {
      const filter = query.enrichment[dimension];
      if (filter) {
        conditions.push(bankEnrichmentValueSql(
          ctx.tenantId,
          query.enrichment.schemeId,
          questions.id,
          questions.latestRevisionId,
          dimension,
          filter,
        ));
      }
    }
  }
  if (query.search) {
    const phrase = `%${query.search}%`;
    conditions.push(ilike(latest.searchText, phrase));
  }
  if (query.tags.length) {
    conditions.push(sql`${questions.tags} @> ${JSON.stringify(query.tags)}::jsonb`);
  }
  if (query.type) conditions.push(sql`${latest.body} ->> 'type' = ${query.type}`);
  if (query.standard) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(${latest.body} -> 'standards', '[]'::jsonb)) s
      WHERE s ->> 'standardId' = ${query.standard}
    )`);
  }
  if (query.origin) {
    conditions.push(sql`${first.provenance} -> 'origin' ->> '_tag' = ${query.origin}`);
  }
  if (query.ownerUserId) conditions.push(eq(questions.ownerUserId, query.ownerUserId));
  if (query.reviewState) {
    conditions.push(
      query.reviewState === 'not_requested'
        ? sql`${questionReviewRequests.id} IS NULL`
        : eq(questionReviewRequests.state, query.reviewState),
    );
  }
  if (query.assignedToMe) {
    conditions.push(eq(questionReviewRequests.reviewerUserId, resolveUserId(ctx)));
  }
  if (query.compatibilityTarget && query.compatibilityOutcome) {
    conditions.push(sql`${latest.compatibility} @> ${
      JSON.stringify([{
        targetId: query.compatibilityTarget,
        outcome: query.compatibilityOutcome,
      }])
    }::jsonb`);
  } else if (query.compatibilityTarget) {
    conditions.push(sql`${latest.compatibility} @> ${
      JSON.stringify([{
        targetId: query.compatibilityTarget,
      }])
    }::jsonb`);
  }
  if (query.duplicatesOnly) {
    conditions.push(sql`${latest.contentHash} IN (
      SELECT duplicate_revision.content_hash
      FROM questions duplicate_question
      JOIN question_revisions duplicate_revision
        ON duplicate_revision.id = duplicate_question.latest_revision_id
      WHERE duplicate_question.tenant_id = ${ctx.tenantId}
        AND duplicate_question.lifecycle_state = 'active'
      GROUP BY duplicate_revision.content_hash
      HAVING COUNT(*) > 1
    )`);
  }
  return conditions;
}

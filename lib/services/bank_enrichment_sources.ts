import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbReadConnection } from '../db.ts';
import { questionRevisions } from '../db/question_schema.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import {
  type EnrichmentInputFailure,
  type EnrichmentQuestion,
  prepareEnrichmentQuestion,
} from './bank_enrichment_input.ts';

/** Pinned content parsed independently from the question's latest revision. */
export type EnrichmentSource = {
  readonly questionId: string;
  readonly revisionId: string;
  readonly content: EnrichmentResult<EnrichmentQuestion, EnrichmentInputFailure>;
};

/** Instructor examples must refer to exact revisions in the current workspace before queuing. */
export async function enrichmentExampleSourcesExist(
  database: DbReadConnection,
  tenantId: string,
  refs: readonly { readonly questionId: string; readonly revisionId: string }[],
): Promise<boolean> {
  if (!refs.length) return true;
  if (refs.length > 20) return false;
  const rows = await database.select({
    id: questionRevisions.id,
    questionId: questionRevisions.questionId,
  })
    .from(questionRevisions).where(
      and(
        eq(questionRevisions.tenantId, tenantId),
        inArray(questionRevisions.id, refs.map((ref) => ref.revisionId)),
      ),
    );
  return refs.every((ref) =>
    rows.some((row) => row.id === ref.revisionId && row.questionId === ref.questionId)
  );
}

/** Read at most twenty source records, avoiding materialization of oversized question bodies. */
export async function loadEnrichmentSources(
  database: DbReadConnection,
  tenantId: string,
  refs: readonly { readonly questionId: string; readonly revisionId: string }[],
): Promise<readonly EnrichmentSource[]> {
  if (!refs.length) return [];
  if (refs.length > 20) throw new Error('Enrichment source batch exceeds twenty items.');
  const rows = await database.select({
    id: questionRevisions.id,
    questionId: questionRevisions.questionId,
    bytes: sql<number>`octet_length(${questionRevisions.body}::text)`.mapWith(Number),
    body: sql<
      unknown
    >`CASE WHEN octet_length(${questionRevisions.body}::text) <= 16384 THEN ${questionRevisions.body} ELSE NULL END`,
  }).from(questionRevisions).where(
    and(
      eq(questionRevisions.tenantId, tenantId),
      inArray(questionRevisions.id, refs.map((r) => r.revisionId)),
    ),
  );
  return refs.map((ref) => {
    const row = rows.find((r) => r.id === ref.revisionId && r.questionId === ref.questionId);
    if (!row) throw new Error('A pinned enrichment revision is missing.');
    return {
      ...ref,
      content: row.bytes > 16384
        ? { ok: false, code: 'input_too_large' }
        : prepareEnrichmentQuestion(ref.questionId, ref.revisionId, row.body),
    };
  });
}

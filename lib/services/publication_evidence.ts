import { and, eq, inArray } from 'drizzle-orm';
import type { DbReadConnection } from '../db.ts';
import { questionReviewRequests, questionRevisions } from '../db/question_schema.ts';
import { parseQuestionProvenanceEntry } from '../question_provenance.ts';
import { projectRevisionEligibility, type RevisionEligibility } from '../publication_evidence.ts';
import { parseTimestamp } from '../persistence_parse.ts';
import type { RequestContext } from '../tenants.ts';
import { hasWorkspaceCapability } from './workspace_authorization.ts';

export type RevisionEligibilityResult =
  | { readonly ok: true; readonly revisions: readonly RevisionEligibility[] }
  | { readonly ok: false; readonly code: 'forbidden' | 'revision_set_unavailable' };

/** Load exact-revision evidence in the caller's authorized snapshot/transaction. Never substitutes latest. */
export async function loadRevisionPublicationEligibility(
  conn: DbReadConnection,
  ctx: RequestContext,
  revisionIds: readonly string[],
): Promise<RevisionEligibilityResult> {
  if (!await hasWorkspaceCapability(ctx, 'view_content', conn)) {
    return { ok: false, code: 'forbidden' };
  }
  if (revisionIds.length === 0) return { ok: true, revisions: [] };
  const rows = await conn.select({ revision: questionRevisions, review: questionReviewRequests })
    .from(questionRevisions)
    .leftJoin(
      questionReviewRequests,
      and(
        eq(questionReviewRequests.tenantId, questionRevisions.tenantId),
        eq(questionReviewRequests.revisionId, questionRevisions.id),
      ),
    )
    .where(
      and(
        eq(questionRevisions.tenantId, ctx.tenantId),
        inArray(questionRevisions.id, [...revisionIds]),
      ),
    );
  if (rows.length !== new Set(revisionIds).size) {
    return { ok: false, code: 'revision_set_unavailable' };
  }
  const origins = await conn.select({
    questionId: questionRevisions.questionId,
    provenance: questionRevisions.provenance,
  }).from(questionRevisions)
    .where(
      and(
        eq(questionRevisions.tenantId, ctx.tenantId),
        eq(questionRevisions.revision, 1),
        inArray(questionRevisions.questionId, rows.map((row) => row.revision.questionId)),
      ),
    );
  const originByQuestion = new Map(origins.map((row) => {
    const initial = parseQuestionProvenanceEntry(row.provenance);
    if (!('origin' in initial)) throw new Error('Initial revision has no origin.');
    return [row.questionId, initial.origin];
  }));
  const revisions = rows.map(({ revision, review }) => {
    const origin = originByQuestion.get(revision.questionId);
    if (!origin) throw new Error('Question origin is missing.');
    const state = review?.state;
    if (
      state !== undefined && state !== 'open' && state !== 'approved' &&
      state !== 'changes_requested'
    ) throw new Error('Invalid persisted review state.');
    return projectRevisionEligibility({
      questionId: revision.questionId,
      revisionId: revision.id,
      revisionAuthorId: parseQuestionProvenanceEntry(revision.provenance).event.author.id,
      intake: origin._tag === 'Imported'
        ? {
          migrationRunId: origin.migrationRunId,
          artifactId: origin.artifact.id,
          contentHash: origin.review.contentHash,
        }
        : null,
      review: review && state
        ? {
          revisionId: review.revisionId,
          requestId: review.id,
          state,
          decidedBy: review.decidedBy,
          decidedAt: review.decidedAt
            ? parseTimestamp(review.decidedAt, 'Invalid review decision timestamp.')
            : null,
          note: review.decisionNote,
        }
        : null,
    });
  });
  return { ok: true, revisions };
}

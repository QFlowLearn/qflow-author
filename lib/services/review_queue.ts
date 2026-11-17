import { and, desc, eq, lt, or } from 'drizzle-orm';
import { db } from '../db.ts';
import { questionReviewRequests, questionRevisions, questions } from '../db/question_schema.ts';
import { users } from '../db/principal_schema.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { hasWorkspaceCapability } from './workspace_authorization.ts';

export const REVIEW_QUEUE_VIEWS = ['assigned', 'open', 'changes_requested', 'closed'] as const;
export type ReviewQueueQuery = {
  readonly view: typeof REVIEW_QUEUE_VIEWS[number];
  readonly before: string | null;
};
export class ReviewQueueInputError extends Error {}
/** Strict, bounded review queue navigation. */
export function parseReviewQueueQuery(params: URLSearchParams): ReviewQueueQuery {
  if (
    [...params.keys()].some((key) => !['view', 'before'].includes(key)) ||
    params.getAll('view').length > 1 || params.getAll('before').length > 1
  ) throw new ReviewQueueInputError();
  const view = REVIEW_QUEUE_VIEWS.find((value) => value === (params.get('view') ?? 'assigned'));
  const before = params.get('before');
  if (!view || (before !== null && !isCanonicalUuid(before))) throw new ReviewQueueInputError();
  return { view, before };
}
/** Only real review requests enter this queue; imports and attestations never create rows. */
export async function loadReviewQueue(ctx: RequestContext, query: ReviewQueueQuery) {
  if (!await hasWorkspaceCapability(ctx, 'view_content', db)) return null;
  const stateByView = {
    assigned: 'open',
    open: 'open',
    changes_requested: 'changes_requested',
    closed: 'approved',
  } as const satisfies Record<ReviewQueueQuery['view'], string>;
  const conditions = [
    eq(questionReviewRequests.tenantId, ctx.tenantId),
    eq(questionReviewRequests.state, stateByView[query.view]),
  ];
  if (query.view === 'assigned') {
    conditions.push(eq(questionReviewRequests.reviewerUserId, ctx.userId));
  }
  if (query.before) {
    const [cursor] = await db.select().from(questionReviewRequests).where(
      and(...conditions, eq(questionReviewRequests.id, query.before)),
    );
    if (!cursor) throw new ReviewQueueInputError();
    conditions.push(
      or(
        lt(questionReviewRequests.requestedAt, cursor.requestedAt),
        and(
          eq(questionReviewRequests.requestedAt, cursor.requestedAt),
          lt(questionReviewRequests.id, cursor.id),
        ),
      )!,
    );
  }
  const rows = await db.select({
    id: questionReviewRequests.id,
    questionId: questionReviewRequests.questionId,
    revision: questionRevisions.revision,
    title: questions.title,
    state: questionReviewRequests.state,
    reason: questionReviewRequests.changeReason,
    reviewer: users.email,
  }).from(questionReviewRequests)
    .innerJoin(questionRevisions, eq(questionRevisions.id, questionReviewRequests.revisionId))
    .innerJoin(questions, eq(questions.id, questionReviewRequests.questionId))
    .innerJoin(users, eq(users.id, questionReviewRequests.reviewerUserId))
    .where(and(...conditions)).orderBy(
      desc(questionReviewRequests.requestedAt),
      desc(questionReviewRequests.id),
    ).limit(51);
  return { rows: rows.slice(0, 50), next: rows.length > 50 ? rows[49].id : null };
}

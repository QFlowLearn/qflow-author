import { approvedReviewEvidence } from '../publication_evidence.ts';
import { parseQuestionProvenanceEntry } from '../question_provenance.ts';
import { lockWorkspaceAndRequireAuthority } from './workspace_authorization.ts';
import { and, desc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { db, type DbReadConnection } from '../db.ts';
import {
  organizationMemberships,
  questionReviewComments,
  questionReviewRequests,
  questionRevisions,
  questions,
  users,
} from '../db/schema.ts';
import { QUESTION_REVIEW_STATES, type QuestionReviewState } from '../question_bank.ts';
import { hasCapability } from '../roles.ts';
import { parseTimestamp } from '../persistence_parse.ts';
import { type RequestContext, resolveUserId } from '../tenants.ts';
import { recordAuditEventInTransaction } from './audit_logs.ts';
import { isCanonicalUuid } from '../uuid.ts';

const REVIEW_REQUEST_PAGE_SIZE = 10;
const REVIEW_COMMENT_PAGE_SIZE = 20;

export type QuestionReviewCommentRecord = {
  readonly id: string;
  readonly author: { readonly userId: string; readonly label: string };
  readonly body: string;
  readonly createdAt: string;
};

export type QuestionReviewRequestRecord = {
  readonly id: string;
  readonly revisionId: string;
  readonly revision: number;
  readonly requestedBy: string;
  readonly reviewer: { readonly userId: string; readonly label: string };
  readonly state: QuestionReviewState;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly decisionNote: string | null;
  readonly changeReason: string | null;
  readonly approvalIndependence: 'self_review' | 'independent_review' | null;
  readonly comments: readonly QuestionReviewCommentRecord[];
  readonly beforeCommentId: string | null;
  readonly nextBeforeCommentId: string | null;
};

export type QuestionReviewWorkspace = {
  readonly questionId: string;
  readonly latestRevisionId: string;
  readonly latestRevision: number;
  readonly requests: readonly QuestionReviewRequestRecord[];
  readonly beforeRevision: number | null;
  readonly nextBeforeRevision: number | null;
};

export type QuestionReviewCommandResult =
  | { readonly ok: true; readonly requestId: string }
  | {
    readonly ok: false;
    readonly code:
      | 'question_not_found'
      | 'forbidden'
      | 'reviewer_not_member'
      | 'review_already_requested'
      | 'review_not_found'
      | 'review_closed'
      | 'reviewer_required'
      | 'invalid_comment'
      | 'decision_note_required'
      | 'invalid_decision_note'
      | 'invalid_reference'
      | 'invalid_change_reason';
    readonly message: string;
  };

/** Raised when a review-comment cursor does not belong to the requested visible thread. */
export class QuestionReviewPageError extends Error {}

/** Loads one bounded page of review threads for a tenant-scoped question. */
export async function getQuestionReviewWorkspace(
  ctx: RequestContext,
  questionId: string,
  options: {
    readonly beforeRevision?: number;
    readonly commentPage?: {
      readonly requestId: string;
      readonly beforeCommentId?: string;
    };
  } = {},
  conn: DbReadConnection = db,
): Promise<QuestionReviewWorkspace | null> {
  if (!isCanonicalUuid(questionId)) return null;
  const question = await conn.select({
    latestRevisionId: questions.latestRevisionId,
    latestRevision: questionRevisions.revision,
  }).from(questions)
    .innerJoin(questionRevisions, eq(questionRevisions.id, questions.latestRevisionId))
    .where(and(eq(questions.id, questionId), eq(questions.tenantId, ctx.tenantId)))
    .limit(1);
  if (!question.length || !question[0].latestRevisionId) return null;
  if (
    options.beforeRevision !== undefined &&
    (!Number.isInteger(options.beforeRevision) || options.beforeRevision < 1)
  ) {
    return null;
  }
  if (
    options.commentPage &&
    (!isCanonicalUuid(options.commentPage.requestId) ||
      (options.commentPage.beforeCommentId !== undefined &&
        !isCanonicalUuid(options.commentPage.beforeCommentId)))
  ) {
    throw new QuestionReviewPageError('Comment pagination is invalid.');
  }
  const requestConditions = [
    eq(questionReviewRequests.questionId, questionId),
    eq(questionReviewRequests.tenantId, ctx.tenantId),
  ];
  if (options.beforeRevision !== undefined) {
    requestConditions.push(lt(questionRevisions.revision, options.beforeRevision));
  }
  const requestPage = await conn.select({
    id: questionReviewRequests.id,
    revisionId: questionReviewRequests.revisionId,
    revision: questionRevisions.revision,
    provenance: questionRevisions.provenance,
    requestedBy: questionReviewRequests.requestedBy,
    reviewerUserId: questionReviewRequests.reviewerUserId,
    reviewerEmail: users.email,
    reviewerDisplayName: users.displayName,
    state: questionReviewRequests.state,
    requestedAt: questionReviewRequests.requestedAt,
    decidedAt: questionReviewRequests.decidedAt,
    decidedBy: questionReviewRequests.decidedBy,
    decisionNote: questionReviewRequests.decisionNote,
    changeReason: questionReviewRequests.changeReason,
  }).from(questionReviewRequests)
    .innerJoin(questionRevisions, eq(questionRevisions.id, questionReviewRequests.revisionId))
    .innerJoin(users, eq(users.id, questionReviewRequests.reviewerUserId))
    .where(and(...requestConditions))
    .orderBy(desc(questionRevisions.revision), desc(questionReviewRequests.id))
    .limit(REVIEW_REQUEST_PAGE_SIZE + 1);
  const hasOlderRequests = requestPage.length > REVIEW_REQUEST_PAGE_SIZE;
  const requests = requestPage.slice(0, REVIEW_REQUEST_PAGE_SIZE);
  const requestIds = requests.map((request) => request.id);
  const comments = requestIds.length
    ? await loadRecentReviewComments(conn, ctx.tenantId, requestIds)
    : [];
  const commentsByRequest = Map.groupBy(comments, (comment) => comment.reviewRequestId);
  const selectedRequest = options.commentPage
    ? requests.find((request) => request.id === options.commentPage?.requestId)
    : undefined;
  if (options.commentPage && !selectedRequest) {
    throw new QuestionReviewPageError('The selected review thread is not on this page.');
  }
  const selectedCommentPage = selectedRequest && options.commentPage?.beforeCommentId
    ? await loadReviewCommentPage(
      conn,
      ctx.tenantId,
      selectedRequest.id,
      options.commentPage.beforeCommentId,
    )
    : null;
  return {
    questionId,
    latestRevisionId: question[0].latestRevisionId,
    latestRevision: Number(question[0].latestRevision),
    requests: requests.map((request) => {
      const recentComments = commentsByRequest.get(request.id) ?? [];
      const recentPage = recentComments.slice(0, REVIEW_COMMENT_PAGE_SIZE).reverse();
      const page = request.id === selectedRequest?.id && selectedCommentPage
        ? selectedCommentPage.comments
        : recentPage;
      const hasEarlierComments = selectedCommentPage
        ? selectedCommentPage.hasEarlier
        : recentComments.length > REVIEW_COMMENT_PAGE_SIZE;
      return {
        id: request.id,
        revisionId: request.revisionId,
        revision: Number(request.revision),
        requestedBy: request.requestedBy,
        reviewer: {
          userId: request.reviewerUserId,
          label: request.reviewerDisplayName?.trim() || request.reviewerEmail,
        },
        state: parseReviewState(request.state),
        requestedAt: parseTimestamp(request.requestedAt, 'Review request timestamp is invalid.'),
        decidedAt: request.decidedAt
          ? parseTimestamp(request.decidedAt, 'Review decision timestamp is invalid.')
          : null,
        decidedBy: request.decidedBy ?? null,
        decisionNote: request.decisionNote ?? null,
        changeReason: request.changeReason,
        approvalIndependence: request.state !== 'approved' ? null : approvedReviewEvidence(
          parseQuestionProvenanceEntry(request.provenance).event.author.id,
          {
            revisionId: request.revisionId,
            requestId: request.id,
            state: 'approved',
            decidedBy: request.decidedBy,
            decidedAt: request.decidedAt
              ? parseTimestamp(request.decidedAt, 'Review decision timestamp is invalid.')
              : null,
            note: request.decisionNote,
          },
        ).independence,
        comments: page.map(mapReviewComment),
        beforeCommentId: request.id === selectedRequest?.id
          ? options.commentPage?.beforeCommentId ?? null
          : null,
        nextBeforeCommentId: hasEarlierComments ? page[0]?.id ?? null : null,
      };
    }),
    beforeRevision: options.beforeRevision ?? null,
    nextBeforeRevision: hasOlderRequests ? requests.at(-1)?.revision ?? null : null,
  };
}

/** Opens one review request against the latest immutable revision. */
export async function requestQuestionReview(
  ctx: RequestContext,
  questionId: string,
  reviewerUserId: string,
  changeReason: string,
): Promise<QuestionReviewCommandResult> {
  if (!hasCapability(ctx.role, 'manage_content')) return failure('forbidden');
  if (!isCanonicalUuid(questionId) || !isCanonicalUuid(reviewerUserId)) {
    return failure('invalid_reference');
  }
  const reason = changeReason.trim();
  if (reason.length > 4000) return failure('invalid_change_reason');
  return await db.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
      return failure('forbidden');
    }
    const question = await tx.select({
      latestRevisionId: questions.latestRevisionId,
    }).from(questions).where(and(
      eq(questions.id, questionId),
      eq(questions.tenantId, ctx.tenantId),
    )).for('update').limit(1);
    if (!question.length || !question[0].latestRevisionId) return failure('question_not_found');
    const membership = await tx.select({ id: organizationMemberships.id })
      .from(organizationMemberships).where(and(
        eq(organizationMemberships.tenantId, ctx.tenantId),
        eq(organizationMemberships.userId, reviewerUserId),
      )).limit(1);
    if (!membership.length) return failure('reviewer_not_member');
    const existing = await tx.select({ id: questionReviewRequests.id })
      .from(questionReviewRequests).where(and(
        eq(questionReviewRequests.tenantId, ctx.tenantId),
        eq(questionReviewRequests.revisionId, question[0].latestRevisionId),
      )).limit(1);
    if (existing.length) return failure('review_already_requested');
    const requestId = crypto.randomUUID();
    const actor = resolveUserId(ctx);
    await tx.insert(questionReviewRequests).values({
      id: requestId,
      tenantId: ctx.tenantId,
      questionId,
      revisionId: question[0].latestRevisionId,
      requestedBy: actor,
      reviewerUserId,
      state: 'open',
      changeReason: reason || null,
    });
    await recordAuditEventInTransaction(tx, {
      tenantId: ctx.tenantId,
      actorUserId: actor,
      targetUserId: reviewerUserId,
      action: 'question_review.requested',
      metadata: { questionId, revisionId: question[0].latestRevisionId, requestId },
    });
    return { ok: true, requestId };
  });
}

/** Adds one immutable comment to a tenant-scoped review thread. */
export async function addQuestionReviewComment(
  ctx: RequestContext,
  questionId: string,
  requestId: string,
  input: string,
): Promise<QuestionReviewCommandResult> {
  if (!isCanonicalUuid(questionId) || !isCanonicalUuid(requestId)) {
    return failure('invalid_reference');
  }
  const body = input.trim();
  if (!body || body.length > 4000) return failure('invalid_comment');
  return await db.transaction(async (tx) => {
    if (
      !await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })
    ) return failure('forbidden');
    const request = await tx.select({ id: questionReviewRequests.id })
      .from(questionReviewRequests).where(and(
        eq(questionReviewRequests.id, requestId),
        eq(questionReviewRequests.questionId, questionId),
        eq(questionReviewRequests.tenantId, ctx.tenantId),
      )).limit(1);
    if (!request.length) return failure('review_not_found');
    const commentId = crypto.randomUUID();
    const actor = resolveUserId(ctx);
    await tx.insert(questionReviewComments).values({
      id: commentId,
      tenantId: ctx.tenantId,
      reviewRequestId: requestId,
      authorUserId: actor,
      body,
    });
    await recordAuditEventInTransaction(tx, {
      tenantId: ctx.tenantId,
      actorUserId: actor,
      action: 'question_review.commented',
      metadata: { questionId, requestId, commentId },
    });
    return { ok: true, requestId };
  });
}

/** Records the assigned reviewer's final decision for the exact requested revision. */
export async function decideQuestionReview(
  ctx: RequestContext,
  questionId: string,
  requestId: string,
  decision: Exclude<QuestionReviewState, 'open'>,
  noteInput: string | null,
): Promise<QuestionReviewCommandResult> {
  if (!isCanonicalUuid(questionId) || !isCanonicalUuid(requestId)) {
    return failure('invalid_reference');
  }
  const note = noteInput?.trim() || null;
  if (decision === 'changes_requested' && !note) return failure('decision_note_required');
  if (note && note.length > 4000) return failure('invalid_decision_note');
  return await db.transaction(async (tx) => {
    if (
      !await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })
    ) return failure('forbidden');
    const request = await tx.select({
      id: questionReviewRequests.id,
      reviewerUserId: questionReviewRequests.reviewerUserId,
      state: questionReviewRequests.state,
      revisionId: questionReviewRequests.revisionId,
    }).from(questionReviewRequests).where(and(
      eq(questionReviewRequests.id, requestId),
      eq(questionReviewRequests.questionId, questionId),
      eq(questionReviewRequests.tenantId, ctx.tenantId),
    )).for('update').limit(1);
    if (!request.length) return failure('review_not_found');
    if (request[0].state !== 'open') return failure('review_closed');
    const actor = resolveUserId(ctx);
    if (request[0].reviewerUserId !== actor) return failure('reviewer_required');
    const now = new Date();
    await tx.update(questionReviewRequests).set({
      state: decision,
      decidedAt: now,
      decidedBy: actor,
      decisionNote: note,
      updatedAt: now,
    }).where(and(
      eq(questionReviewRequests.id, requestId),
      eq(questionReviewRequests.tenantId, ctx.tenantId),
    ));
    await recordAuditEventInTransaction(tx, {
      tenantId: ctx.tenantId,
      actorUserId: actor,
      action: decision === 'approved'
        ? 'question_review.approved'
        : 'question_review.changes_requested',
      metadata: { questionId, requestId, revisionId: request[0].revisionId },
    });
    return { ok: true, requestId };
  });
}

function parseReviewState(value: string): QuestionReviewState {
  const parsed = QUESTION_REVIEW_STATES.find((candidate) => candidate === value);
  if (!parsed) throw new Error('Review state is invalid.');
  return parsed;
}

function failure(
  code: Exclude<QuestionReviewCommandResult, { ok: true }>['code'],
): QuestionReviewCommandResult {
  const messages: Record<typeof code, string> = {
    question_not_found: 'Item not found.',
    forbidden: 'You cannot request an item review.',
    reviewer_not_member: 'Choose a current workspace member.',
    review_already_requested: 'This revision already has a review request.',
    review_not_found: 'Review request not found.',
    review_closed: 'This review is already closed.',
    reviewer_required: 'Only the assigned reviewer can decide this request.',
    invalid_change_reason: 'Explain the change in 1 to 4,000 characters.',
    invalid_comment: 'Enter a comment between 1 and 4,000 characters.',
    decision_note_required: 'Explain what needs to change.',
    invalid_decision_note: 'Keep the decision note to 4,000 characters or fewer.',
    invalid_reference: 'The item or review request is invalid.',
  };
  return { ok: false, code, message: messages[code] };
}

type RankedReviewComment = {
  readonly id: string;
  readonly reviewRequestId: string;
  readonly authorUserId: string;
  readonly authorEmail: string;
  readonly authorDisplayName: string | null;
  readonly body: string;
  readonly createdAt: Date | string;
};

function mapReviewComment(comment: RankedReviewComment): QuestionReviewCommentRecord {
  return {
    id: comment.id,
    author: {
      userId: comment.authorUserId,
      label: comment.authorDisplayName?.trim() || comment.authorEmail,
    },
    body: comment.body,
    createdAt: parseTimestamp(comment.createdAt, 'Review comment timestamp is invalid.'),
  };
}

async function loadReviewCommentPage(
  conn: DbReadConnection,
  tenantId: string,
  requestId: string,
  beforeCommentId: string,
): Promise<{ readonly comments: readonly RankedReviewComment[]; readonly hasEarlier: boolean }> {
  const cursor = await conn.select({ createdAt: questionReviewComments.createdAt })
    .from(questionReviewComments)
    .where(and(
      eq(questionReviewComments.id, beforeCommentId),
      eq(questionReviewComments.reviewRequestId, requestId),
      eq(questionReviewComments.tenantId, tenantId),
    ))
    .limit(1);
  if (!cursor.length) throw new QuestionReviewPageError('Comment pagination is invalid.');
  const rows = await conn.select({
    id: questionReviewComments.id,
    reviewRequestId: questionReviewComments.reviewRequestId,
    authorUserId: questionReviewComments.authorUserId,
    authorEmail: users.email,
    authorDisplayName: users.displayName,
    body: questionReviewComments.body,
    createdAt: questionReviewComments.createdAt,
  })
    .from(questionReviewComments)
    .innerJoin(users, eq(users.id, questionReviewComments.authorUserId))
    .where(and(
      eq(questionReviewComments.reviewRequestId, requestId),
      eq(questionReviewComments.tenantId, tenantId),
      or(
        lt(questionReviewComments.createdAt, cursor[0].createdAt),
        and(
          eq(questionReviewComments.createdAt, cursor[0].createdAt),
          lt(questionReviewComments.id, beforeCommentId),
        ),
      ),
    ))
    .orderBy(desc(questionReviewComments.createdAt), desc(questionReviewComments.id))
    .limit(REVIEW_COMMENT_PAGE_SIZE + 1);
  const hasEarlier = rows.length > REVIEW_COMMENT_PAGE_SIZE;
  const comments = rows.slice(0, REVIEW_COMMENT_PAGE_SIZE).reverse();
  return { comments, hasEarlier };
}

async function loadRecentReviewComments(
  conn: DbReadConnection,
  tenantId: string,
  requestIds: readonly string[],
): Promise<RankedReviewComment[]> {
  const rankedComments = conn.select({
    id: questionReviewComments.id,
    reviewRequestId: questionReviewComments.reviewRequestId,
    authorUserId: questionReviewComments.authorUserId,
    authorEmail: users.email,
    authorDisplayName: users.displayName,
    body: questionReviewComments.body,
    createdAt: questionReviewComments.createdAt,
    commentRank: sql<number>`row_number() over (
      partition by ${questionReviewComments.reviewRequestId}
      order by ${questionReviewComments.createdAt} desc, ${questionReviewComments.id} desc
    )`.as('comment_rank'),
  })
    .from(questionReviewComments)
    .innerJoin(users, eq(users.id, questionReviewComments.authorUserId))
    .where(and(
      eq(questionReviewComments.tenantId, tenantId),
      inArray(questionReviewComments.reviewRequestId, [...requestIds]),
    ))
    .as('ranked_review_comments');

  return await conn.select({
    id: rankedComments.id,
    reviewRequestId: rankedComments.reviewRequestId,
    authorUserId: rankedComments.authorUserId,
    authorEmail: rankedComments.authorEmail,
    authorDisplayName: rankedComments.authorDisplayName,
    body: rankedComments.body,
    createdAt: rankedComments.createdAt,
  })
    .from(rankedComments)
    .where(lte(rankedComments.commentRank, REVIEW_COMMENT_PAGE_SIZE + 1))
    .orderBy(
      rankedComments.reviewRequestId,
      desc(rankedComments.createdAt),
      desc(rankedComments.id),
    );
}

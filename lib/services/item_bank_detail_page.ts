import {
  type ItemDetailQuery,
  ItemDetailQueryError,
  parseItemDetailQuery,
} from '../item_detail_query.ts';
import { organizationMemberships } from '../db/schema.ts';
import { and, eq } from 'drizzle-orm';
import { hasCapability, parseRole } from '../roles.ts';
import { compareQuestionRevisionSnapshots } from '../question_version_comparison.ts';
import { getQuestionBankItemDetail, type QuestionBankItemDetail } from './question_bank_read.ts';
import {
  getQuestionReviewWorkspace,
  QuestionReviewPageError,
  type QuestionReviewWorkspace,
} from './question_reviews.ts';
import {
  getQuestionRevisionHistory,
  getQuestionRevisionSnapshot,
  type QuestionRevisionHistory,
} from './questions.ts';
import type { RequestContext } from '../tenants.ts';
import type { QuestionVersionChange } from '../question_version_comparison.ts';
import { db, type DbReadConnection } from '../db.ts';

export type ItemBankDetailPageData = {
  readonly query: ItemDetailQuery;
  readonly id: string;
  readonly xml: string;
  readonly title: string;
  readonly history: QuestionRevisionHistory;
  readonly detail: QuestionBankItemDetail;
  readonly reviews: QuestionReviewWorkspace;
  readonly currentUserId: string;
  readonly comparison: {
    readonly fromRevision: number;
    readonly toRevision: number;
    readonly changes: readonly QuestionVersionChange[];
    readonly beforeXml: string;
    readonly afterXml: string;
  } | null;
  readonly notice: DetailFeedbackToken | null;
  readonly error: DetailFeedbackToken | null;
};

/** Closed feedback tokens accepted by the item-detail page boundary. */
export type DetailFeedbackToken =
  | 'detail:updated'
  | 'detail:invalid_input'
  | 'detail:action_failed'
  | 'detail:unexpected'
  | 'restore:invalid_reference'
  | 'restore:forbidden'
  | 'restore:source_unavailable'
  | 'restore:stale_revision'
  | 'restore:archived'
  | 'restore:invalid_source';

/** Parse only successful notice-channel feedback. */
export function parseDetailNoticeFeedback(value: string | null): 'detail:updated' | null {
  return value === 'detail:updated' ? value : null;
}

/** Parse an error-channel value, converting unknown non-empty input to safe generic feedback. */
export function parseDetailErrorFeedback(value: string | null): DetailFeedbackToken | null {
  if (value === null || value === '') return null;
  if (
    value === 'detail:invalid_input' || value === 'detail:action_failed' ||
    value === 'detail:unexpected' ||
    value === 'restore:invalid_reference' || value === 'restore:forbidden' ||
    value === 'restore:source_unavailable' || value === 'restore:stale_revision' ||
    value === 'restore:archived' || value === 'restore:invalid_source'
  ) return value;
  return 'detail:unexpected';
}

/** Loads one revision-consistent item detail page through a repeatable-read snapshot. */
export async function loadItemBankDetailPageData(
  auth: RequestContext,
  itemId: string,
  url: URL,
): Promise<ItemBankDetailPageData | null> {
  const query = parseItemDetailQuery(url.searchParams);
  const reviewBeforeRevision = query.reviewsBefore ?? undefined;
  const historyBeforeRevision = query.historyBefore ?? undefined;
  const commentPage = query.comments === null ? undefined : {
    requestId: query.comments.requestId,
    ...(query.comments.beforeCommentId === null
      ? {}
      : { beforeCommentId: query.comments.beforeCommentId }),
  };
  return await db.transaction(async (tx) => {
    const [member] = await tx.select({ role: organizationMemberships.role }).from(
      organizationMemberships,
    ).where(
      and(
        eq(organizationMemberships.tenantId, auth.tenantId),
        eq(organizationMemberships.userId, auth.userId),
      ),
    );
    const role = parseRole(member?.role);
    if (role === null || !hasCapability(role, 'view_content')) return null;
    const [history, detail, reviews] = await Promise.all([
      getQuestionRevisionHistory(auth, itemId, {
        ...(historyBeforeRevision === undefined ? {} : { beforeRevision: historyBeforeRevision }),
      }, tx),
      getQuestionBankItemDetail(auth, itemId, tx),
      loadReviewWorkspace(auth, itemId, reviewBeforeRevision, commentPage, tx),
    ]);
    if (!history || !detail || !reviews) return null;
    if (
      detail.revision !== history.latest.revision ||
      reviews.latestRevision !== history.latest.revision
    ) {
      throw new Error('Item detail projections disagree about the latest revision.');
    }
    const revisionTitle = history.latest.body.title;
    if (typeof revisionTitle !== 'string' || revisionTitle !== detail.title) {
      throw new Error('Item detail projections disagree about the latest title.');
    }
    const comparison = await loadItemRevisionComparison(
      tx,
      auth,
      itemId,
      history.latest.revision,
      query,
    );
    return {
      query,
      id: itemId,
      xml: history.latest.qtiXml,
      title: revisionTitle,
      history,
      detail,
      reviews,
      currentUserId: auth.userId,
      comparison,
      notice: parseDetailNoticeFeedback(url.searchParams.get('notice')),
      error: parseDetailErrorFeedback(url.searchParams.get('error')),
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

async function loadReviewWorkspace(
  auth: RequestContext,
  itemId: string,
  beforeRevision: number | undefined,
  commentPage: { readonly requestId: string; readonly beforeCommentId?: string } | undefined,
  conn: DbReadConnection,
): Promise<QuestionReviewWorkspace | null> {
  try {
    return await getQuestionReviewWorkspace(auth, itemId, {
      ...(beforeRevision === undefined ? {} : { beforeRevision }),
      ...(commentPage === undefined ? {} : { commentPage }),
    }, conn);
  } catch (cause: unknown) {
    if (cause instanceof QuestionReviewPageError) {
      throw new ItemDetailQueryError('invalid_pagination');
    }
    throw cause;
  }
}

async function loadItemRevisionComparison(
  conn: DbReadConnection,
  auth: RequestContext,
  itemId: string,
  latestRevision: number,
  query: ItemDetailQuery,
): Promise<ItemBankDetailPageData['comparison']> {
  if (latestRevision < 2 && query.comparison === null) return null;
  const { fromRevision, toRevision } = query.comparison ?? {
    fromRevision: latestRevision - 1,
    toRevision: latestRevision,
  };
  if (fromRevision < 1 || toRevision > latestRevision) {
    throw new ItemDetailQueryError('unknown_revision');
  }
  const [before, after] = await Promise.all([
    getQuestionRevisionSnapshot(auth, itemId, fromRevision, conn),
    getQuestionRevisionSnapshot(auth, itemId, toRevision, conn),
  ]);
  if (!before || !after) {
    throw new ItemDetailQueryError('unknown_revision');
  }
  return {
    fromRevision,
    toRevision,
    beforeXml: before.qtiXml,
    afterXml: after.qtiXml,
    changes: compareQuestionRevisionSnapshots(before, after),
  };
}

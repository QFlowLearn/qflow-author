import { parseQuestionBankQuery } from './services/question_bank_query.ts';
import { isCanonicalUuid } from './uuid.ts';

/** Independent navigation selections on one item detail page. Null means the initial page/pair. */
export type ItemDetailQuery = {
  readonly bankHref?: string;
  readonly comparison: { readonly fromRevision: number; readonly toRevision: number } | null;
  readonly historyBefore: number | null;
  readonly reviewsBefore: number | null;
  readonly comments: { readonly requestId: string; readonly beforeCommentId: string | null } | null;
};

export const INITIAL_ITEM_DETAIL_QUERY: ItemDetailQuery = {
  comparison: null,
  historyBefore: null,
  reviewsBefore: null,
  comments: null,
};

/** Stable input failures for detail navigation, distinct from bank-search pagination. */
export class ItemDetailQueryError extends Error {
  constructor(readonly code: 'invalid_comparison' | 'unknown_revision' | 'invalid_pagination') {
    super(code);
    this.name = 'ItemDetailQueryError';
  }
}

/** Parse once at the route boundary. Existence is resolved against authorized persisted revisions. */
export function parseItemDetailQuery(params: URLSearchParams): ItemDetailQuery {
  function single(name: string, code: ItemDetailQueryError['code']): string | null {
    const values = params.getAll(name);
    if (values.length > 1) throw new ItemDetailQueryError(code);
    return values[0] ?? null;
  }
  function integer(
    name: string,
    minimum: number,
    code: ItemDetailQueryError['code'],
  ): number | null {
    const value = single(name, code);
    if (value === null) return null;
    if (
      !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)) ||
      Number(value) < minimum
    ) {
      throw new ItemDetailQueryError(code);
    }
    return Number(value);
  }
  const bankHref = single('bank', 'invalid_pagination');
  if (bankHref !== null) {
    if (!/^\/items\?[^#]*#question-[0-9a-f-]{36}$/.test(bankHref)) {
      throw new ItemDetailQueryError('invalid_pagination');
    }
    const url = new URL(bankHref, 'https://qflow.invalid');
    if (!isCanonicalUuid(url.hash.slice('#question-'.length))) {
      throw new ItemDetailQueryError('invalid_pagination');
    }
    try {
      parseQuestionBankQuery(url.searchParams);
    } catch {
      throw new ItemDetailQueryError('invalid_pagination');
    }
  }
  const fromRevision = integer('compare', 1, 'invalid_comparison');
  const toRevision = integer('compareTo', 2, 'invalid_comparison');
  if (
    (fromRevision === null) !== (toRevision === null) ||
    (fromRevision !== null && toRevision !== null && fromRevision >= toRevision)
  ) {
    throw new ItemDetailQueryError('invalid_comparison');
  }
  const requestId = single('commentsFor', 'invalid_pagination');
  const beforeCommentId = single('commentsBefore', 'invalid_pagination');
  if (
    (requestId !== null && !isCanonicalUuid(requestId)) ||
    (beforeCommentId !== null && (!requestId || !isCanonicalUuid(beforeCommentId)))
  ) {
    throw new ItemDetailQueryError('invalid_pagination');
  }
  return {
    ...(bankHref !== null ? { bankHref } : {}),
    comparison: fromRevision !== null && toRevision !== null ? { fromRevision, toRevision } : null,
    historyBefore: integer('historyBefore', 2, 'invalid_pagination'),
    reviewsBefore: integer('reviewsBefore', 1, 'invalid_pagination'),
    comments: requestId === null ? null : { requestId, beforeCommentId },
  };
}

/** Serialize navigation only; transient action feedback never survives a navigation. */
export function itemDetailQueryParams(query: ItemDetailQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.bankHref) params.set('bank', query.bankHref);
  if (query.comparison) {
    params.set('compare', String(query.comparison.fromRevision));
    params.set('compareTo', String(query.comparison.toRevision));
  }
  if (query.historyBefore !== null) params.set('historyBefore', String(query.historyBefore));
  if (query.reviewsBefore !== null) params.set('reviewsBefore', String(query.reviewsBefore));
  if (query.comments) {
    params.set('commentsFor', query.comments.requestId);
    if (query.comments.beforeCommentId !== null) {
      params.set('commentsBefore', query.comments.beforeCommentId);
    }
  }
  return params;
}

/** Preserve every independent selection while changing the caller-owned navigation state. */
export function itemDetailHref(
  itemId: string,
  query: ItemDetailQuery,
  anchor: 'review' | 'item-history-heading' | 'comparison',
): string {
  const params = itemDetailQueryParams(query).toString();
  return `/items/${itemId}${params ? `?${params}` : ''}#${anchor}`;
}

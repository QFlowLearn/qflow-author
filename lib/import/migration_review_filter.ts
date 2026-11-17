/** The existing bank import review can focus on questions that cannot yet be accepted. */
export type MigrationReviewFilter = 'all' | 'blocked';

/** Pagination describes the visible selection; whole-run progress stays on the run. */
export type MigrationReviewPagination = {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalItems: number;
  readonly blocked: number;
  readonly filter: MigrationReviewFilter;
};

/** Parse the closed URL filter; absent input selects the full bank. */
export function parseMigrationReviewFilter(value: string | null): MigrationReviewFilter | null {
  if (value === null || value === 'all') return 'all';
  return value === 'blocked' ? 'blocked' : null;
}

/** Keep page, filter and optional editor together in local review links. */
export function migrationReviewHref(
  runId: string,
  page: number,
  filter: MigrationReviewFilter,
  itemId?: string,
): string {
  const query = new URLSearchParams({ page: String(page) });
  if (filter === 'blocked') query.set('review', filter);
  if (itemId !== undefined) query.set('edit', itemId);
  return `/imports/${encodeURIComponent(runId)}?${query}${
    itemId === undefined ? '' : `#item-${encodeURIComponent(itemId)}`
  }`;
}

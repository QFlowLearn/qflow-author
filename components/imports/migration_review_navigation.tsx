import Button from '../ui/Button.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import {
  migrationReviewHref,
  type MigrationReviewPagination,
} from '../../lib/import/migration_review_filter.ts';

/** Server-rendered navigation retains a bounded review page in the URL. */
export function MigrationReviewNavigation({ pagination, runId, i18n }: {
  pagination?: MigrationReviewPagination;
  runId: string;
  i18n: I18n;
}) {
  return (
    <>
      {pagination && (
        <nav class='flex flex-wrap gap-2' aria-label={i18n.t('imports.report.reviewFilter')}>
          <Button
            size='sm'
            variant={pagination.filter === 'all' ? 'default' : 'ghost'}
            href={migrationReviewHref(runId, 1, 'all')}
            aria-current={pagination.filter === 'all' ? 'page' : undefined}
          >
            {i18n.t('imports.report.allQuestionsCount', { count: pagination.totalItems })}
          </Button>
          <Button
            size='sm'
            variant={pagination.filter === 'blocked' ? 'default' : 'ghost'}
            href={migrationReviewHref(runId, 1, 'blocked')}
            aria-current={pagination.filter === 'blocked' ? 'page' : undefined}
          >
            {i18n.t('imports.report.needsFixesCount', { count: pagination.blocked })}
          </Button>
        </nav>
      )}
      {pagination && pagination.total > pagination.pageSize && (
        <nav aria-label={i18n.t('imports.report.pages')}>
          {pagination.page > 1 && (
            <Button
              variant='ghost'
              href={migrationReviewHref(runId, pagination.page - 1, pagination.filter)}
            >
              {i18n.t('imports.report.previous')}
            </Button>
          )}
          <span>
            {i18n.t('imports.report.pageCount', {
              page: pagination.page,
              total: Math.ceil(pagination.total / pagination.pageSize),
            })}
          </span>
          {pagination.page * pagination.pageSize < pagination.total && (
            <Button
              variant='ghost'
              href={migrationReviewHref(runId, pagination.page + 1, pagination.filter)}
            >
              {i18n.t('imports.report.next')}
            </Button>
          )}
        </nav>
      )}
    </>
  );
}

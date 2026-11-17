import BankOverviewSubject from './BankOverviewSubject.tsx';
import { Table } from '../ui/Table.tsx';
import Button from '../ui/Button.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type {
  EnrichmentOverviewBucket,
  EnrichmentOverviewCounts,
  EnrichmentOverviewView,
} from '../../lib/services/bank_enrichment_browse_contract.ts';
import { bankEnrichmentStatusFilter } from '../../lib/services/bank_enrichment_query.ts';
import type { QuestionBankQuery } from '../../lib/services/question_bank_query.ts';
import type { BankEnrichmentValueFilter } from '../../lib/services/bank_enrichment_query.ts';
import type { EnrichmentDimension } from '../../lib/services/bank_enrichment_contract.ts';
import { questionBankGroupHref } from '../../lib/question_bank_link.ts';

/** An ordinary linked table of the current bank selection, with no client-side aggregation. */
export function BankOverview({ view, query, i18n, organizeHref }: {
  readonly view: EnrichmentOverviewView;
  readonly query: QuestionBankQuery;
  readonly i18n: I18n;
  readonly organizeHref?: string;
}) {
  const selection = view.selection;
  if (!selection) {
    return (
      <section class='space-y-2 py-6'>
        <h2 class='text-lg font-medium'>{i18n.t('items.overview.matrix')}</h2>
        <p class='text-sm text-base-content/80'>
          {i18n.t(view.schemes.length ? 'items.overview.chooseSet' : 'items.overview.noCategories')}
        </p>
        {organizeHref && view.schemes.length === 0 && (
          <Button href={organizeHref} size='sm'>{i18n.t('items.organize.title')}</Button>
        )}
      </section>
    );
  }
  const overview = selection.overview;
  const buckets = [
    ...overview.rows.flatMap((row) => [row.bucket, ...row.topics.map((topic) => topic.bucket)]),
    ...overview.columns,
  ];
  const versions = new Set(
    buckets.flatMap((bucket) => bucket.filter.kind === 'value' ? [bucket.filter.versionId] : []),
  );
  const historical = buckets.some((bucket) =>
    bucket.filter.kind === 'value' && bucket.filter.versionId !== selection.scheme.versionId
  );
  const showVersions = versions.size > 1 || historical;
  const label = (bucket: EnrichmentOverviewBucket) =>
    bucket.category?.label ?? i18n.t(`items.browse.${bucket.filter.kind}`);
  const contextLabel = (bucket: EnrichmentOverviewBucket) => {
    const text = label(bucket);
    return showVersions && bucket.category
      ? `${text}, ${i18n.t('items.browse.versionAudience', bucket.category)}`
      : text;
  };
  const versionNote = (bucket: EnrichmentOverviewBucket) =>
    showVersions && bucket.category
      ? (
        <span class='mt-1 block max-w-64 whitespace-normal text-xs font-normal text-base-content/80'>
          {i18n.t('items.browse.versionAudience', bucket.category)}
        </span>
      )
      : null;
  const countLink = (count: number, href: string, group: string) =>
    count > 0
      ? (
        <Button
          href={href}
          variant='text'
          aria-label={i18n.t('items.overview.openGroup', { count, group })}
        >
          {i18n.formatNumber(count)}
        </Button>
      )
      : <span class='px-1 text-base-content/70'>{i18n.formatNumber(count)}</span>;
  const countCells = (
    row: EnrichmentOverviewCounts,
    filters: Partial<Record<EnrichmentDimension, BankEnrichmentValueFilter>>,
    context: readonly string[],
  ) => (
    <>
      {overview.columns.map((column, index) => (
        <td key={column.key} class='text-right tabular-nums'>
          {countLink(
            row.counts[index],
            questionBankGroupHref(query, { ...filters, difficulty: column.filter }),
            [...context, contextLabel(column)].join(' / '),
          )}
        </td>
      ))}
      <td class='text-right tabular-nums font-medium'>
        {countLink(
          row.total,
          questionBankGroupHref(query, filters),
          context.join(' / ') || i18n.t('items.overview.selection'),
        )}
      </td>
    </>
  );
  return (
    <section class='min-w-0 space-y-3'>
      <div class='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 class='text-lg font-medium'>{i18n.t('items.overview.matrix')}</h2>
          <p class='text-sm text-base-content/80'>{i18n.t('items.overview.openCountHint')}</p>
        </div>
        <div class='flex flex-wrap items-center gap-3'>
          <p class='text-sm'>{i18n.t('items.results.total', { count: overview.total })}</p>
          {organizeHref && (
            <Button href={organizeHref} size='sm'>{i18n.t('items.organize.title')}</Button>
          )}
        </div>
      </div>
      {!showVersions && (
        <p class='text-sm text-base-content/80'>
          {i18n.t('items.browse.audience', { audience: selection.scheme.audience })}
        </p>
      )}
      {overview.total === 0
        ? <p class='py-6 text-sm'>{i18n.t('items.results.noResultsTitle')}</p>
        : (
          <div class='overflow-hidden rounded-lg border border-base-300 bg-base-100'>
            <Table label={i18n.t('items.overview.matrix')}>
              <thead>
                <tr>
                  <th scope='col'>{i18n.t('items.browse.subject')}</th>
                  {overview.columns.map((column) => (
                    <th key={column.key} scope='col' class='text-right tabular-nums'>
                      {label(column)}
                      {versionNote(column)}
                    </th>
                  ))}
                  <th scope='col' class='text-right tabular-nums'>
                    {i18n.t('items.overview.total')}
                  </th>
                </tr>
              </thead>
              {overview.rows.map((row, rowIndex) => {
                const cells = countCells(row, { subject: row.bucket.filter }, [
                  contextLabel(row.bucket),
                ]);
                const heading = <>{label(row.bucket)}{versionNote(row.bucket)}</>;
                return row.topics.length > 0
                  ? (
                    <BankOverviewSubject
                      key={row.bucket.key}
                      id={`overview-topics-${rowIndex}`}
                      label={i18n.t('items.overview.subjectTopics', {
                        subject: contextLabel(row.bucket),
                      })}
                      heading={heading}
                      cells={cells}
                      columnCount={overview.columns.length + 2}
                      note={i18n.t('items.overview.topicOverlap')}
                    >
                      {row.topics.map((topic) => (
                        <tr key={topic.bucket.key}>
                          <th
                            scope='row'
                            class='min-w-40 max-w-80 whitespace-normal pl-8 font-normal'
                          >
                            <Button
                              variant='text'
                              href={questionBankGroupHref(query, {
                                subject: row.bucket.filter,
                                topic: topic.bucket.filter,
                              })}
                            >
                              {label(topic.bucket)}
                            </Button>
                            {versionNote(topic.bucket)}
                          </th>
                          {countCells(topic, {
                            subject: row.bucket.filter,
                            topic: topic.bucket.filter,
                          }, [contextLabel(row.bucket), contextLabel(topic.bucket)])}
                        </tr>
                      ))}
                    </BankOverviewSubject>
                  )
                  : (
                    <tbody key={row.bucket.key}>
                      <tr class={row.bucket.category ? '' : 'bg-base-200/50'}>
                        <th scope='row' class='min-w-40 max-w-80 whitespace-normal font-medium'>
                          {heading}
                        </th>
                        {cells}
                      </tr>
                    </tbody>
                  );
              })}
              <tfoot>
                <tr>
                  <th scope='row'>{i18n.t('items.overview.total')}</th>
                  {countCells({ counts: overview.totals, total: overview.total }, {}, [])}
                </tr>
              </tfoot>
            </Table>
          </div>
        )}
      {overview.statuses.length > 0 && (
        <details>
          <summary class='cursor-pointer py-2 text-sm font-medium'>
            {i18n.t('items.browse.status')}
          </summary>
          <ul class='space-y-1'>
            {overview.statuses.map((status) => (
              <li key={`${status.dimension}:${status.kind}`}>
                <Button
                  href={questionBankGroupHref(query, {
                    [status.dimension]: bankEnrichmentStatusFilter(status.kind),
                  })}
                  variant='ghost'
                  size='sm'
                >
                  {i18n.t('items.overview.statusCount', {
                    dimension: i18n.t(`items.browse.${status.dimension}`),
                    status: i18n.t(`items.browse.${status.kind}`),
                    count: status.count,
                  })}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

import { mountIsland } from '../../../rendering/mount_island.ts';
import LocalizedTimestampView from '../../../../islands/LocalizedTimestamp.tsx';
import Button from '../../../../components/ui/Button.tsx';
import Input from '../../../../components/ui/Input.tsx';
import AssessmentActionsMenuView from '../../../../islands/AssessmentActionsMenu.tsx';
import NewAssessmentButton from '../../../../components/NewAssessmentButton.tsx';
import { type DeliverySummary, readDeliverySummary } from '../../../delivery_metadata.ts';
import {
  type DeliveryPublishCapability,
  getDeliveryPublishCapability,
} from '../../../delivery_publish.ts';
import { listAssessments } from '../../../services/assessment_records.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import type { I18n } from '../../../i18n/messages.ts';
import type { MessageCatalog } from '../../../i18n/messages.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';

type Row = {
  id: string;
  title: string;
  updatedAt?: string;
  createdAt?: string;
  partsCount: number;
  itemsCount: number;
  brief?: string;
  delivery?: DeliverySummary | null;
};

type Data = {
  rows: Row[];
  q: string;
  tags: string;
  sort: string;
  deliveryCapability?: DeliveryPublishCapability;
  i18n: I18n;
  catalog: MessageCatalog;
};
type SortKey = 'updated' | 'created' | 'title' | 'items' | 'parts';

const sortKeys = new Set<SortKey>(['updated', 'created', 'title', 'items', 'parts']);

const methods = {
  async GET(ctx) {
    const u = ctx.url;
    const q = (u.searchParams.get('q') || '').trim();
    const tagsStr = (u.searchParams.get('tags') || '').trim();
    const requestedSort = (u.searchParams.get('sort') || 'updated').trim();
    const sort = sortKeys.has(requestedSort as SortKey) ? requestedSort as SortKey : 'updated';
    const auth = requireAuthContext(ctx.state);
    const summaries = await listAssessments(auth, 200);
    const rows: Row[] = summaries.map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: s.updatedAt ?? undefined,
      createdAt: s.createdAt ?? undefined,
      partsCount: s.partsCount ?? 0,
      itemsCount: s.itemsCount ?? 0,
      brief: s.brief,
      delivery: readDeliverySummary(s.metadata),
    }));
    const tagList = tagsStr
      ? tagsStr.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [];
    const query = q.toLowerCase();
    const filtered = rows.filter((r) => {
      const hay = `${r.title} ${r.brief || ''}`.toLowerCase();
      const qok = !query || hay.includes(query);
      const tok = tagList.length === 0 ||
        (r.brief || '').toLowerCase().split(/\W+/).some((w) => tagList.includes(w));
      return qok && tok;
    });
    if (sort === 'updated') {
      filtered.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    } else if (sort === 'created') {
      filtered.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    } else if (sort === 'title') {
      filtered.sort((a, b) => ctx.state.i18n.collator.compare(a.title, b.title));
    } else if (sort === 'items') {
      filtered.sort((a, b) => b.itemsCount - a.itemsCount);
    } else if (sort === 'parts') {
      filtered.sort((a, b) => b.partsCount - a.partsCount);
    }
    const deliveryCapability = await getDeliveryPublishCapability(auth.tenantId);
    return ctx.render(
      <AssessmentsIndex
        rows={filtered}
        q={q}
        tags={tagsStr}
        sort={sort}
        deliveryCapability={deliveryCapability}
        i18n={ctx.state.i18n}
        catalog={ctx.state.catalog}
      />,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const assessmentListPageRoute = defineHttpRoute('/assessments', {
  ...methods,
  HEAD: methods.GET,
});

export default function AssessmentsIndex(
  { rows, q, tags, sort, deliveryCapability, i18n, catalog }: Data,
) {
  const deliveryPublishAvailable = deliveryCapability?.enabled === true;
  const activeFilters = [q.trim(), tags.trim()].filter(Boolean).length;
  const showGettingStarted = rows.length === 0 && activeFilters === 0;
  const rowCountLabel = i18n.t('list.count', { count: rows.length });
  const sortLabel = sort === 'title'
    ? i18n.t('list.sort.title')
    : sort === 'created'
    ? i18n.t('list.sort.created')
    : sort === 'items'
    ? i18n.t('list.sort.items')
    : sort === 'parts'
    ? i18n.t('list.sort.parts')
    : i18n.t('list.sort.updated');
  const totalQuestions = rows.reduce((sum, row) => sum + row.itemsCount, 0);
  const totalParts = rows.reduce((sum, row) => sum + row.partsCount, 0);
  const publishedRows = rows.filter((row) => row.delivery);
  const publishedItems = publishedRows.reduce((sum, row) => sum + row.itemsCount, 0);
  const draftItems = rows
    .filter((row) => !row.delivery && row.itemsCount > 0)
    .reduce((sum, row) => sum + row.itemsCount, 0);
  const plannedRows = rows.filter((row) => row.itemsCount === 0).length;
  const readyPercent = totalQuestions > 0 ? Math.round((publishedItems / totalQuestions) * 100) : 0;

  return (
    <section class='space-y-7'>
      <div class='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
        <div class='space-y-2'>
          <p class='qf-label text-sm uppercase text-secondary'>{i18n.t('list.eyebrow')}</p>
          <h1 class='text-4xl font-bold leading-tight text-base-content sm:text-5xl'>
            {i18n.t('list.title')}
          </h1>
          <p class='max-w-3xl text-base leading-7 text-base-content/70'>
            {i18n.t(showGettingStarted ? 'list.empty.unfilteredBody' : 'list.description')}
          </p>
        </div>
        <div class='flex flex-wrap gap-3'>
          {showGettingStarted && (
            <Button href='/demo/presidents' variant='primary'>
              {i18n.t('list.exploreSample')}
            </Button>
          )}
          <Button
            href='/assessments/new'
            variant={showGettingStarted ? 'default' : 'primary'}
            class='gap-2'
          >
            <span aria-hidden='true'>⇧</span>
            {i18n.t('list.bringFiles')}
          </Button>
          <NewAssessmentButton variant='default' buttonClass='gap-2'>
            {i18n.t('list.newBlank')}
          </NewAssessmentButton>
        </div>
      </div>

      <div class='grid gap-5 sm:grid-cols-3'>
        <MetricCard
          label={i18n.t('list.metrics.questions.label')}
          value={i18n.formatNumber(totalQuestions, {
            notation: 'compact',
            maximumFractionDigits: 1,
          })}
          detail={i18n.t('list.metrics.questions.partsAssembled', { count: totalParts })}
          icon='stack'
        />
        <MetricCard
          label={i18n.t('list.metrics.assessments.label')}
          value={i18n.formatNumber(rows.length, { notation: 'compact', maximumFractionDigits: 1 })}
          detail={publishedRows.length > 0
            ? i18n.t('list.metrics.assessments.ready', { count: publishedRows.length })
            : i18n.t('list.metrics.assessments.nonePublished')}
          icon='verified'
        />
        <MetricCard
          label={i18n.t('list.metrics.ready.label')}
          value={i18n.formatPercent(readyPercent / 100)}
          detail={totalQuestions > 0
            ? i18n.t('list.metrics.ready.publishedQuestions', { count: publishedItems })
            : i18n.t('list.metrics.ready.start')}
          tone='success'
          icon='users'
        />
      </div>

      <div class='grid gap-5 lg:grid-cols-2'>
        <section class='rounded-lg border border-base-300/80 bg-base-100 p-5'>
          <div class='flex items-start justify-between gap-3'>
            <div>
              <h2 class='text-xl font-semibold text-base-content'>
                {i18n.t('list.readiness.title')}
              </h2>
              <p class='mt-2 text-sm leading-6 text-base-content/65'>
                {i18n.t('list.readiness.help')}
              </p>
            </div>
            <span class='inline-flex h-7 w-7 items-center justify-center rounded-full border border-base-300 text-sm font-semibold text-secondary'>
              <span aria-hidden='true'>i</span>
            </span>
          </div>
          <div class='mt-6 h-2 overflow-hidden rounded-full bg-base-200'>
            <div
              class='h-full rounded-full bg-success'
              style={{ width: `${Math.max(readyPercent, totalQuestions > 0 ? 3 : 0)}%` }}
            />
          </div>
          <div class='mt-5 grid grid-cols-3 gap-3 text-sm'>
            <ReadinessStat
              label={i18n.t('list.readiness.published')}
              value={publishedItems}
              i18n={i18n}
              tone='text-success'
            />
            <ReadinessStat
              label={i18n.t('list.readiness.draft')}
              value={draftItems}
              i18n={i18n}
              tone='text-secondary'
            />
            <ReadinessStat
              label={i18n.t('list.readiness.planning')}
              value={plannedRows}
              i18n={i18n}
              tone='text-warning'
            />
          </div>
        </section>

        <section class='rounded-lg border border-[#213145] bg-[#131b2e] p-5 text-white'>
          <h2 class='text-xl font-semibold'>{i18n.t('list.importGuide.title')}</h2>
          <p class='mt-3 text-sm leading-6 text-[#bec6e0]'>
            {i18n.t('list.importGuide.body')}
          </p>
          <a
            href='/help/qti-fidelity'
            class='qf-label mt-5 inline-flex border-b border-white/35 pb-1 text-sm text-white hover:border-white'
          >
            {i18n.t('list.importGuide.link')}
          </a>
        </section>
      </div>

      <section class='space-y-4'>
        <div class='flex flex-wrap items-center justify-between gap-3 border-y border-base-300/70 py-3'>
          <div class='min-w-0'>
            <div class='font-semibold text-base-content'>{rowCountLabel}</div>
            <div class='text-sm text-base-content/60'>
              {i18n.t('list.sortedBy', { sort: sortLabel })}
            </div>
          </div>
          <div class='flex flex-wrap items-center gap-2'>
            {activeFilters > 0 && (
              <Button size='sm' variant='ghost' href={buildAssessmentsHref({ sort })}>
                {i18n.t('list.filters.clear')}
              </Button>
            )}
            <details class='relative'>
              <summary class='ds-btn ds-btn-sm ds-btn-ghost list-none [&::-webkit-details-marker]:hidden'>
                {i18n.t('list.filters.label')}
                {activeFilters > 0
                  ? ` (${i18n.t('list.filters.active', { count: activeFilters })})`
                  : ''}
              </summary>
              <form
                class='qf-layer-shadow absolute right-0 z-20 mt-2 w-[min(90vw,34rem)] space-y-3 rounded-lg border border-base-300/80 bg-base-100 p-4'
                method='get'
              >
                <input type='hidden' name='sort' value={sort} />
                <label class='flex flex-col gap-1'>
                  <span class='text-sm font-medium'>{i18n.t('list.filters.titleLabel')}</span>
                  <Input name='q' value={q} placeholder={i18n.t('list.filters.titlePlaceholder')} />
                </label>
                <label class='flex flex-col gap-1'>
                  <span class='text-sm font-medium'>{i18n.t('list.filters.keywordsLabel')}</span>
                  <Input
                    name='tags'
                    value={tags}
                    placeholder={i18n.t('list.filters.keywordsPlaceholder')}
                  />
                </label>
                <div class='flex flex-wrap justify-end gap-2 pt-1'>
                  <Button href={buildAssessmentsHref({ sort })} variant='ghost'>
                    {i18n.t('list.filters.reset')}
                  </Button>
                  <Button type='submit' variant='primary'>{i18n.t('list.filters.apply')}</Button>
                </div>
              </form>
            </details>
          </div>
        </div>
      </section>

      {rows.length === 0
        ? (
          <div class='rounded-lg border border-base-300/70 bg-base-100 p-6 text-sm text-base-content/70'>
            <div class='max-w-xl space-y-3'>
              <div class='text-base font-medium text-base-content'>
                {i18n.t('list.empty.title')}
              </div>
              <p>
                {activeFilters > 0
                  ? i18n.t('list.empty.filteredBody')
                  : i18n.t('list.empty.unfilteredBody')}
              </p>
              {activeFilters > 0 && (
                <div class='flex flex-wrap gap-2'>
                  <Button href={buildAssessmentsHref({ sort })}>
                    {i18n.t('list.filters.clear')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )
        : (
          <div class='overflow-hidden rounded-lg border border-base-300/70 bg-base-100 shadow-none'>
            <div class='overflow-x-auto'>
              <table class='w-full table-fixed text-sm'>
                <thead class='border-b border-base-300/70 bg-base-200/80 text-left text-xs font-medium uppercase tracking-normal text-base-content/70'>
                  <tr>
                    <SortableHeading
                      href={buildAssessmentsHref({ q, tags, sort: 'title' })}
                      active={sort === 'title'}
                      direction='ascending'
                      label={i18n.t('list.table.headers.assessment')}
                      className='w-full px-4 py-3'
                      ariaLabel={i18n.t('list.table.sortBy', {
                        column: i18n.t('list.table.headers.assessment'),
                      })}
                    />
                    <SortableHeading
                      href={buildAssessmentsHref({ q, tags, sort: 'items' })}
                      active={sort === 'items'}
                      direction='descending'
                      label={i18n.t('list.table.headers.items')}
                      className='hidden w-24 px-3 py-3 text-right sm:table-cell'
                      ariaLabel={i18n.t('list.table.sortBy', {
                        column: i18n.t('list.table.headers.items'),
                      })}
                    />
                    <SortableHeading
                      href={buildAssessmentsHref({ q, tags, sort: 'parts' })}
                      active={sort === 'parts'}
                      direction='descending'
                      label={i18n.t('list.table.headers.parts')}
                      className='hidden w-24 px-3 py-3 text-right md:table-cell'
                      ariaLabel={i18n.t('list.table.sortBy', {
                        column: i18n.t('list.table.headers.parts'),
                      })}
                    />
                    <SortableHeading
                      href={buildAssessmentsHref({ q, tags, sort: 'updated' })}
                      active={sort === 'updated'}
                      direction='descending'
                      label={i18n.t('list.table.headers.updated')}
                      className='hidden w-36 px-3 py-3 lg:table-cell'
                      ariaLabel={i18n.t('list.table.sortBy', {
                        column: i18n.t('list.table.headers.updated'),
                      })}
                    />
                    <SortableHeading
                      href={buildAssessmentsHref({ q, tags, sort: 'created' })}
                      active={sort === 'created'}
                      direction='descending'
                      label={i18n.t('list.table.headers.created')}
                      className='hidden w-36 px-3 py-3 xl:table-cell'
                      ariaLabel={i18n.t('list.table.sortBy', {
                        column: i18n.t('list.table.headers.created'),
                      })}
                    />
                    <th class='w-32 px-4 py-3 text-right'>
                      {i18n.t('list.table.headers.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody class='divide-y divide-base-300/60'>
                  {rows.map((r) => (
                    <tr key={r.id} class='group hover:bg-base-200/60'>
                      <td class='min-w-0 px-4 py-4 align-top'>
                        <div class='min-w-0 space-y-1.5'>
                          <a
                            href={`/assessments/${r.id}`}
                            class='block truncate text-lg font-medium text-base-content underline-offset-4 group-hover:underline'
                          >
                            {r.title}
                          </a>
                          <div class='text-xs text-base-content/60 sm:hidden'>
                            {i18n.t('list.table.mobile.items', { count: r.itemsCount })} ·{' '}
                            {i18n.t('list.table.mobile.parts', { count: r.partsCount })}
                            {' · '}
                            {i18n.rich('list.table.mobile.updated', {
                              date: formatTableDate(r.updatedAt, i18n),
                            })}
                          </div>
                          {r.brief && (
                            <div class='line-clamp-2 text-sm text-base-content/65'>
                              {r.brief}
                            </div>
                          )}
                          {r.delivery && (
                            <div class='flex flex-wrap items-center gap-2 text-xs text-base-content/65'>
                              <span class='inline-flex items-center rounded-sm border border-success/30 bg-success/10 px-2 py-0.5 font-medium text-success'>
                                {i18n.t('list.table.published')}
                              </span>
                              <span>{formatTableDate(r.delivery.publishedAt, i18n)}</span>
                              <span class='font-mono text-[11px]'>
                                {r.delivery.assessmentVersionId}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td class='hidden px-3 py-4 text-right align-top text-base-content/70 sm:table-cell'>
                        {i18n.formatNumber(r.itemsCount)}
                      </td>
                      <td class='hidden px-3 py-4 text-right align-top text-base-content/70 md:table-cell'>
                        {i18n.formatNumber(r.partsCount)}
                      </td>
                      <td class='hidden px-3 py-4 align-top text-base-content/70 lg:table-cell'>
                        {formatTableDate(r.updatedAt, i18n)}
                      </td>
                      <td class='hidden px-3 py-4 align-top text-base-content/70 xl:table-cell'>
                        {formatTableDate(r.createdAt, i18n)}
                      </td>
                      <td class='px-4 py-4 align-top'>
                        <div class='flex items-center justify-end gap-2'>
                          <Button size='sm' variant='primary' href={`/assessments/${r.id}`}>
                            {i18n.t('list.table.edit')}
                          </Button>
                          <AssessmentActionsMenu
                            assessmentId={r.id}
                            assessmentTitle={r.title}
                            deliveryPreviewUrl={r.delivery?.previewUrl}
                            deliveryAdminUrl={r.delivery?.adminUrl}
                            deliveryPublishAvailable={deliveryPublishAvailable}
                            payload={createI18nPayload(i18n.locale, catalog, [
                              'assessments',
                            ])}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </section>
  );
}

function MetricCard(
  { label, value, detail, tone = 'default', icon }: {
    label: string;
    value: string;
    detail: string;
    tone?: 'default' | 'success';
    icon: 'stack' | 'verified' | 'users';
  },
) {
  return (
    <article class='rounded-lg border border-base-300/80 bg-base-100 p-5'>
      <div class='flex items-start justify-between gap-3'>
        <h2 class='qf-label text-sm text-base-content/70'>{label}</h2>
        <MetricIcon icon={icon} tone={tone} />
      </div>
      <div class='mt-6 flex items-end gap-3'>
        <div class='text-4xl font-bold leading-none text-base-content'>{value}</div>
      </div>
      <p class='mt-3 text-sm text-base-content/65'>{detail}</p>
    </article>
  );
}

function MetricIcon(
  { icon, tone }: { icon: 'stack' | 'verified' | 'users'; tone: 'default' | 'success' },
) {
  const color = tone === 'success' ? 'text-success' : 'text-secondary';
  const paths = {
    stack: (
      <>
        <ellipse cx='12' cy='6' rx='7' ry='3' />
        <path d='M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6' />
        <path d='M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6' />
      </>
    ),
    verified: (
      <>
        <path d='M12 3l2.1 2.36 3.14-.34.36 3.14L20 10.25 18.4 13l1.6 2.75-2.4 2.09-.36 3.14-3.14-.34L12 21l-2.1-2.36-3.14.34-.36-3.14L4 13.75 5.6 11 4 8.25l2.4-2.09.36-3.14 3.14.34L12 3Z' />
        <path d='m8.8 12 2.1 2.1 4.3-4.6' />
      </>
    ),
    users: (
      <>
        <path d='M16 20v-1.5c0-1.66-1.8-3-4-3s-4 1.34-4 3V20' />
        <circle cx='12' cy='10' r='3' />
        <path d='M20 20v-1.3c0-1.25-1.02-2.32-2.47-2.79' />
        <path d='M16.7 7.25a2.5 2.5 0 0 1 0 5' />
      </>
    ),
  };
  return (
    <svg
      class={`h-6 w-6 ${color}`}
      fill='none'
      viewBox='0 0 24 24'
      stroke='currentColor'
      stroke-width='1.8'
      stroke-linecap='round'
      stroke-linejoin='round'
      aria-hidden='true'
    >
      {paths[icon]}
    </svg>
  );
}

function ReadinessStat(
  { label, value, tone, i18n }: { label: string; value: number; tone: string; i18n: I18n },
) {
  return (
    <div>
      <div class={`text-lg font-bold ${tone}`}>
        {i18n.formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 })}
      </div>
      <div class='text-xs text-base-content/60'>{label}</div>
    </div>
  );
}

function buildAssessmentsHref(
  { q, tags, sort }: { q?: string; tags?: string; sort?: string },
) {
  const params = new URLSearchParams();
  if (q?.trim()) params.set('q', q.trim());
  if (tags?.trim()) params.set('tags', tags.trim());
  if (sort && sort !== 'updated') params.set('sort', sort);
  const query = params.toString();
  return query ? `/assessments?${query}` : '/assessments';
}

function formatTableDate(value: string | undefined, i18n: I18n) {
  if (!value) return i18n.t('list.table.unavailable');
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? i18n.t('list.table.unavailable') : (
    <LocalizedTimestamp
      value={date.toISOString()}
      locale={i18n.locale}
      showTime={false}
      dateStyle='numeric'
    />
  );
}

function SortableHeading(
  { href, active, direction, label, className, ariaLabel }: {
    href: string;
    active: boolean;
    direction: 'ascending' | 'descending';
    label: string;
    className: string;
    ariaLabel: string;
  },
) {
  return (
    <th class={className} aria-sort={active ? direction : 'none'}>
      <a
        href={href}
        class={`inline-flex items-center gap-2 border-b border-transparent hover:text-base-content ${
          active ? 'border-base-content text-base-content' : ''
        }`}
        aria-label={ariaLabel}
      >
        <span>{label}</span>
      </a>
    </th>
  );
}

const LocalizedTimestamp = mountIsland({
  component: 'LocalizedTimestamp',
  View: LocalizedTimestampView,
});
const AssessmentActionsMenu = mountIsland({
  component: 'AssessmentActionsMenu',
  View: AssessmentActionsMenuView,
});

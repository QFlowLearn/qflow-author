import BankCategoryFiltersView from '../../islands/BankCategoryFilters.tsx';
import BankOverviewView from '../../islands/BankOverview.tsx';
import BankBulkControlsView from '../../islands/BankBulkControls.tsx';
import BankQuestionTableView from '../../islands/BankQuestionTable.tsx';
import { mountIsland } from '../../lib/rendering/mount_island.ts';
import BankSectionNavigation from './BankSectionNavigation.tsx';
import { questionBankHref as pageHref } from '../../lib/question_bank_link.ts';
import { enrichmentCorrectionHref } from '../../lib/bank_enrichment_correction_link.ts';
import type { EnrichmentBankPage } from '../../lib/services/bank_enrichment_browse_contract.ts';
import { BankPagination } from './BankPagination.tsx';
import type { BankCollectionNavigation } from './BankCollections.tsx';
import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';
import Select from '../ui/Select.tsx';
import Checkbox from '../ui/Checkbox.tsx';
import type {
  QuestionBankQuery,
  QuestionBankSortField,
} from '../../lib/services/question_bank_query.ts';
import { BankAlert, BankField } from './ui.tsx';
import type { createI18nPayload } from '../../lib/i18n/payload.ts';
import type { I18n } from '../../lib/i18n/messages.ts';

export type ItemsPageData = EnrichmentBankPage & {
  readonly collectionWorkspace: BankCollectionNavigation;
  readonly bankDisplayName: string | null;
  readonly query: QuestionBankQuery;
  readonly notice: string | null;
  readonly error: string | null;
  readonly canManageContent: boolean;
  readonly i18n: I18n;
  readonly payload: ReturnType<typeof createI18nPayload>;
};

export default function ItemsPage(
  {
    kind,
    bank,
    enrichment,
    query,
    notice,
    error,
    canManageContent,
    i18n,
    payload,
    collectionWorkspace,
    bankDisplayName,
  }: ItemsPageData,
) {
  const sortHref = (field: QuestionBankSortField) =>
    pageHref({
      ...query,
      sort: {
        field,
        direction: query.sort?.field === field && query.sort.direction === 'asc' ? 'desc' : 'asc',
      },
    }, 1);
  return (
    <section class='space-y-3'>
      <header class='space-y-4'>
        <div class='flex flex-wrap items-start justify-between gap-4'>
          <div>
            {bankDisplayName && <p class='text-sm font-medium break-words'>{bankDisplayName}</p>}
            <h1 class='text-3xl font-medium tracking-tight'>{i18n.t('items.list.title')}</h1>
          </div>
          <div class='flex flex-wrap gap-2'>
            {canManageContent && (
              <Button
                href={query.collection?._tag === 'Collection'
                  ? `/imports/new?collection=${query.collection.collectionId}`
                  : '/imports/new'}
              >
                {i18n.t('items.list.import')}
              </Button>
            )}
            {canManageContent && (
              <Button
                href={query.collection?._tag === 'Collection'
                  ? `/items/new?collection=${query.collection.collectionId}`
                  : '/items/new'}
                variant='primary'
              >
                {i18n.t('items.drafts.create')}
              </Button>
            )}
          </div>
        </div>
      </header>

      {notice && <BankAlert tone='success'>{notice}</BankAlert>}
      {error && <BankAlert tone='error'>{error}</BankAlert>}

      <BankSectionNavigation
        current={query.view === 'overview' ? 'overview' : 'questions'}
        questionsHref={pageHref({ ...query, view: undefined }, 1)}
        overviewHref={pageHref({ ...query, view: 'overview' }, 1)}
        i18n={i18n}
      />
      <form method='get' class='space-y-2'>
        {query.view && <Input type='hidden' name='view' value={query.view} />}
        <Input type='hidden' name='pageSize' value={query.pageSize} />
        {query.sort && (
          <>
            <Input type='hidden' name='sort' value={query.sort.field} />
            <Input type='hidden' name='direction' value={query.sort.direction} />
          </>
        )}
        <div class='space-y-2'>
          <div class='flex flex-wrap items-end gap-3'>
            <BankField label={i18n.t('items.collections.title')} class='w-full md:w-72'>
              <Select
                name='collection'
                value={query.collection?._tag === 'Unfiled'
                  ? 'unfiled'
                  : query.collection?.collectionId ?? ''}
              >
                <option value=''>{i18n.t('items.collections.all')}</option>
                <option value='unfiled'>{i18n.t('items.collections.unfiled')}</option>
                {collectionWorkspace.collections.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                    {row.archivedAt ? ` (${i18n.t('items.collections.archived')})` : ''}
                  </option>
                ))}
              </Select>
            </BankField>
            <BankField label={i18n.t('items.filter.search')} class='min-w-64 flex-1'>
              <Input
                name='q'
                class='placeholder:text-base-content/70'
                value={query.search}
                placeholder={i18n.t('items.filter.searchPlaceholder')}
              />
            </BankField>
            <Button type='submit'>
              {i18n.t(query.view === 'overview' ? 'items.overview.update' : 'items.filter.apply')}
            </Button>
            <Button href={query.view ? '/items?view=overview' : '/items'} variant='ghost'>
              {i18n.t('items.filter.clear')}
            </Button>
          </div>
          {enrichment.schemes.length > 0 && (
            <Input type='hidden' name='loadedScheme' value={query.enrichment?.schemeId ?? ''} />
          )}
          <BankCategoryFiltersRoot
            view={enrichment}
            filter={query.enrichment ?? null}
            payload={payload}
            mode={query.view === 'overview' ? 'breakdown' : 'questions'}
          />
          <details
            open={Boolean(
              query.tags.length || query.type || query.standard || query.origin ||
                query.ownerUserId ||
                query.reviewState || query.compatibilityTarget || query.compatibilityOutcome ||
                query.lifecycle !== 'active' || query.duplicatesOnly || query.assignedToMe,
            )}
          >
            <summary class='cursor-pointer py-2 text-sm font-medium'>
              {i18n.t('items.filter.more')}
            </summary>
            <div class='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
              <BankField label={i18n.t('items.filter.tags')}>
                <Input
                  name='tags'
                  value={query.tags.join(', ')}
                  placeholder={i18n.t('items.filter.tagsPlaceholder')}
                />
              </BankField>
              <BankField label={i18n.t('items.filter.type')}>
                <Select name='type' value={query.type ?? ''}>
                  <option value=''>{i18n.t('items.filter.allTypes')}</option>
                  {bank.facets.types.map((type) => (
                    <option key={type.id} value={type.id}>{type.label}</option>
                  ))}
                </Select>
              </BankField>
              <BankField label={i18n.t('items.filter.standard')}>
                <Select name='standard' value={query.standard ?? ''}>
                  <option value=''>{i18n.t('items.filter.allStandards')}</option>
                  {bank.facets.standards.map((standard) => (
                    <option key={standard.id} value={standard.id}>{standard.label}</option>
                  ))}
                </Select>
              </BankField>
              <BankField label={i18n.t('items.filter.origin')}>
                <Select name='origin' value={query.origin ?? ''}>
                  <option value=''>{i18n.t('items.filter.allSources')}</option>
                  <option value='Authored'>{i18n.t('items.filter.authored')}</option>
                  <option value='Imported'>{i18n.t('items.filter.imported')}</option>
                  <option value='Variant'>{i18n.t('items.filter.variant')}</option>
                </Select>
              </BankField>
              <BankField label={i18n.t('items.filter.owner')}>
                <Select name='owner' value={query.ownerUserId ?? ''}>
                  <option value=''>{i18n.t('items.filter.allOwners')}</option>
                  {bank.facets.owners.map((owner) => (
                    <option key={owner.userId} value={owner.userId}>{owner.label}</option>
                  ))}
                </Select>
              </BankField>
              <BankField label={i18n.t('items.filter.review')}>
                <Select name='review' value={query.reviewState ?? ''}>
                  <option value=''>{i18n.t('items.filter.allReviews')}</option>
                  <option value='not_requested'>{i18n.t('items.review.notRequested')}</option>
                  <option value='open'>{i18n.t('items.review.inReview')}</option>
                  <option value='approved'>{i18n.t('items.review.approved')}</option>
                  <option value='changes_requested'>
                    {i18n.t('items.review.changesRequested')}
                  </option>
                </Select>
              </BankField>
              <BankField label={i18n.t('items.filter.target')}>
                <Select name='target' value={query.compatibilityTarget ?? ''}>
                  <option value=''>{i18n.t('items.filter.allTargets')}</option>
                  {bank.facets.targets.map((target) => (
                    <option key={target.id} value={target.id}>{target.label}</option>
                  ))}
                </Select>
              </BankField>
              <BankField label={i18n.t('items.filter.compatibility')}>
                <Select name='compatibility' value={query.compatibilityOutcome ?? ''}>
                  <option value=''>{i18n.t('items.filter.allResults')}</option>
                  <option value='exact'>{i18n.t('items.filter.exact')}</option>
                  <option value='normalized'>{i18n.t('items.filter.normalized')}</option>
                  <option value='lossy'>{i18n.t('items.filter.lossy')}</option>
                  <option value='blocked'>{i18n.t('items.filter.blocked')}</option>
                </Select>
              </BankField>
              <BankField label={i18n.t('items.filter.lifecycle')}>
                <Select name='lifecycle' value={query.lifecycle}>
                  <option value='active'>{i18n.t('items.filter.active')}</option>
                  <option value='archived'>{i18n.t('items.filter.archived')}</option>
                </Select>
              </BankField>
              <label
                class='flex min-h-11 items-center gap-3 self-end rounded-lg border border-base-300 px-3'
                htmlFor='duplicates-only'
              >
                <Checkbox
                  id='duplicates-only'
                  size='sm'
                  name='duplicates'
                  value='true'
                  checked={query.duplicatesOnly}
                />
                <span class='text-sm font-medium'>{i18n.t('items.filter.duplicates')}</span>
              </label>
              <label
                class='flex min-h-11 items-center gap-3 self-end rounded-lg border border-base-300 px-3'
                htmlFor='assigned-to-me'
              >
                <Checkbox
                  id='assigned-to-me'
                  size='sm'
                  name='assigned'
                  value='me'
                  checked={query.assignedToMe}
                />
                <span class='text-sm font-medium'>{i18n.t('items.filter.assigned')}</span>
              </label>
            </div>
          </details>
        </div>
      </form>

      {kind === 'overview'
        ? (
          <BankOverviewRoot
            view={enrichment}
            query={query}
            payload={payload}
            organizeHref={canManageContent && bank.total > 0
              ? `/items/organize?scope=${
                encodeURIComponent(pageHref(query, 1).slice('/items?'.length))
              }`
              : undefined}
          />
        )
        : (
          <>
            {enrichment.selection && (
              <p class='text-xs text-base-content/80'>
                {i18n.t('items.browse.audience', {
                  audience: enrichment.selection.scheme.audience,
                })}
              </p>
            )}
            <form method='post' action={pageHref(query, query.page)} class='group/bank space-y-3'>
              <Input type='hidden' name='operationId' value={collectionWorkspace.operationId} />
              <div class='hidden items-center gap-3 group-has-[input[name=questionId]:checked]/bank:flex flex-wrap'>
                <Button
                  type='submit'
                  formNoValidate
                  formAction='/releases/new'
                  name='action'
                  value='select'
                >
                  {i18n.t('releases.createSelected')}
                </Button>
                {canManageContent && (
                  <BankBulkControlsRoot
                    collections={collectionWorkspace.collections.filter((row) => !row.archivedAt)
                      .map(({ id, name }) => ({ id, name }))}
                    payload={payload}
                  />
                )}
              </div>
              <div class='overflow-hidden rounded-lg border border-base-300 bg-base-100'>
                <div class='flex flex-wrap items-center justify-between gap-3 border-b border-base-300 px-4 py-3'>
                  <p class='text-sm font-medium'>
                    {i18n.t('items.results.total', { count: bank.total })}
                  </p>
                  <div class='flex flex-wrap items-center gap-2'>
                    {canManageContent && enrichment.selection && bank.total > 0 && (
                      <Button
                        href={enrichmentCorrectionHref(enrichment.selection.scheme.versionId, {
                          _tag: 'Filtered',
                          queryString: pageHref(query, 1).slice('/items?'.length),
                        })}
                        variant='ghost'
                        size='sm'
                      >
                        {i18n.t('items.organize.editMatching')}
                      </Button>
                    )}
                    {canManageContent && bank.total > 0 && (
                      <Button
                        href={`/items/organize?scope=${
                          encodeURIComponent(pageHref(query, 1).slice('/items?'.length))
                        }`}
                        size='sm'
                      >
                        {i18n.t('items.organize.title')}
                      </Button>
                    )}
                    <p class='text-xs text-base-content/60'>
                      {i18n.t('items.results.page', { page: bank.page, pages: bank.pageCount })}
                    </p>
                  </div>
                </div>
                {bank.items.length === 0
                  ? (
                    <div class='px-5 py-10 text-center'>
                      <p class='font-medium'>{i18n.t('items.results.noResultsTitle')}</p>
                      <p class='mt-1 text-sm text-base-content/65'>
                        {i18n.t('items.results.noResultsHint')}
                      </p>
                    </div>
                  )
                  : (
                    <BankQuestionTableRoot
                      enrichment={enrichment.selection
                        ? { scheme: enrichment.selection.scheme, rows: enrichment.selection.rows }
                        : null}
                      bank={bank}
                      query={query}
                      canManage={canManageContent}
                      payload={payload}
                      returnHref={pageHref(query, query.page)}
                      sortHrefs={{
                        title: sortHref('title'),
                        review: sortHref('review'),
                        type: sortHref('type'),
                        origin: sortHref('origin'),
                        owner: sortHref('owner'),
                        revision: sortHref('revision'),
                        updated: sortHref('updated'),
                        difficulty: sortHref('difficulty'),
                      }}
                    />
                  )}
              </div>
            </form>

            <BankPagination
              page={bank.page}
              pageCount={bank.pageCount}
              pageHref={(page) => pageHref(query, page)}
              position='bottom'
              i18n={i18n}
            />
          </>
        )}
    </section>
  );
}

const BankCategoryFiltersRoot = mountIsland({
  component: 'BankCategoryFilters',
  View: BankCategoryFiltersView,
});
const BankOverviewRoot = mountIsland({ component: 'BankOverview', View: BankOverviewView });
const BankBulkControlsRoot = mountIsland({
  component: 'BankBulkControls',
  View: BankBulkControlsView,
});
const BankQuestionTableRoot = mountIsland({
  component: 'BankQuestionTable',
  View: BankQuestionTableView,
});

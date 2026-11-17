import BankQuestionChooser from './BankQuestionChooser.tsx';
import SelectedBankQuestions from './SelectedBankQuestions.tsx';
import { useBankProposals } from './useBankProposals.ts';
import LocalizedTimestamp from '../LocalizedTimestamp.tsx';
import { useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Input from '../../components/ui/Input.tsx';
import Select from '../../components/ui/Select.tsx';
import { BankField } from '../../components/item_bank/ui.tsx';
import { BankEnrichmentFilters } from '../../components/item_bank/BankEnrichmentFilters.tsx';
import { BankEnrichmentValue } from '../../components/item_bank/BankEnrichmentValue.tsx';
import type { EnrichmentQuestionsView } from '../../lib/services/bank_enrichment_browse_contract.ts';
import { ENRICHMENT_DIMENSIONS } from '../../lib/services/bank_enrichment_contract.ts';
import { useBankPicker } from './useBankPicker.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { LibraryItem } from '../../lib/question_bank_picker.ts';
import Checkbox from '../../components/ui/Checkbox.tsx';
import {
  BANK_SELECTION_LIMIT,
  type BankSelectionResult,
} from '../../lib/assessment_bank_selection.ts';
import { useBankSelection } from './useBankSelection.ts';
import type { SelectedBankQuestion } from '../../lib/assessment_bank_selection.ts';
import BankQuestionPreview, { type BankPreviewContext } from './BankQuestionPreview.tsx';

type LibraryResultsProps = {
  readonly items: readonly LibraryItem[];
  readonly total: number;
  readonly loading: boolean;
  readonly error: boolean;
  readonly enrichment: EnrichmentQuestionsView;
  readonly selected: readonly SelectedBankQuestion[];
  readonly existingItemIds: ReadonlySet<string>;
  readonly adding: boolean;
  readonly onToggle: (item: LibraryItem) => void;
  readonly previewContext: BankPreviewContext;
};

/** Content-first results with one on-demand preview and explicit selection controls. */
export function LibraryResults(props: LibraryResultsProps) {
  const i18n = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const classified = props.enrichment.selection;
  return (
    <>
      <p class='text-sm' role='status'>
        {props.loading
          ? i18n.t('assessments.builder.library.searching')
          : props.error
          ? i18n.t('assessments.builder.library.searchFailed')
          : i18n.t('assessments.builder.library.results', { count: props.total })}
      </p>
      <div
        class='divide-y divide-base-300 border-y border-base-300'
        aria-busy={props.loading}
        data-library-results
      >
        {!props.loading && !props.error && !props.items.length &&
          <p class='py-6 text-sm'>{i18n.t('assessments.builder.library.empty')}</p>}
        {props.items.map((item) => {
          const selected = props.selected.find((entry) => entry.question.id === item.id);
          const included = props.existingItemIds.has(item.id);
          const revision = selected?.question.latestRev ?? item.latestRev;
          const open = expanded === item.id;
          return (
            <div key={item.id} class='py-3' data-library-item={item.id}>
              <div class='flex items-start gap-3'>
                <label class='flex min-h-11 min-w-11 items-center justify-center'>
                  <Checkbox
                    checked={Boolean(selected) || included}
                    disabled={props.adding || included ||
                      (!selected && props.selected.length >= BANK_SELECTION_LIMIT)}
                    onChange={() => props.onToggle(item)}
                    aria-label={i18n.t('assessments.builder.library.selectQuestion', {
                      title: item.excerpt || item.title,
                    })}
                  />
                </label>
                <div class='min-w-0 flex-1 space-y-2'>
                  <Button
                    type='button'
                    variant='text'
                    class='h-auto min-h-11 w-full justify-start whitespace-normal break-words text-left font-medium'
                    aria-expanded={open}
                    aria-controls={`bank-preview-${item.id}`}
                    onClick={() => setExpanded(open ? null : item.id)}
                  >
                    {item.excerpt || item.title || i18n.t('assessments.builder.untitledItem')}
                  </Button>
                  <div class='flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-base-content/80'>
                    {item.excerpt && <span>{item.title}</span>}
                    <span>
                      {i18n.t('assessments.builder.questionTypeLabel', { type: item.type })}
                    </span>
                    <LocalizedTimestamp
                      value={item.updatedAt}
                      locale={i18n.locale}
                      showTime={false}
                    />
                    {item.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
                    {included && (
                      <strong>{i18n.t('assessments.builder.library.inAssessment')}</strong>
                    )}
                    {classified && ENRICHMENT_DIMENSIONS.map((dimension) => (
                      <span key={dimension}>
                        <span class='sr-only'>{i18n.t(`items.browse.${dimension}`)}:</span>
                        <BankEnrichmentValue
                          value={classified.rows[item.id][dimension]}
                          scheme={classified.scheme}
                          i18n={i18n}
                        />
                      </span>
                    ))}
                  </div>
                  <Button
                    type='button'
                    size='sm'
                    variant='text'
                    aria-expanded={open}
                    aria-controls={`bank-preview-${item.id}`}
                    onClick={() => setExpanded(open ? null : item.id)}
                  >
                    {i18n.t(
                      open
                        ? 'assessments.builder.library.hidePreview'
                        : 'assessments.builder.library.preview',
                    )}
                  </Button>
                </div>
              </div>
              <div id={`bank-preview-${item.id}`} hidden={!open} class='pb-2 pt-3 sm:pl-14'>
                {open && (
                  <BankQuestionPreview
                    key={`${item.id}:${revision}`}
                    itemId={item.id}
                    revision={revision}
                    {...props.previewContext}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Multi-select library picker kept mounted while questions are appended. */
export default function ImportPicker(props: {
  readonly assessmentId: string;
  readonly partId: string;
  readonly beforePlacementId?: string;
  readonly partTitle: string;
  readonly existingItemIds: ReadonlySet<string>;
  readonly onAdded: (result: BankSelectionResult) => void;
  readonly previewContext: BankPreviewContext;
}) {
  const i18n = useI18n();
  const picker = useBankPicker();
  const selectionState = useBankSelection(props);
  const { selected, state } = selectionState;
  const proposals = useBankProposals({
    assessmentId: props.assessmentId,
    scope: picker.scope,
    searchLoading: picker.loading,
    selected,
    onAccept: selectionState.acceptProposal,
  });
  const adding = state.kind === 'adding';
  const busy = adding || proposals.action.kind === 'pending';
  const { result, enrichment, selection, loading, error } = picker;
  return (
    <div class='grid gap-3' data-library-picker>
      <form
        class='space-y-3'
        onSubmit={(event) => {
          event.preventDefault();
          picker.retry();
        }}
      >
        <fieldset disabled={busy} class='space-y-3'>
          <div class='grid gap-3 sm:grid-cols-2'>
            <BankField label={i18n.t('assessments.builder.library.search')}>
              <Input
                id='assessment-library-search'
                value={selection.q}
                onInput={(e) => picker.change('q', e.currentTarget.value)}
                placeholder={i18n.t('assessments.builder.library.titlePlaceholder')}
                data-focus-library-search='true'
              />
            </BankField>
            <BankField label={i18n.t('assessments.builder.library.collection')}>
              <Select
                name='collection'
                value={selection.collection}
                onChange={(event) => picker.change('collection', event.currentTarget.value)}
              >
                <option value=''>{i18n.t('items.collections.all')}</option>
                <option value='unfiled'>{i18n.t('items.collections.unfiled')}</option>
                {result?.collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>{collection.name}</option>
                ))}
              </Select>
            </BankField>
          </div>
          <div
            onChange={(event) => {
              const control = event.target;
              if (!(control instanceof HTMLSelectElement)) return;
              const field = control.name;
              if (
                field === 'scheme' || field === 'subject' || field === 'topic' ||
                field === 'difficulty'
              ) picker.changeCategory(field, control.value);
            }}
          >
            <BankEnrichmentFilters
              ownership='component'
              view={enrichment}
              filter={selection.enrichment}
              i18n={i18n}
            />
          </div>
          <details>
            <summary class='cursor-pointer text-sm'>
              {i18n.t('assessments.builder.library.tags')}
            </summary>
            <label class='sr-only' for='assessment-library-tags'>
              {i18n.t('assessments.builder.library.tags')}
            </label>
            <Input
              id='assessment-library-tags'
              value={selection.tags}
              onInput={(e) => picker.change('tags', e.currentTarget.value)}
              placeholder={i18n.t('assessments.builder.library.tagsPlaceholder')}
            />
          </details>
          {enrichment.selection && !proposals.open && (
            <p class='text-xs text-base-content/70'>
              {i18n.t('items.browse.audience', { audience: enrichment.selection.scheme.audience })}
            </p>
          )}
          {(selection.q || selection.tags || selection.collection || selection.enrichment) &&
            (
              <Button type='button' variant='text' onClick={picker.clear}>
                {i18n.t('items.filter.clear')}
              </Button>
            )}
        </fieldset>
      </form>
      <BankQuestionChooser proposals={proposals} selectedCount={selected.length} disabled={busy} />
      <SelectedBankQuestions
        selected={selected}
        busy={busy}
        onRemove={selectionState.remove}
        proposals={proposals}
        previewContext={props.previewContext}
      />
      <LibraryResults
        items={loading || error ? [] : result?.items ?? []}
        total={result?.total ?? 0}
        loading={loading}
        error={error}
        enrichment={enrichment}
        selected={selected}
        existingItemIds={props.existingItemIds}
        adding={busy}
        onToggle={selectionState.toggle}
        previewContext={props.previewContext}
      />
      {error && (
        <Button
          type='button'
          size='sm'
          variant='ghost'
          onClick={picker.retry}
        >
          {i18n.t('assessments.builder.library.retry')}
        </Button>
      )}
      {result && !error && result.total > 0 && (
        <nav
          class='flex flex-wrap items-center justify-between gap-2'
          aria-label={i18n.t('items.results.paginationLabel')}
        >
          <Button
            type='button'
            variant='default'
            size='sm'
            disabled={busy || loading || picker.page === 1}
            onClick={() => picker.goToPage(picker.page - 1)}
          >
            {i18n.t('items.results.previous')}
          </Button>
          <span class='text-xs'>
            {i18n.t('items.results.page', { page: picker.page, pages: picker.pageCount })}
          </span>
          <Button
            type='button'
            variant='default'
            size='sm'
            disabled={busy || loading || !result.hasMore}
            onClick={() => picker.goToPage(picker.page + 1)}
          >
            {i18n.t('items.results.next')}
          </Button>
        </nav>
      )}
      <Button href={picker.bankHref} target='_blank' rel='noreferrer' variant='text'>
        {i18n.t('assessments.builder.library.open')}
      </Button>
      <div class='sticky -bottom-4 z-10 -mx-4 -mb-4 space-y-3 border-t border-base-300 bg-base-100 px-4 py-3 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6'>
        {selected.length === BANK_SELECTION_LIMIT && (
          <p role='status' class='text-sm'>
            {i18n.t('assessments.builder.library.selectionLimit', { count: BANK_SELECTION_LIMIT })}
          </p>
        )}
        {state.kind === 'failed' && (
          <p role='alert' class='text-sm text-error'>
            {i18n.t(`assessments.builder.library.addError.${state.reason}`)}
          </p>
        )}
        {state.kind === 'added' && (
          <p role='status' class='text-sm'>
            {i18n.t('assessments.builder.library.added', {
              count: state.count,
              part: props.partTitle,
            })}
          </p>
        )}
        <div class='flex flex-wrap items-center justify-between gap-2'>
          <span class='text-sm'>
            {i18n.t('assessments.builder.library.destination', { part: props.partTitle })}
          </span>
          <div class='flex flex-wrap gap-2'>
            {selected.length > 0 && (
              <Button variant='text' disabled={busy} onClick={selectionState.clear}>
                {i18n.t('assessments.builder.library.clearSelection')}
              </Button>
            )}
            <Button
              variant='primary'
              disabled={busy || !selected.length}
              onClick={() => void selectionState.add()}
            >
              {i18n.t(
                adding
                  ? 'assessments.builder.library.adding'
                  : 'assessments.builder.library.addSelected',
                { count: selected.length },
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

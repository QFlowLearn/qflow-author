import { useHydrated } from '../lib/client/use_hydrated.ts';
import Button from '../components/ui/Button.tsx';
import { enrichmentCorrectionHref } from '../lib/bank_enrichment_correction_link.ts';
import { BankEnrichmentValue } from '../components/item_bank/BankEnrichmentValue.tsx';
import type { EnrichmentQuestionsView } from '../lib/services/bank_enrichment_browse_contract.ts';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import type { QuestionBankPage } from '../lib/services/question_bank_read.ts';
import type {
  QuestionBankQuery,
  QuestionBankSortField,
} from '../lib/services/question_bank_query.ts';
import Checkbox from '../components/ui/Checkbox.tsx';
import { SortHeader, Table } from '../components/ui/Table.tsx';
import { BankBadge, formatBankDate, ReviewStateBadge } from '../components/item_bank/ui.tsx';
import { CompatibilitySummary } from '../components/item_bank/CompatibilitySummary.tsx';

const optionalColumns = ['origin', 'owner', 'revision'] as const;
type OptionalColumn = typeof optionalColumns[number];
function isOptionalColumn(field: QuestionBankSortField): field is OptionalColumn {
  return field === 'origin' || field === 'owner' || field === 'revision';
}

/** Compact, server-sorted bank results; selecting questions retains the bulk form contract. */
export default function BankQuestionTable(props: {
  readonly enrichment:
    | Pick<NonNullable<EnrichmentQuestionsView['selection']>, 'scheme' | 'rows'>
    | null;
  readonly bank: QuestionBankPage;
  readonly query: QuestionBankQuery;
  readonly canManage: boolean;
  readonly payload: I18nPayload;
  readonly sortHrefs: Record<QuestionBankSortField, string>;
  readonly returnHref: string;
}) {
  const hydrated = useHydrated();
  const { bank, query, enrichment } = props;
  const i18n = createI18n(props.payload.locale, props.payload.namespaces);
  const [visibleOptionalColumns, setVisibleOptionalColumns] = useState<ReadonlySet<OptionalColumn>>(
    new Set(),
  );
  const [selected, setSelected] = useState<readonly string[]>([]);
  const rows = useRef<HTMLTableSectionElement>(null);
  function selectionInputs() {
    if (!rows.current) throw new Error('Question selection rows are not mounted.');
    return [...rows.current.querySelectorAll<HTMLInputElement>('input[name=questionId]')];
  }
  function synchronizeSelection() {
    setSelected(selectionInputs().filter((input) => input.checked).map((input) => input.value));
  }
  // Native controls own selection, including input made while the island module was loading.
  useLayoutEffect(synchronizeSelection, []);
  const columns = ['title', 'review', 'type', 'origin', 'owner', 'revision', 'updated'] as const;
  return (
    <>
      <div class='flex flex-wrap items-center justify-between gap-3 px-4 py-2'>
        <span role='status' class='text-sm'>
          {selected.length > 0
            ? i18n.t('items.table.selectedCount', { count: selected.length })
            : ''}
        </span>
        {props.canManage && enrichment && selected.length > 0 && (
          <Button
            href={enrichmentCorrectionHref(enrichment.scheme.versionId, {
              _tag: 'Selected',
              questionIds: selected,
            })}
            size='sm'
          >
            {i18n.t('items.organize.editSelected')}
          </Button>
        )}
        <details>
          <summary class='cursor-pointer py-2 text-sm'>{i18n.t('items.table.columns')}</summary>
          {optionalColumns.map((field) => (
            <label key={field} class='flex items-center gap-2 py-2'>
              <Checkbox
                disabled={!hydrated}
                checked={visibleOptionalColumns.has(field)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setVisibleOptionalColumns((current) => {
                    const next = new Set(current);
                    if (checked) next.add(field);
                    else next.delete(field);
                    return next;
                  });
                }}
              />
              {i18n.t(`items.table.${field}`)}
            </label>
          ))}
        </details>
      </div>
      <Table label={i18n.t('items.table.caption')}>
        <thead>
          <tr>
            {props.canManage && (
              <th scope='col'>
                <Checkbox
                  aria-label={i18n.t('items.table.selectPage')}
                  disabled={!hydrated}
                  checked={bank.items.length > 0 && selected.length === bank.items.length}
                  onChange={(event) => {
                    for (const input of selectionInputs()) {
                      input.checked = event.currentTarget.checked;
                    }
                    synchronizeSelection();
                  }}
                />
              </th>
            )}
            {columns.filter((field) =>
              !isOptionalColumn(field) || visibleOptionalColumns.has(field)
            )
              .map((field) => (
                <SortHeader
                  key={field}
                  label={i18n.t(`items.table.${field}`)}
                  href={props.sortHrefs[field]}
                  direction={query.sort?.field === field
                    ? query.sort.direction
                    : !query.sort && query.collection?._tag !== 'Collection' && field === 'updated'
                    ? 'desc'
                    : undefined}
                />
              ))}
            {enrichment && (
              <SortHeader
                label={i18n.t('items.browse.difficulty')}
                href={props.sortHrefs.difficulty}
                direction={query.sort?.field === 'difficulty' ? query.sort.direction : undefined}
              />
            )}
            {query.compatibilityTarget && (
              <th scope='col'>{i18n.t('items.compatibility.exportProfiles')}</th>
            )}
          </tr>
        </thead>
        <tbody ref={rows}>
          {bank.items.map((item) => (
            <tr id={`question-${item.id}`} key={item.id} class='scroll-mt-24 hover:bg-base-200/50'>
              {props.canManage && (
                <td>
                  <Checkbox
                    size='sm'
                    name='questionId'
                    value={item.id}
                    onChange={synchronizeSelection}
                    aria-label={i18n.t('items.results.select', { title: item.title })}
                  />
                </td>
              )}
              <td class='min-w-64 max-w-md whitespace-normal'>
                <a
                  class='font-medium underline decoration-base-content/30 underline-offset-4 hover:decoration-current break-words'
                  href={`/items/${item.id}?bank=${
                    encodeURIComponent(`${props.returnHref}#question-${item.id}`)
                  }`}
                >
                  {item.origin === 'Imported' && item.excerpt ? item.excerpt : item.title}
                </a>
                {item.origin === 'Imported' && item.excerpt && (
                  <p class='mt-1 text-xs text-base-content/80'>{item.title}</p>
                )}
                {enrichment && (
                  <div class='mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/80'>
                    {(['subject', 'topic'] as const).map((dimension) => (
                      <span key={dimension}>
                        <span class='sr-only'>{i18n.t(`items.browse.${dimension}`)}:</span>
                        <BankEnrichmentValue
                          value={enrichment.rows[item.id][dimension]}
                          group={{ query, dimension }}
                          scheme={enrichment.scheme}
                          i18n={i18n}
                        />
                      </span>
                    ))}
                  </div>
                )}
                <div class='mt-1 flex flex-wrap gap-1 text-xs text-base-content/80'>
                  {item.lifecycle === 'archived' && (
                    <BankBadge>{i18n.t('items.results.archived')}</BankBadge>
                  )}
                  {item.duplicateCount > 1 && (
                    <BankBadge>
                      {i18n.t('items.results.exactCopy', { count: item.duplicateCount })}
                    </BankBadge>
                  )}
                  {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
                  {item.standards.slice(0, 2).map((standard) => (
                    <BankBadge key={standard.id}>{standard.label}</BankBadge>
                  ))}
                </div>
              </td>
              <td class='whitespace-nowrap'>
                <ReviewStateBadge state={item.reviewState} i18n={i18n} />
              </td>
              <td class='whitespace-nowrap'>{item.typeLabel}</td>
              {visibleOptionalColumns.has('origin') && (
                <td>
                  {i18n.t(
                    {
                      Authored: 'items.filter.authored',
                      Imported: 'items.filter.imported',
                      Variant: 'items.filter.variant',
                    }[item.origin],
                  )}
                </td>
              )}
              {visibleOptionalColumns.has('owner') && (
                <td class='whitespace-nowrap'>{item.owner.label}</td>
              )}
              {visibleOptionalColumns.has('revision') && (
                <td class='tabular-nums'>{item.revision}</td>
              )}
              <td class='whitespace-nowrap'>
                {formatBankDate(item.updatedAt, i18n)}
              </td>
              {enrichment && (
                <td class='min-w-32 whitespace-normal'>
                  <BankEnrichmentValue
                    value={enrichment.rows[item.id].difficulty}
                    scheme={enrichment.scheme}
                    i18n={i18n}
                  />
                </td>
              )}
              {query.compatibilityTarget && (
                <td>
                  <CompatibilitySummary
                    compatibility={item.compatibility}
                    selectedTarget={query.compatibilityTarget}
                    targets={bank.facets.targets}
                    i18n={i18n}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

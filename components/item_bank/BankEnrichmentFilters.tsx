import Select from '../ui/Select.tsx';
import { BankField } from './ui.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { EnrichmentBrowseView } from '../../lib/services/bank_enrichment_browse_contract.ts';
import { ENRICHMENT_DIMENSIONS } from '../../lib/services/bank_enrichment_contract.ts';
import {
  type BankEnrichmentFilter,
  bankEnrichmentFilterValue,
  bankEnrichmentRefinement,
  bankEnrichmentStatusFilter,
} from '../../lib/services/bank_enrichment_query.ts';

/** Native selected attributes preserve input during loading; component ownership reflects the filter. */
export function BankEnrichmentFilters(props: {
  readonly view: EnrichmentBrowseView;
  readonly ownership: 'native' | 'component';
  readonly filter: BankEnrichmentFilter | null;
  readonly i18n: I18n;
  readonly dimensions?: readonly (typeof ENRICHMENT_DIMENSIONS)[number][];
  readonly showStatuses?: boolean;
}) {
  const { i18n } = props;
  if (props.view.schemes.length === 0) return null;
  const selection = props.view.selection;
  const nativeSelection = (selected: boolean) => props.ownership === 'native' ? { selected } : {};
  return (
    <div class='space-y-2'>
      <div class='grid grid-cols-2 gap-3 xl:grid-cols-4'>
        <BankField label={i18n.t('items.browse.vocabulary')}>
          <Select
            name='scheme'
            {...(props.ownership === 'component' ? { value: props.filter?.schemeId ?? '' } : {})}
          >
            <option value='' {...nativeSelection(!props.filter?.schemeId)}>
              {i18n.t('items.browse.none')}
            </option>
            {props.view.schemes.map((scheme) => (
              <option
                key={scheme.id}
                value={scheme.id}
                {...nativeSelection(props.filter?.schemeId === scheme.id)}
              >
                {scheme.name}
              </option>
            ))}
          </Select>
        </BankField>
        {(props.dimensions ?? ENRICHMENT_DIMENSIONS).map((dimension) => {
          const facet = selection?.facets[dimension];
          const versions = [...new Set(facet?.categories.map((c) => c.versionId))];
          const selected = props.filter?.[dimension];
          const freshness = selected?.freshness ?? 'any';
          const outdated = freshness === 'outdated';
          const filterValue = props.filter?.[dimension]
            ? bankEnrichmentFilterValue(props.filter[dimension])
            : '';
          return (
            <BankField key={dimension} label={i18n.t(`items.browse.${dimension}`)}>
              <Select
                name={dimension}
                {...(props.ownership === 'component' ? { value: filterValue } : {})}
                disabled={!selection}
              >
                <option value='' {...nativeSelection(filterValue === '')}>
                  {i18n.t(selection ? 'items.browse.all' : 'items.browse.none')}
                </option>
                {facet && versions.map((versionId) => {
                  const categories = facet.categories.filter((c) => c.versionId === versionId);
                  const version = categories[0];
                  return (
                    <optgroup
                      key={versionId}
                      label={i18n.t('items.browse.versionAudience', {
                        version: version.version,
                        audience: version.audience,
                      })}
                    >
                      {categories.map((category) => {
                        const value = bankEnrichmentFilterValue({
                          kind: 'value',
                          versionId,
                          valueId: category.id,
                          freshness,
                        });
                        return (
                          <option
                            key={category.id}
                            value={value}
                            {...nativeSelection(filterValue === value)}
                          >
                            {i18n.t('items.browse.counted', {
                              label: outdated
                                ? `${category.label} (${i18n.t('items.browse.outdated')})`
                                : category.label,
                              count: category.count,
                            })}
                          </option>
                        );
                      })}
                    </optgroup>
                  );
                })}
                {facet && props.showStatuses !== false && (
                  <optgroup label={i18n.t('items.browse.status')}>
                    {(['unassigned', 'pending', 'outside', 'outdated'] as const).map((state) => {
                      const status = bankEnrichmentStatusFilter(state);
                      const option = state === 'outdated'
                        ? status
                        : bankEnrichmentRefinement(selected ?? null, status);
                      if (!option) {
                        return null;
                      }
                      const value = bankEnrichmentFilterValue(option);
                      return (
                        <option
                          key={state}
                          value={value}
                          {...nativeSelection(filterValue === value)}
                        >
                          {i18n.t('items.browse.counted', {
                            label: state === 'unassigned' && outdated
                              ? `${i18n.t('items.browse.unassigned')} (${
                                i18n.t('items.browse.outdated')
                              })`
                              : i18n.t(`items.browse.${state}`),
                            count: facet[state],
                          })}
                        </option>
                      );
                    })}
                  </optgroup>
                )}
              </Select>
            </BankField>
          );
        })}
      </div>
      {(props.view.schemesTruncated ||
        selection && ENRICHMENT_DIMENSIONS.some((d) => selection.facets[d].truncated)) && (
        <p class='text-xs text-base-content/80'>{i18n.t('items.browse.limited')}</p>
      )}
    </div>
  );
}

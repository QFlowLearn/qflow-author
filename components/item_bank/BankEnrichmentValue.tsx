import Button from '../ui/Button.tsx';
import { questionBankGroupHref } from '../../lib/question_bank_link.ts';
import type { QuestionBankQuery } from '../../lib/services/question_bank_query.ts';
import type { I18n } from '../../lib/i18n/messages.ts';
import type {
  EnrichmentBrowseScheme,
  EnrichmentBrowseValue,
} from '../../lib/services/bank_enrichment_browse_contract.ts';

/** Compact producing labels with explicit unfinished, unassigned and stale-source states. */
export function BankEnrichmentValue(
  props: {
    readonly value: EnrichmentBrowseValue;
    readonly scheme: EnrichmentBrowseScheme;
    readonly i18n: I18n;
    readonly group?: { readonly query: QuestionBankQuery; readonly dimension: 'subject' | 'topic' };
  },
) {
  const { value, scheme, i18n } = props;
  if (value.state !== 'classified') return <span>{i18n.t(`items.browse.${value.state}`)}</span>;
  return (
    <span>
      {value.value.state === 'assigned'
        ? value.categories.map((category, index) => (
          <span key={category.id}>
            {index > 0 && ', '}
            {props.group
              ? (
                <Button
                  variant='text'
                  href={questionBankGroupHref(props.group.query, {
                    [props.group.dimension]: {
                      kind: 'value',
                      versionId: value.versionId,
                      valueId: category.id,
                      freshness: 'any',
                    },
                  })}
                >
                  {category.label}
                </Button>
              )
              : category.label}
          </span>
        ))
        : i18n.t(`items.browse.reason.${value.value.reason}`)}
      {value.version !== scheme.version && (
        <span class='block text-xs text-base-content/80'>
          {i18n.t('items.browse.versionAudience', {
            version: value.version,
            audience: value.audience,
          })}
        </span>
      )}
      {value.outdated && (
        <span class='block text-xs text-base-content/80'>{i18n.t('items.browse.outdated')}</span>
      )}
    </span>
  );
}

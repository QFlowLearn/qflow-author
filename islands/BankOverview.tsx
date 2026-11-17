import { BankOverview as Overview } from '../components/item_bank/BankOverview.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import type { EnrichmentOverviewView } from '../lib/services/bank_enrichment_browse_contract.ts';
import type { QuestionBankQuery } from '../lib/services/question_bank_query.ts';

/** Own the entire valid overview/table tree; subject disclosures are nested components. */
export default function BankOverview(props: {
  readonly view: EnrichmentOverviewView;
  readonly query: QuestionBankQuery;
  readonly payload: I18nPayload;
  readonly organizeHref?: string;
}) {
  return (
    <Overview
      view={props.view}
      query={props.query}
      organizeHref={props.organizeHref}
      i18n={createI18n(props.payload.locale, props.payload.namespaces)}
    />
  );
}

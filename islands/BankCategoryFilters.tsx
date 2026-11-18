import { reportUiError } from '../lib/client/ui_event.ts';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { BankEnrichmentFilters } from '../components/item_bank/BankEnrichmentFilters.tsx';
import { parseEnrichmentQuestionsView } from '../lib/bank_enrichment_browse_response.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import { ENRICHMENT_DIMENSIONS } from '../lib/services/bank_enrichment_contract.ts';
import {
  type BankEnrichmentFilter,
  parseBankEnrichmentFilter,
} from '../lib/services/bank_enrichment_query.ts';
import type { EnrichmentBrowseView } from '../lib/services/bank_enrichment_browse_contract.ts';

type FiltersState = {
  readonly view: EnrichmentBrowseView;
  readonly filter: BankEnrichmentFilter | null;
  readonly loading: boolean;
  readonly error: boolean;
};

/** Refresh category counts from the same server projection used by the question bank. */
export default function BankCategoryFilters(props: {
  readonly view: EnrichmentBrowseView;
  readonly filter: BankEnrichmentFilter | null;
  readonly payload: I18nPayload;
  readonly mode: 'questions' | 'breakdown';
}) {
  const i18n = createI18n(props.payload.locale, props.payload.namespaces);
  const [state, setState] = useState<FiltersState>({
    view: props.view,
    filter: props.filter,
    loading: false,
    error: false,
  });
  const [hydrated, setHydrated] = useState(false);
  const confirmed = useRef({ view: props.view, filter: props.filter });
  const activeRequest = useRef<AbortController | null>(null);
  const filtersRoot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Adopt native edits before component-controlled values can overwrite them during hydration.
    if (props.view.schemes.length > 0) {
      const root = filtersRoot.current;
      if (!root) throw new Error('Category filter controls are not mounted.');
      for (const select of root.querySelectorAll('select')) {
        if (!(select instanceof HTMLSelectElement)) throw new Error('Invalid category control.');
        const options = [...select.options];
        const initial = options.find((option) => option.defaultSelected) ?? options[0];
        if (!initial) throw new Error('Category control has no initial option.');
        if (select.value !== initial.value) {
          changeSelect(select);
          break;
        }
      }
    }
    setHydrated(true);
  }, []);
  useEffect(() => () => activeRequest.current?.abort(), []);

  function change(event: Event) {
    const target = event.target;
    if (target instanceof HTMLSelectElement) changeSelect(target);
  }

  function changeSelect(target: HTMLSelectElement) {
    if (target.name !== 'scheme' && !ENRICHMENT_DIMENSIONS.some((name) => name === target.name)) {
      return;
    }
    const form = target.form;
    if (!form) return;
    const params = new URLSearchParams();
    for (const [name, value] of new FormData(form)) {
      if (typeof value === 'string') params.append(name, value);
    }
    if (target.name === 'scheme') {
      for (const dimension of ENRICHMENT_DIMENSIONS) params.delete(dimension);
    }
    const next = parseBankEnrichmentFilter(params);
    if (!next.ok) {
      setState((current) => ({ ...current, error: true }));
      return;
    }

    const filter = next.value;
    if (props.mode === 'breakdown') {
      setState((current) => ({ ...current, filter, error: false }));
      form.requestSubmit();
      return;
    }
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setState((current) => ({
      view: target.name === 'scheme' ? { ...current.view, selection: null } : current.view,
      filter,
      loading: true,
      error: false,
    }));

    const refresh = async () => {
      try {
        const response = await fetch(`/api/items/facets?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Category counts request failed.');
        const view = parseEnrichmentQuestionsView(await response.json(), []);
        if (!view || view.selection?.scheme.id !== filter?.schemeId) {
          throw new Error('Invalid category counts response.');
        }
        if (controller.signal.aborted) return;
        const loadedScheme = form.elements.namedItem('loadedScheme');
        if (!(loadedScheme instanceof HTMLInputElement)) {
          throw new Error('Missing loaded category set.');
        }
        loadedScheme.value = filter?.schemeId ?? '';
        confirmed.current = { view, filter };
        setState({ view, filter, loading: false, error: false });
      } catch {
        if (!controller.signal.aborted) {
          setState({ ...confirmed.current, loading: false, error: true });
        }
      }
    };
    refresh().catch(reportUiError);
  }

  if (state.view.schemes.length === 0) return null;
  if (props.mode === 'breakdown') {
    return (
      <>
        <div ref={filtersRoot} onChange={change} data-hydrated={hydrated ? 'true' : undefined}>
          <BankEnrichmentFilters
            ownership={hydrated ? 'component' : 'native'}
            view={props.view}
            filter={state.filter}
            i18n={i18n}
          />
        </div>
        <noscript>
          <p class='text-sm'>{i18n.t('items.overview.applyManually')}</p>
        </noscript>
      </>
    );
  }
  return (
    <>
      <div ref={filtersRoot} onChange={change} aria-busy={state.loading}>
        <BankEnrichmentFilters
          ownership={hydrated ? 'component' : 'native'}
          view={state.view}
          filter={state.filter}
          i18n={i18n}
        />
      </div>
      {state.loading
        ? <p role='status' class='text-sm'>{i18n.t('items.browse.updatingCounts')}</p>
        : state.error
        ? <p role='alert' class='text-sm'>{i18n.t('items.browse.countsFailed')}</p>
        : state.view.selection && hydrated
        ? <p class='text-sm'>{i18n.t('items.browse.countsHint')}</p>
        : !state.view.selection
        ? <p role='status' class='text-sm'>{i18n.t('items.browse.applyVocabulary')}</p>
        : null}
      <noscript>
        <p class='text-sm'>{i18n.t('items.browse.applyManually')}</p>
      </noscript>
    </>
  );
}

import { reportUiError, uiEvent } from '../../lib/client/ui_event.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import { type LibrarySearch, parseLibrarySearchResponse } from '../../lib/question_bank_picker.ts';
import {
  appendBankEnrichmentFilter,
  type BankEnrichmentFilter,
  parseBankEnrichmentFilter,
} from '../../lib/services/bank_enrichment_query.ts';
import type { EnrichmentDimension } from '../../lib/services/bank_enrichment_contract.ts';
import type { EnrichmentQuestionsView } from '../../lib/services/bank_enrichment_browse_contract.ts';

const PAGE_SIZE = 10;
type RequestTiming = 'immediate' | 'debounced';
type Selection = {
  readonly q: string;
  readonly tags: string;
  readonly collection: string;
  readonly enrichment: BankEnrichmentFilter | null;
};
const EMPTY_SELECTION: Selection = { q: '', tags: '', collection: '', enrichment: null };

/** A bounded page of the current selection; obsolete and unmounted requests cannot replace it. */
export function useBankPicker(initialScope = '') {
  const activeRequest = useRef<AbortController | null>(null);
  const [selection, setSelection] = useState(() => {
    if (!initialScope) return EMPTY_SELECTION;
    const params = new URLSearchParams(initialScope);
    const enrichment = parseBankEnrichmentFilter(params);
    if (!enrichment.ok) throw new Error('Invalid initial bank scope.');
    return {
      q: params.get('q') ?? '',
      tags: params.get('tags') ?? '',
      collection: params.get('collection') ?? '',
      enrichment: enrichment.value,
    };
  });
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [timing, setTiming] = useState<RequestTiming>('immediate');
  const [result, setResult] = useState<LibrarySearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError(false);
    // This effect owns the request, including rejection handling and cancellation on cleanup.
    const search = async () => {
      try {
        const params = selectionParams(selection);
        params.set('pageSize', String(PAGE_SIZE));
        params.set('page', String(page));
        const response = await fetch(`/api/items/search?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Question search failed.');
        const parsed = parseLibrarySearchResponse(await response.json());
        if (!parsed || parsed.enrichment.selection?.scheme.id !== selection.enrichment?.schemeId) {
          throw new Error('Invalid question search response.');
        }
        if (!controller.signal.aborted) setResult(parsed);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    const timer = timing === 'debounced' ? setTimeout(uiEvent(search), 250) : null;
    if (timing === 'immediate') search().catch(reportUiError);
    return () => {
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [selection, page, attempt, timing]);

  // Retain category-set choices while loading, but never show another set's facets or rows.
  const enrichment: EnrichmentQuestionsView = result
    ? {
      ...result.enrichment,
      selection: result.enrichment.selection?.scheme.id === selection.enrichment?.schemeId
        ? result.enrichment.selection
        : null,
    }
    : { schemes: [], schemesTruncated: false, selection: null };

  function select(next: Selection, timing: RequestTiming) {
    activeRequest.current?.abort();
    setLoading(true);
    setTiming(timing);
    setPage(1);
    setSelection(next);
  }
  return {
    selection,
    scope: selectionParams(selection).toString(),
    bankHref: `/items?${selectionParams(selection)}`,
    result,
    enrichment,
    loading,
    error,
    page,
    pageCount: Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE)),
    change(field: 'q' | 'tags' | 'collection', value: string) {
      select({ ...selection, [field]: value }, field === 'collection' ? 'immediate' : 'debounced');
    },
    changeCategory(field: 'scheme' | EnrichmentDimension, value: string) {
      const params = new URLSearchParams();
      if (field !== 'scheme' && selection.enrichment) {
        appendBankEnrichmentFilter(params, selection.enrichment);
      }
      params.set(field, value);
      const parsed = parseBankEnrichmentFilter(params);
      if (!parsed.ok) throw new Error('Invalid category option.');
      select({ ...selection, enrichment: parsed.value }, 'immediate');
    },
    clear() {
      select(EMPTY_SELECTION, 'immediate');
    },
    goToPage(page: number) {
      activeRequest.current?.abort();
      setLoading(true);
      setTiming('immediate');
      setPage(page);
    },
    retry() {
      activeRequest.current?.abort();
      setLoading(true);
      setTiming('immediate');
      setAttempt((value) => value + 1);
    },
  };
}

function selectionParams(selection: Selection): URLSearchParams {
  const params = new URLSearchParams({
    q: selection.q,
    tags: selection.tags,
    collection: selection.collection,
  });
  if (selection.enrichment) appendBankEnrichmentFilter(params, selection.enrichment);
  return params;
}

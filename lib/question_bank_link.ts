import type { QuestionBankQuery } from './services/question_bank_query.ts';
import {
  appendBankEnrichmentFilter,
  bankEnrichmentRefinement,
} from './services/bank_enrichment_query.ts';
import type { BankEnrichmentValueFilter } from './services/bank_enrichment_query.ts';
import type { EnrichmentDimension } from './services/bank_enrichment_contract.ts';

/** Drill down within the current selection, preserving revision-status intersections. */
export function questionBankGroupHref(
  query: QuestionBankQuery,
  filters: Readonly<Partial<Record<EnrichmentDimension, BankEnrichmentValueFilter>>>,
): string {
  if (!query.enrichment) throw new Error('Category drill-down requires a category set.');
  const enrichment = { ...query.enrichment };
  for (const dimension of ['subject', 'topic', 'difficulty'] as const) {
    const next = filters[dimension], current = enrichment[dimension];
    if (!next) continue;
    const refined = bankEnrichmentRefinement(current, next);
    if (!refined) throw new Error('Incompatible category drill-down.');
    enrichment[dimension] = refined;
  }
  return questionBankHref({ ...query, view: undefined, enrichment }, 1);
}

/** Preserve bank selection and presentation across ordinary navigation links. */
export function questionBankHref(query: QuestionBankQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.view) params.set('view', query.view);
  if (query.collection) {
    params.set(
      'collection',
      query.collection._tag === 'Unfiled' ? 'unfiled' : query.collection.collectionId,
    );
  }
  if (query.enrichment) appendBankEnrichmentFilter(params, query.enrichment);
  if (query.sort) {
    params.set('sort', query.sort.field);
    params.set('direction', query.sort.direction);
  }
  params.set('pageSize', String(query.pageSize));
  if (query.search) params.set('q', query.search);
  if (query.tags.length) params.set('tags', query.tags.join(','));
  if (query.type) params.set('type', query.type);
  if (query.standard) params.set('standard', query.standard);
  if (query.origin) params.set('origin', query.origin);
  if (query.ownerUserId) params.set('owner', query.ownerUserId);
  if (query.reviewState) params.set('review', query.reviewState);
  if (query.assignedToMe) params.set('assigned', 'me');
  if (query.compatibilityTarget) params.set('target', query.compatibilityTarget);
  if (query.compatibilityOutcome) params.set('compatibility', query.compatibilityOutcome);
  if (query.lifecycle !== 'active') params.set('lifecycle', query.lifecycle);
  if (query.duplicatesOnly) params.set('duplicates', 'true');
  params.set('page', String(page));
  return `/items?${params}`;
}

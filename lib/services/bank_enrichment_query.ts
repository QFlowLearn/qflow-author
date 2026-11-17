import { isCanonicalUuid } from '../uuid.ts';
import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentDimension,
  type EnrichmentResult,
} from './bank_enrichment_contract.ts';

/** A category belongs to its producing version; identically named levels never mix audiences. */
export type BankEnrichmentValueFilter =
  | {
    readonly kind: 'value';
    readonly versionId: string;
    readonly valueId: string;
    readonly freshness: 'any' | 'outdated';
  }
  | { readonly kind: 'unassigned'; readonly freshness: 'any' | 'outdated' }
  | { readonly kind: 'unconstrained'; readonly freshness: 'outdated' }
  | { readonly kind: 'pending' | 'outside'; readonly freshness: 'any' };

/** Drop category identity when counting alternatives, retaining the independent freshness constraint. */
export function bankEnrichmentAlternatives(
  filter: BankEnrichmentValueFilter | null,
): BankEnrichmentValueFilter | null {
  return filter?.freshness === 'outdated' ? { kind: 'unconstrained', freshness: 'outdated' } : null;
}

/** Select an identity within the current freshness constraint; incompatible states have no option. */
export function bankEnrichmentRefinement(
  current: BankEnrichmentValueFilter | null,
  next: BankEnrichmentValueFilter,
): BankEnrichmentValueFilter | null {
  const identity = next.kind === 'unconstrained' && current ? current : next;
  const freshness = current?.freshness === 'outdated' || next.freshness === 'outdated'
    ? 'outdated'
    : 'any';
  switch (identity.kind) {
    case 'value':
    case 'unassigned':
      return { ...identity, freshness };
    case 'unconstrained':
      return identity;
    case 'pending':
    case 'outside':
      return freshness === 'outdated' ? null : identity;
  }
}

/** Status controls and overview links share the same domain filters. */
export function bankEnrichmentStatusFilter(
  status: 'unassigned' | 'pending' | 'outside' | 'outdated',
): BankEnrichmentValueFilter {
  return status === 'outdated'
    ? { kind: 'unconstrained', freshness: 'outdated' }
    : { kind: status, freshness: 'any' };
}
/** Selecting a vocabulary is explicit; each dimension can independently narrow its results. */
export type BankEnrichmentFilter = {
  readonly schemeId: string;
  readonly subject: BankEnrichmentValueFilter | null;
  readonly topic: BankEnrichmentValueFilter | null;
  readonly difficulty: BankEnrichmentValueFilter | null;
};

/** Parse only enrichment fields after the owning bank parser rejects unknown/repeated URL keys. */
export function parseBankEnrichmentFilter(
  params: URLSearchParams,
): EnrichmentResult<
  BankEnrichmentFilter | null,
  'scheme_required' | 'invalid_scheme' | 'invalid_value'
> {
  const schemeId = params.get('scheme');
  const fields: Record<EnrichmentDimension, BankEnrichmentValueFilter | null> = {
    subject: null,
    topic: null,
    difficulty: null,
  };
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    const raw = params.get(dimension);
    if (raw === null || raw === '') continue;
    const value = parseValue(raw);
    if (!value) return { ok: false, code: 'invalid_value' };
    fields[dimension] = value;
  }
  if (schemeId === null || schemeId === '') {
    return ENRICHMENT_DIMENSIONS.some((dimension) => fields[dimension] !== null)
      ? { ok: false, code: 'scheme_required' }
      : { ok: true, value: null };
  }
  if (!isCanonicalUuid(schemeId)) return { ok: false, code: 'invalid_scheme' };
  return { ok: true, value: { schemeId, ...fields } };
}

/** Stable, reversible option values keep version/category identities out of visible labels. */
export function bankEnrichmentFilterValue(filter: BankEnrichmentValueFilter): string {
  if (filter.kind === 'unconstrained') return 'outdated';
  return filter.kind === 'value'
    ? `${filter.versionId}:${filter.valueId}${filter.freshness === 'outdated' ? ':outdated' : ''}`
    : filter.kind === 'unassigned' && filter.freshness === 'outdated'
    ? 'unassigned:outdated'
    : filter.kind;
}

/** Preserve vocabulary selections across sorting, pagination, detail returns and captured scopes. */
export function appendBankEnrichmentFilter(
  params: URLSearchParams,
  filter: BankEnrichmentFilter,
): void {
  params.set('scheme', filter.schemeId);
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    const value = filter[dimension];
    if (value) params.set(dimension, bankEnrichmentFilterValue(value));
    else params.delete(dimension);
  }
}

function parseValue(value: string): BankEnrichmentValueFilter | null {
  if (value === 'unassigned:outdated') return { kind: 'unassigned', freshness: 'outdated' };
  if (
    value === 'unassigned' || value === 'pending' || value === 'outside' || value === 'outdated'
  ) {
    return bankEnrichmentStatusFilter(value);
  }
  const parts = value.split(':');
  if (
    (parts.length !== 2 && !(parts.length === 3 && parts[2] === 'outdated')) ||
    !isCanonicalUuid(parts[0]) || !/^[a-z][a-z0-9_-]{0,63}$/.test(parts[1])
  ) {
    return null;
  }
  return {
    kind: 'value',
    versionId: parts[0],
    valueId: parts[1],
    freshness: parts.length === 3 ? 'outdated' : 'any',
  };
}

/** Result navigation keeps source filters and clears classifications changed by this run. */
export function enrichmentResultHref(sourceQuery: string, schemeId: string): string {
  const params = new URLSearchParams(sourceQuery);
  for (const dimension of ENRICHMENT_DIMENSIONS) params.delete(dimension);
  params.delete('page');
  params.set('scheme', schemeId);
  return `/items?${params}`;
}

import { isCanonicalUuid } from './uuid.ts';
import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentDimension,
  parseEnrichmentVocabularyValue,
} from './services/bank_enrichment_contract.ts';
import type {
  EnrichmentBrowseCategory,
  EnrichmentBrowseFacet,
  EnrichmentBrowseScheme,
  EnrichmentBrowseValue,
  EnrichmentQuestionsView,
} from './services/bank_enrichment_browse_contract.ts';

/** Validate classification metadata at the HTTP boundary, including exact page identities. */
export function parseEnrichmentQuestionsView(
  input: unknown,
  pageIds: readonly string[],
): EnrichmentQuestionsView | null {
  if (
    !exact(input, ['schemes', 'schemesTruncated', 'selection']) ||
    !Array.isArray(input.schemes) || input.schemes.length > 100 ||
    !input.schemes.every(isScheme) || typeof input.schemesTruncated !== 'boolean' ||
    !unique(input.schemes.map((s) => s.id))
  ) return null;
  const common = { schemes: input.schemes, schemesTruncated: input.schemesTruncated };
  if (input.selection === null) return { ...common, selection: null };
  const selection = input.selection;
  if (
    !exact(selection, ['scheme', 'facets', 'rows']) || !isScheme(selection.scheme) ||
    !exact(selection.facets, ENRICHMENT_DIMENSIONS) ||
    !exact(selection.rows, pageIds)
  ) return null;
  const selectedScheme = selection.scheme;
  if (
    !input.schemes.some((scheme) =>
      scheme.id === selectedScheme.id &&
      scheme.versionId === selectedScheme.versionId && scheme.version === selectedScheme.version &&
      scheme.audience === selectedScheme.audience && scheme.name === selectedScheme.name
    )
  ) return null;
  const { subject, topic, difficulty } = selection.facets;
  if (!isFacet(subject) || !isFacet(topic) || !isFacet(difficulty)) return null;
  const rows = parseEnrichmentRows(selection.rows, pageIds);
  if (!rows) return null;
  return {
    ...common,
    selection: { scheme: selection.scheme, facets: { subject, topic, difficulty }, rows },
  };
}

function isScheme(value: unknown): value is EnrichmentBrowseScheme {
  return exact(value, ['id', 'versionId', 'version', 'name', 'audience']) &&
    isCanonicalUuid(value.id) && isCanonicalUuid(value.versionId) &&
    positive(value.version) && text(value.name, 160) && text(value.audience, 1000);
}
function isCategory(value: unknown): value is EnrichmentBrowseCategory {
  return exact(value, ['versionId', 'version', 'audience', 'id', 'label', 'count']) &&
    isCanonicalUuid(value.versionId) && positive(value.version) && text(value.audience, 1000) &&
    label(value) && count(value.count);
}
function isFacet(value: unknown): value is EnrichmentBrowseFacet {
  return exact(value, [
    'categories',
    'truncated',
    'unassigned',
    'pending',
    'outside',
    'outdated',
  ]) &&
    Array.isArray(value.categories) && value.categories.length <= 1000 &&
    value.categories.every(isCategory) &&
    unique(value.categories.map((c) => `${c.versionId}:${c.id}`)) &&
    typeof value.truncated === 'boolean' && count(value.unassigned) && count(value.pending) &&
    count(value.outside) && count(value.outdated);
}
function isValue(input: unknown, dimension: EnrichmentDimension): input is EnrichmentBrowseValue {
  if (exact(input, ['state']) && (input.state === 'pending' || input.state === 'outside')) {
    return true;
  }
  if (
    !exact(input, [
      'state',
      'value',
      'versionId',
      'categories',
      'version',
      'audience',
      'outdated',
    ]) ||
    input.state !== 'classified' || !isCanonicalUuid(input.versionId) || !positive(input.version) ||
    !text(input.audience, 1000) || typeof input.outdated !== 'boolean' ||
    !Array.isArray(input.categories) || input.categories.length > 3 ||
    !input.categories.every((c): c is { id: string; label: string } =>
      exact(c, ['id', 'label']) && label(c)
    ) || !unique(input.categories.map((c) => c.id))
  ) return false;
  const value = parseEnrichmentVocabularyValue(input.value, dimension, input.categories);
  return value !== null &&
    (value.state === 'assigned'
      ? value.valueIds.length === input.categories.length
      : input.categories.length === 0);
}
function label(value: Record<string, unknown>): boolean {
  return typeof value.id === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value.id) &&
    text(value.label, 80);
}
function exact(input: unknown, keys: readonly string[]): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const actual = Object.keys(input);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function positive(value: unknown): value is number {
  return count(value) && value > 0;
}
function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/** Parse only the facets used by category filters, without transporting unrelated table data. */
export function parseEnrichmentBrowseView(
  input: unknown,
): import('./services/bank_enrichment_browse_contract.ts').EnrichmentBrowseView | null {
  if (
    !exact(input, ['schemes', 'schemesTruncated', 'selection']) || !Array.isArray(input.schemes) ||
    input.schemes.length > 100 || !input.schemes.every(isScheme) ||
    !unique(input.schemes.map((scheme) => scheme.id)) || typeof input.schemesTruncated !== 'boolean'
  ) return null;
  const common = { schemes: input.schemes, schemesTruncated: input.schemesTruncated };
  if (input.selection === null) return { ...common, selection: null };
  const selection = input.selection;
  if (
    !exact(selection, ['scheme', 'facets']) || !isScheme(selection.scheme) ||
    !exact(selection.facets, ENRICHMENT_DIMENSIONS)
  ) return null;
  const selectedScheme = selection.scheme;
  const { subject, topic, difficulty } = selection.facets;
  if (
    !isFacet(subject) || !isFacet(topic) || !isFacet(difficulty) ||
    !input.schemes.some((scheme) =>
      scheme.id === selectedScheme.id && scheme.versionId === selectedScheme.versionId &&
      scheme.version === selectedScheme.version && scheme.audience === selectedScheme.audience &&
      scheme.name === selectedScheme.name
    )
  ) return null;
  return {
    ...common,
    selection: { scheme: selection.scheme, facets: { subject, topic, difficulty } },
  };
}

/** Parse the overview's JSON counts and versioned buckets before any disclosure tree is built. */
export function parseEnrichmentOverviewView(
  input: unknown,
): import('./services/bank_enrichment_browse_contract.ts').EnrichmentOverviewView | null {
  if (!exact(input, ['schemes', 'schemesTruncated', 'selection'])) return null;
  const selection = input.selection;
  if (selection === null) {
    const common = parseEnrichmentBrowseView(input);
    return common
      ? { schemes: common.schemes, schemesTruncated: common.schemesTruncated, selection: null }
      : null;
  }
  if (!exact(selection, ['scheme', 'facets', 'overview'])) return null;
  const common = parseEnrichmentBrowseView({
    schemes: input.schemes,
    schemesTruncated: input.schemesTruncated,
    selection: { scheme: selection.scheme, facets: selection.facets },
  });
  if (!common?.selection) return null;
  const matrix = selection.overview;
  if (!exact(matrix, ['columns', 'rows', 'totals', 'total', 'statuses']) || !count(matrix.total)) {
    return null;
  }
  const columns = parseList(matrix.columns, overviewBucket);
  const totals = parseList(matrix.totals, (value) => count(value) ? value : null);
  if (!columns || !totals || totals.length !== columns.length) return null;
  const parseRow = (value: unknown) => {
    if (!exact(value, ['bucket', 'counts', 'total']) || !count(value.total)) return null;
    const bucket = overviewBucket(value.bucket);
    const counts = parseList(value.counts, (value) => count(value) ? value : null);
    return bucket && counts?.length === columns.length
      ? { bucket, counts, total: value.total }
      : null;
  };
  const rows = parseList(matrix.rows, (value) => {
    if (!exact(value, ['bucket', 'counts', 'total', 'topics'])) return null;
    const row = parseRow({ bucket: value.bucket, counts: value.counts, total: value.total });
    const topics = parseList(value.topics, parseRow);
    return row && topics ? { ...row, topics } : null;
  });
  const statuses = parseList(matrix.statuses, (value) => {
    if (!exact(value, ['dimension', 'kind', 'count']) || !count(value.count)) return null;
    const dimension = ENRICHMENT_DIMENSIONS.find((candidate) => candidate === value.dimension);
    const kind = (['unassigned', 'pending', 'outside', 'outdated'] as const).find((candidate) =>
      candidate === value.kind
    );
    return dimension && kind ? { dimension, kind, count: value.count } : null;
  });
  if (!rows || !statuses) return null;
  return {
    ...common,
    selection: {
      ...common.selection,
      overview: { columns, rows, totals, total: matrix.total, statuses },
    },
  };
}

function parseList<T>(input: unknown, parse: (value: unknown) => T | null): T[] | null {
  if (!Array.isArray(input)) return null;
  const result: T[] = [];
  for (const value of input) {
    const parsed = parse(value);
    if (parsed === null) return null;
    result.push(parsed);
  }
  return result;
}

function overviewBucket(
  value: unknown,
): import('./services/bank_enrichment_browse_contract.ts').EnrichmentOverviewBucket | null {
  if (!exact(value, ['key', 'filter', 'category']) || typeof value.key !== 'string') return null;
  const category = value.category;
  let parsedCategory:
    import('./services/bank_enrichment_browse_contract.ts').EnrichmentOverviewBucket['category'] =
      null;
  if (category !== null) {
    if (
      !exact(category, ['label', 'version', 'audience']) || typeof category.label !== 'string' ||
      !positive(category.version) || typeof category.audience !== 'string'
    ) return null;
    parsedCategory = {
      label: category.label,
      version: category.version,
      audience: category.audience,
    };
  }
  const filter = value.filter;
  if (!isTransportRecord(filter)) return null;
  let parsed: import('./services/bank_enrichment_query.ts').BankEnrichmentValueFilter;
  if (filter.kind === 'value') {
    if (
      !exact(filter, ['kind', 'freshness', 'versionId', 'valueId']) ||
      !isCanonicalUuid(filter.versionId) ||
      typeof filter.valueId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(filter.valueId) ||
      (filter.freshness !== 'any' && filter.freshness !== 'outdated')
    ) return null;
    parsed = {
      kind: 'value',
      freshness: filter.freshness,
      versionId: filter.versionId,
      valueId: filter.valueId,
    };
  } else if (
    exact(filter, ['kind', 'freshness']) && filter.kind === 'unassigned' &&
    (filter.freshness === 'any' || filter.freshness === 'outdated')
  ) {
    parsed = { kind: 'unassigned', freshness: filter.freshness };
  } else if (
    exact(filter, ['kind', 'freshness']) && filter.kind === 'unconstrained' &&
    filter.freshness === 'outdated'
  ) {
    parsed = { kind: 'unconstrained', freshness: 'outdated' };
  } else if (
    exact(filter, ['kind', 'freshness']) &&
    (filter.kind === 'pending' || filter.kind === 'outside') && filter.freshness === 'any'
  ) {
    parsed = { kind: filter.kind, freshness: 'any' };
  } else return null;
  return { key: value.key, filter: parsed, category: parsedCategory };
}

function isTransportRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse the table's selected scheme and classifications for precisely its visible question IDs. */
export function parseEnrichmentTableSelection(
  input: unknown,
  pageIds: readonly string[],
): Pick<NonNullable<EnrichmentQuestionsView['selection']>, 'scheme' | 'rows'> | null {
  if (!exact(input, ['scheme', 'rows']) || !isScheme(input.scheme) || !exact(input.rows, pageIds)) {
    return null;
  }
  const rows = parseEnrichmentRows(input.rows, pageIds);
  if (!rows) return null;
  return { scheme: input.scheme, rows };
}

function parseEnrichmentRows(
  input: unknown,
  pageIds: readonly string[],
): Record<string, Record<EnrichmentDimension, EnrichmentBrowseValue>> | null {
  if (!exact(input, pageIds)) return null;
  const rows: Record<string, Record<EnrichmentDimension, EnrichmentBrowseValue>> = {};
  for (const id of pageIds) {
    const row = input[id];
    if (
      !exact(row, ENRICHMENT_DIMENSIONS) || !isValue(row.subject, 'subject') ||
      !isValue(row.topic, 'topic') || !isValue(row.difficulty, 'difficulty')
    ) return null;
    rows[id] = { subject: row.subject, topic: row.topic, difficulty: row.difficulty };
  }
  return rows;
}

import {
  QUESTION_COMPATIBILITY_OUTCOMES,
  QUESTION_LIFECYCLE_STATES,
  QUESTION_REVIEW_STATES,
  type QuestionCompatibilityOutcome,
  type QuestionLifecycleState,
  type QuestionReviewFacetState,
} from '../question_bank_contract.ts';
import {
  listSelectableAssessmentExportTargets,
  type SelectableAssessmentExportTargetId,
} from '../export/assessment_export_targets.ts';
import { QUESTION_TYPE_IDS, type QuestionTypeId } from '../types/question_type_id.ts';
import { type BankEnrichmentFilter, parseBankEnrichmentFilter } from './bank_enrichment_query.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { ENRICHMENT_DIMENSIONS } from './bank_enrichment_contract.ts';

/** A specific flat collection or questions with no filing, including archived collections. */
export type QuestionBankCollectionFilter =
  | { readonly _tag: 'Collection'; readonly collectionId: string }
  | { readonly _tag: 'Unfiled' };

export const QUESTION_BANK_SORT_FIELDS = [
  'title',
  'type',
  'origin',
  'review',
  'owner',
  'revision',
  'updated',
  'difficulty',
] as const;
export type QuestionBankSortField = typeof QUESTION_BANK_SORT_FIELDS[number];

export type QuestionBankQuery = {
  readonly view?: 'overview';
  readonly sort?: { readonly field: QuestionBankSortField; readonly direction: 'asc' | 'desc' };
  readonly collection?: QuestionBankCollectionFilter;
  readonly enrichment?: BankEnrichmentFilter;
  readonly search: string;
  readonly tags: readonly string[];
  readonly type?: QuestionTypeId;
  readonly standard?: string;
  readonly origin?: 'Authored' | 'Imported' | 'Variant';
  readonly compatibilityTarget?: SelectableAssessmentExportTargetId;
  readonly compatibilityOutcome?: QuestionCompatibilityOutcome;
  readonly reviewState?: QuestionReviewFacetState;
  readonly assignedToMe: boolean;
  readonly ownerUserId?: string;
  readonly lifecycle: QuestionLifecycleState;
  readonly duplicatesOnly: boolean;
  readonly page: number;
  readonly pageSize: number;
};

/** A question-list query cannot request the overview projection. */
export type QuestionBankQuestionsQuery = Omit<QuestionBankQuery, 'view'> & {
  readonly view?: never;
};

/** Stable presentation code for a rejected item-bank query. */
export type QuestionBankQueryErrorCode =
  | 'invalid_filter'
  | 'target_required'
  | 'unsupported_filter'
  | 'repeated_filter'
  | 'invalid_pagination'
  | 'invalid_owner'
  | 'invalid_tags';

export const QUESTION_BANK_ORIGINS = ['Authored', 'Imported', 'Variant'] as const;
export const QUESTION_BANK_REVIEW_FACETS = ['not_requested', ...QUESTION_REVIEW_STATES] as const;

const BANK_FILTER_KEYS = new Set([
  'view',
  'sort',
  'direction',
  'q',
  'collection',
  'scheme',
  'subject',
  'topic',
  'difficulty',
  'tags',
  'type',
  'standard',
  'origin',
  'target',
  'compatibility',
  'review',
  'assigned',
  'owner',
  'lifecycle',
  'duplicates',
  'page',
  'pageSize',
  'notice',
  'error',
]);

/** Parses a bank URL as one strict, bounded query. Unknown values are rejected. */
export function parseQuestionBankQuery(searchParams: URLSearchParams): QuestionBankQuery {
  rejectUnknownOrRepeatedKeys(searchParams, BANK_FILTER_KEYS, 'item-bank filter');

  const view = optionalExact(
    searchParams.get('view'),
    ['questions', 'overview'] as const,
    'bank view',
  );

  const sort = parseSort(searchParams);
  const selection = parseBankSelection(searchParams);
  if (sort?.field === 'difficulty' && !selection.enrichment) {
    throw new QuestionBankInputError(
      'Choose a category set before sorting difficulty.',
      'invalid_filter',
    );
  }
  const type = optionalExact(searchParams.get('type'), QUESTION_TYPE_IDS, 'question type');
  const origin = optionalExact(
    searchParams.get('origin'),
    QUESTION_BANK_ORIGINS,
    'question origin',
  );
  const lifecycle = optionalExact(
    searchParams.get('lifecycle'),
    QUESTION_LIFECYCLE_STATES,
    'lifecycle state',
  ) ?? 'active';
  const compatibilityOutcome = optionalExact(
    searchParams.get('compatibility'),
    QUESTION_COMPATIBILITY_OUTCOMES,
    'compatibility outcome',
  );
  const reviewState = optionalExact(
    searchParams.get('review'),
    QUESTION_BANK_REVIEW_FACETS,
    'review state',
  );
  const compatibilityTarget = optionalExact(
    searchParams.get('target'),
    listSelectableAssessmentExportTargets().map((target) => target.id),
    'compatibility target',
  );
  if (compatibilityOutcome && !compatibilityTarget) {
    throw new QuestionBankInputError(
      'Choose a target before filtering by profile result.',
      'target_required',
    );
  }

  const duplicates = searchParams.get('duplicates');
  if (duplicates !== null && duplicates !== 'true') {
    throw new QuestionBankInputError('Unsupported duplicate filter.', 'unsupported_filter');
  }
  const ownerUserId = cleanOptional(searchParams.get('owner'));
  if (ownerUserId && !isCanonicalUuid(ownerUserId)) {
    throw new QuestionBankInputError('Unsupported item owner.', 'invalid_owner');
  }
  const assigned = searchParams.get('assigned');
  if (assigned !== null && assigned !== 'me') {
    throw new QuestionBankInputError('Unsupported review assignment filter.', 'unsupported_filter');
  }
  const standard = parseBoundedText(searchParams.get('standard'), 200, 'standard');

  return {
    ...(view === 'overview' ? { view } : {}),
    ...(sort ? { sort } : {}),
    ...selection,
    ...(type ? { type } : {}),
    ...(standard ? { standard } : {}),
    ...(origin ? { origin } : {}),
    ...(compatibilityTarget ? { compatibilityTarget } : {}),
    ...(compatibilityOutcome ? { compatibilityOutcome } : {}),
    ...(reviewState ? { reviewState } : {}),
    assignedToMe: assigned === 'me',
    ...(ownerUserId ? { ownerUserId } : {}),
    lifecycle,
    duplicatesOnly: duplicates === 'true',
    page: parseBoundedInteger(searchParams.get('page'), 1, 10_000, 1, 'page'),
    pageSize: parseBoundedInteger(searchParams.get('pageSize'), 10, 100, 100, 'page size'),
  };
}

/** Normalize a submitted category-set switch before parsing the canonical bank URL. */
export function parseQuestionBankFilterForm(params: URLSearchParams): URLSearchParams | null {
  if (!params.has('loadedScheme')) return null;
  rejectUnknownOrRepeatedKeys(
    params,
    new Set([...BANK_FILTER_KEYS, 'loadedScheme']),
    'item-bank filter',
  );
  const loaded = params.get('loadedScheme');
  const selected = params.get('scheme');
  if (
    loaded === null || selected === null || loaded !== '' && !isCanonicalUuid(loaded) ||
    selected !== '' && !isCanonicalUuid(selected)
  ) {
    throw new QuestionBankInputError('Invalid category set submission.', 'invalid_filter');
  }
  const sort = parseSort(params);
  const query = new URLSearchParams(params);
  query.set('scheme', loaded || selected);
  if (!parseBankEnrichmentFilter(query).ok) {
    throw new QuestionBankInputError('Invalid category submission.', 'invalid_filter');
  }
  query.set('scheme', selected);
  query.delete('loadedScheme');
  if (selected === '' && sort?.field === 'difficulty') {
    query.delete('sort');
    query.delete('direction');
  }
  if (loaded !== selected) {
    for (const dimension of ENRICHMENT_DIMENSIONS) query.delete(dimension);
  }
  return query;
}

function parseSort(searchParams: URLSearchParams): QuestionBankQuery['sort'] {
  const sortField = optionalExact(
    searchParams.get('sort'),
    QUESTION_BANK_SORT_FIELDS,
    'sort column',
  );
  const direction = optionalExact(
    searchParams.get('direction'),
    ['asc', 'desc'] as const,
    'sort direction',
  );
  if (direction && !sortField) {
    throw new QuestionBankInputError('Choose a sort column.', 'invalid_filter');
  }
  return sortField ? { field: sortField, direction: direction ?? 'asc' } : undefined;
}

/** Parses the compact item-picker query with the same search and tag rules as the bank. */
export function parseQuestionBankPickerQuery(
  searchParams: URLSearchParams,
): QuestionBankQuestionsQuery {
  rejectUnknownOrRepeatedKeys(
    searchParams,
    new Set(['q', 'tags', 'collection', 'scheme', ...ENRICHMENT_DIMENSIONS, 'page', 'pageSize']),
    'item search filter',
  );
  return {
    ...parseBankSelection(searchParams),
    assignedToMe: false,
    lifecycle: 'active',
    duplicatesOnly: false,
    page: parseBoundedInteger(searchParams.get('page'), 1, 10_000, 1, 'page'),
    pageSize: parseBoundedInteger(searchParams.get('pageSize'), 1, 50, 10, 'page size'),
  };
}

/** Both browsing surfaces share collection, category, search and tag semantics. */
function parseBankSelection(
  params: URLSearchParams,
): Pick<QuestionBankQuery, 'search' | 'tags' | 'collection' | 'enrichment'> {
  const enrichment = parseBankEnrichmentFilter(params);
  if (!enrichment.ok) {
    throw new QuestionBankInputError('Invalid category selection.', 'invalid_filter');
  }
  const collection = parseCollectionFilter(params.get('collection'));
  return {
    search: parseBoundedText(params.get('q'), 200, 'search') ?? '',
    tags: parseTagFilter(params.get('tags')),
    ...(collection ? { collection } : {}),
    ...(enrichment.value ? { enrichment: enrichment.value } : {}),
  };
}

function rejectUnknownOrRepeatedKeys(
  searchParams: URLSearchParams,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of searchParams.keys()) {
    if (!allowedKeys.has(key)) {
      throw new QuestionBankInputError(`Unsupported ${label}.`, 'unsupported_filter');
    }
    if (searchParams.getAll(key).length > 1) {
      throw new QuestionBankInputError(
        `${label[0].toUpperCase()}${label.slice(1)}s cannot be repeated.`,
        'repeated_filter',
      );
    }
  }
}

function parseTagFilter(value: string | null): readonly string[] {
  if (value === null || value.trim() === '') return [];
  const rawTags = value.split(',').map((tag) => tag.trim().toLowerCase());
  if (rawTags.some((tag) => tag.length === 0 || tag.length > 80)) {
    throw new QuestionBankInputError(
      'Each tag must contain between 1 and 80 characters.',
      'invalid_tags',
    );
  }
  const tags = [...new Set(rawTags)].sort();
  if (tags.length > 20) {
    throw new QuestionBankInputError('Choose no more than 20 tags.', 'invalid_tags');
  }
  return tags;
}

function parseBoundedText(
  value: string | null,
  maxLength: number,
  label: string,
): string | undefined {
  const cleaned = cleanOptional(value);
  if (!cleaned) return undefined;
  if (cleaned.length > maxLength) {
    throw new QuestionBankInputError(`Invalid ${label}.`, 'invalid_filter');
  }
  return cleaned;
}

function optionalExact<const Value extends string>(
  value: string | null,
  allowed: readonly Value[],
  label: string,
): Value | undefined {
  const cleaned = cleanOptional(value);
  if (!cleaned) return undefined;
  const parsed = allowed.find((candidate) => candidate === cleaned);
  if (!parsed) throw new QuestionBankInputError(`Unsupported ${label}.`, 'unsupported_filter');
  return parsed;
}

function cleanOptional(value: string | null): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function parseBoundedInteger(
  value: string | null,
  min: number,
  max: number,
  fallback: number,
  label: string,
): number {
  if (value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new QuestionBankInputError(`Invalid ${label}.`, 'invalid_pagination');
  }
  return parsed;
}

/** User-correctable item-bank URL validation failure. */
export class QuestionBankInputError extends Error {
  readonly code: QuestionBankQueryErrorCode;

  constructor(message: string, code: QuestionBankQueryErrorCode) {
    super(message);
    this.code = code;
    this.name = 'QuestionBankInputError';
  }
}

function parseCollectionFilter(value: string | null): QuestionBankCollectionFilter | undefined {
  if (value === null || value === '') return undefined;
  if (value === 'unfiled') return { _tag: 'Unfiled' };
  if (isCanonicalUuid(value)) return { _tag: 'Collection', collectionId: value };
  throw new QuestionBankInputError('Unsupported collection filter.', 'invalid_filter');
}

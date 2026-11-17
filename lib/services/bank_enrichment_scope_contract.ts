import { isCanonicalUuid } from '../uuid.ts';
import {
  parseQuestionBankQuery,
  QuestionBankInputError,
  type QuestionBankQuery,
} from './question_bank_query.ts';
import { ENRICHMENT_DIMENSIONS, type EnrichmentDimension } from './bank_enrichment_contract.ts';

/** Parsed bank scope; presentation pagination and ordering are deliberately absent. */
export type EnrichmentScope =
  | { readonly _tag: 'Filtered'; readonly queryString: string; readonly query: QuestionBankQuery }
  | { readonly _tag: 'Selected'; readonly questionIds: readonly string[] };
/** Frozen input receipt, usable after the bank's content or filters change. */
export type EnrichmentSnapshot = {
  readonly id: string;
  readonly itemCount: number;
  readonly createdAt: string;
  readonly scope: EnrichmentSnapshotScope;
};
/** Accept a complete filtered scope or an explicit bounded UI selection. */
export function parseEnrichmentScope(input: unknown): EnrichmentScope | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || !('_tag' in input)) {
    return null;
  }
  if (input._tag === 'Selected') {
    if (
      Object.keys(input).sort().join(',') !== '_tag,questionIds' || !('questionIds' in input) ||
      !Array.isArray(input.questionIds)
    ) return null;
    if (input.questionIds.length < 1 || input.questionIds.length > 100) return null;
    const questionIds: string[] = [];
    for (const id of input.questionIds) {
      if (typeof id !== 'string' || !isCanonicalUuid(id)) return null;
      questionIds.push(id);
    }
    if (new Set(questionIds).size !== questionIds.length) return null;
    return { _tag: 'Selected', questionIds: questionIds.sort() };
  }
  if (
    input._tag !== 'Filtered' || Object.keys(input).sort().join(',') !== '_tag,queryString' ||
    !('queryString' in input) || typeof input.queryString !== 'string' ||
    input.queryString.length > 8000
  ) return null;
  const params = new URLSearchParams(input.queryString);
  try {
    // Validate all supplied keys before discarding presentation-only fields.
    parseQuestionBankQuery(params);
    for (const key of ['view', 'page', 'pageSize', 'sort', 'direction']) params.delete(key);
    params.sort();
    return {
      _tag: 'Filtered',
      queryString: params.toString(),
      query: parseQuestionBankQuery(params),
    };
  } catch (cause: unknown) {
    if (cause instanceof QuestionBankInputError) return null;
    throw cause;
  }
}

export type EnrichmentSnapshotFailure =
  | 'invalid_input'
  | 'forbidden'
  | 'invalid_selection'
  | 'empty_scope'
  | 'operation_conflict'
  | 'storage_failed';

/** Server-derived scopes retain their root bank context and exact selection inputs. */
export type EnrichmentAffectedScope = {
  readonly _tag: 'Affected';
  readonly sourceSnapshotId: string;
  readonly baseVersionId: string;
  readonly definitionHash: string;
  readonly removedValues: Readonly<Record<EnrichmentDimension, readonly string[]>>;
  readonly sourceScope: EnrichmentScope;
};
/** External bank selections and internally captured affected subsets share one snapshot format. */
export type EnrichmentSnapshotScope = EnrichmentScope | EnrichmentAffectedScope;

/** Decode stored affected scopes; external capture still accepts only Filtered or Selected. */
export function parseEnrichmentSnapshotScope(input: unknown): EnrichmentSnapshotScope | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || !('_tag' in input)) {
    return null;
  }
  if (input._tag !== 'Affected') return parseEnrichmentScope(input);
  if (
    Object.keys(input).sort().join(',') !==
      '_tag,baseVersionId,definitionHash,removedValues,sourceScope,sourceSnapshotId' ||
    !('sourceSnapshotId' in input) || typeof input.sourceSnapshotId !== 'string' ||
    !isCanonicalUuid(input.sourceSnapshotId) ||
    !('baseVersionId' in input) || typeof input.baseVersionId !== 'string' ||
    !isCanonicalUuid(input.baseVersionId) ||
    !('definitionHash' in input) || typeof input.definitionHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(input.definitionHash) ||
    !('removedValues' in input) || !('sourceScope' in input)
  ) return null;
  const sourceScope = parseEnrichmentScope(input.sourceScope);
  const removedValues = parseRemovedValues(input.removedValues);
  if (
    !sourceScope || !removedValues
  ) return null;
  return {
    _tag: 'Affected',
    sourceSnapshotId: input.sourceSnapshotId,
    baseVersionId: input.baseVersionId,
    definitionHash: input.definitionHash,
    removedValues,
    sourceScope,
  };
}

/** Root context is for navigation only; frozen item references define an affected run's scope. */
export function enrichmentSourceScope(scope: EnrichmentSnapshotScope): EnrichmentScope {
  return scope._tag === 'Affected' ? scope.sourceScope : scope;
}

/** Persist only the source selection, excluding parsed presentation fields. */
export function enrichmentScopeRecord(scope: EnrichmentSnapshotScope): unknown {
  if (scope._tag === 'Affected') {
    return { ...scope, sourceScope: enrichmentScopeRecord(scope.sourceScope) };
  }
  return scope._tag === 'Filtered'
    ? { _tag: scope._tag, queryString: scope.queryString }
    : { _tag: scope._tag, questionIds: scope.questionIds };
}

function parseRemovedValues(
  input: unknown,
): Readonly<Record<EnrichmentDimension, readonly string[]>> | null {
  if (
    typeof input !== 'object' || input === null || Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== 'difficulty,subject,topic'
  ) return null;
  const output: Record<EnrichmentDimension, string[]> = { subject: [], topic: [], difficulty: [] };
  const limits = { subject: 50, topic: 250, difficulty: 10 };
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    const values: unknown = Reflect.get(input, dimension);
    if (!Array.isArray(values) || values.length > limits[dimension]) return null;
    for (const id of values) {
      if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(id)) return null;
      output[dimension].push(id);
    }
    if (new Set(output[dimension]).size !== output[dimension].length) return null;
    output[dimension].sort();
  }
  return ENRICHMENT_DIMENSIONS.some((d) => output[d].length > 0) ? output : null;
}

import type {
  EnrichmentDefinition,
  EnrichmentDimension,
  EnrichmentValue,
} from './bank_enrichment_contract.ts';
import {
  ENRICHMENT_DIMENSIONS,
  enrichmentVocabulary,
  parseEnrichmentValue,
  parseEnrichmentVocabularyValue,
} from './bank_enrichment_contract.ts';
import { isCanonicalUuid } from '../uuid.ts';

/** Undo can restore absence while retaining a new token that fences stale AI writes. */
export type EnrichmentChangeValue = EnrichmentValue | { readonly state: 'absent' };
/** Null means leave this dimension alone; every correction chooses at least one value. */
export type EnrichmentCorrectionValues = Readonly<
  Record<EnrichmentDimension, EnrichmentValue | null>
>;
/** Human changes have an explicit scope and producing vocabulary without provider settings. */
export type EnrichmentCorrectionCommand = {
  readonly snapshotId: string;
  readonly versionId: string;
  readonly values: EnrichmentCorrectionValues;
};

/** Parse a persisted ledger value separately from an ordinary classification. */
export function parseEnrichmentChangeValue(
  input: unknown,
  dimension: EnrichmentDimension,
  definition: EnrichmentDefinition,
): EnrichmentChangeValue | null {
  return parseEnrichmentVocabularyChangeValue(
    input,
    dimension,
    enrichmentVocabulary(definition, dimension),
  );
}

/** Parse a projected current value without loading the full vocabulary for every bank row. */
export function parseEnrichmentVocabularyChangeValue(
  input: unknown,
  dimension: EnrichmentDimension,
  vocabulary: readonly { readonly id: string }[],
): EnrichmentChangeValue | null {
  if (
    typeof input === 'object' && input !== null && !Array.isArray(input) && 'state' in input &&
    input.state === 'absent'
  ) {
    return Object.keys(input).join(',') === 'state' ? { state: 'absent' } : null;
  }
  return parseEnrichmentVocabularyValue(input, dimension, vocabulary);
}

/** Validate an exact correction command, including the selected subject/topic relationship. */
export function parseEnrichmentCorrection(
  input: unknown,
  definition: EnrichmentDefinition,
): EnrichmentCorrectionCommand | null {
  if (
    typeof input !== 'object' || input === null || Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== 'snapshotId,values,versionId' ||
    !('snapshotId' in input) || typeof input.snapshotId !== 'string' ||
    !isCanonicalUuid(input.snapshotId) || !('versionId' in input) ||
    typeof input.versionId !== 'string' || !isCanonicalUuid(input.versionId) || !('values' in input)
  ) return null;
  const values = parseEnrichmentCorrectionValues(input.values, definition);
  return values ? { snapshotId: input.snapshotId, versionId: input.versionId, values } : null;
}

/** Subject corrections explicitly include topics; topic-only changes validate current subjects when applied. */
export function parseEnrichmentCorrectionValues(
  input: unknown,
  definition: EnrichmentDefinition,
): EnrichmentCorrectionValues | null {
  if (
    typeof input !== 'object' || input === null || Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== 'difficulty,subject,topic'
  ) return null;
  const values: Record<EnrichmentDimension, EnrichmentValue | null> = {
    subject: null,
    topic: null,
    difficulty: null,
  };
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    if (!(dimension in input)) return null;
    const raw: unknown = Reflect.get(input, dimension);
    if (raw === null) continue;
    const value = parseEnrichmentValue(raw, dimension, definition);
    if (!value) return null;
    values[dimension] = value;
  }
  if (
    ENRICHMENT_DIMENSIONS.every((d) => values[d] === null) ||
    values.subject !== null && values.topic === null
  ) return null;
  if (values.subject !== null && values.topic?.state === 'assigned') {
    const subject = values.subject;
    if (
      subject.state !== 'assigned' ||
      values.topic.valueIds.some((id) =>
        !definition.topics.some((t) => t.id === id && t.subjectId === subject.valueIds[0])
      )
    ) return null;
  }
  return values;
}

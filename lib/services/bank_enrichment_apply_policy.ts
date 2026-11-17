import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentClassification,
  type EnrichmentDefinition,
  type EnrichmentDimension,
  type EnrichmentValue,
} from './bank_enrichment_contract.ts';

/** Current value and the producing vocabulary; historical IDs retain their original meaning. */
export type CurrentEnrichmentValue = {
  readonly changeId: string;
  readonly origin: 'ai' | 'human' | 'undo' | 'source';
  readonly value: EnrichmentValue | null;
  readonly definition: EnrichmentDefinition;
};
/** Independently protected change tokens, captured before the run started. */
export type EnrichmentBaseline = Readonly<Record<EnrichmentDimension, string | null>>;
/** Each dimension may have been changed by a different operation. */
export type CurrentEnrichmentValues = Readonly<
  Record<EnrichmentDimension, CurrentEnrichmentValue | null>
>;
/** A skipped dimension names the specific constraint that preserved its current value. */
export type EnrichmentProtection =
  | 'changed_since_start'
  | 'manual_value'
  | 'subject_preserved'
  | 'topic_preserved';
/** Only these writes can enter the assignment ledger; source content is outside the contract. */
export type EnrichmentWritePlan = {
  readonly writes: Readonly<Partial<Record<EnrichmentDimension, EnrichmentValue>>>;
  readonly protected: Readonly<Partial<Record<EnrichmentDimension, EnrichmentProtection>>>;
};

/** Preserve later edits and manual values while maintaining the subject/topic relationship. */
export function planEnrichmentWrites(input: {
  readonly baseline: EnrichmentBaseline;
  readonly current: CurrentEnrichmentValues;
  readonly classification: EnrichmentClassification;
  readonly definition: EnrichmentDefinition;
  readonly dimensions: readonly EnrichmentDimension[];
  readonly replacement: 'preserve_manual' | 'replace_captured';
}): EnrichmentWritePlan {
  const writes: Partial<Record<EnrichmentDimension, EnrichmentValue>> = {};
  const protectedValues: Partial<Record<EnrichmentDimension, EnrichmentProtection>> = {};
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    if (!input.dimensions.includes(dimension)) continue;
    const current = input.current[dimension];
    if ((current?.changeId ?? null) !== input.baseline[dimension]) {
      protectedValues[dimension] = 'changed_since_start';
    } else if (current && current.origin !== 'ai' && input.replacement === 'preserve_manual') {
      protectedValues[dimension] = 'manual_value';
    } else {
      writes[dimension] = input.classification[dimension];
    }
  }
  const subject = () => writes.subject ?? input.current.subject?.value;
  const topic = () => writes.topic ?? input.current.topic?.value;
  const topicDefinition = () => writes.topic ? input.definition : input.current.topic?.definition;
  const hierarchyMatches = () => {
    const topics = topic();
    if (!topics || topics.state === 'unassigned') return true;
    const primary = subject();
    if (!primary || primary.state === 'unassigned') return false;
    return topics.valueIds.every((id) =>
      topicDefinition()?.topics.some((t) => t.id === id && t.subjectId === primary.valueIds[0])
    );
  };
  if (writes.topic && !hierarchyMatches()) {
    delete writes.topic;
    protectedValues.topic = 'subject_preserved';
  }
  if (writes.subject && !hierarchyMatches()) {
    delete writes.subject;
    protectedValues.subject = 'topic_preserved';
  }
  return { writes, protected: protectedValues };
}

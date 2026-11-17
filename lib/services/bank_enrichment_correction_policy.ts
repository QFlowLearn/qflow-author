import { ENRICHMENT_DIMENSIONS, type EnrichmentDefinition } from './bank_enrichment_contract.ts';
import type { EnrichmentCorrectionValues } from './bank_enrichment_change_contract.ts';
import type {
  CurrentEnrichmentValues,
  EnrichmentBaseline,
  EnrichmentWritePlan,
} from './bank_enrichment_apply_policy.ts';

/** Human corrections replace captured values, protecting changes made after that capture. */
export function planEnrichmentCorrection(input: {
  readonly values: EnrichmentCorrectionValues;
  readonly definition: EnrichmentDefinition;
  readonly baseline: EnrichmentBaseline;
  readonly current: CurrentEnrichmentValues;
}): EnrichmentWritePlan {
  const writes: {
    -readonly [K in keyof EnrichmentWritePlan['writes']]: EnrichmentWritePlan['writes'][K];
  } = {};
  const protectedValues: {
    -readonly [K in keyof EnrichmentWritePlan['protected']]: EnrichmentWritePlan['protected'][K];
  } = {};
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    const value = input.values[dimension];
    if (value === null) continue;
    if ((input.current[dimension]?.changeId ?? null) !== input.baseline[dimension]) {
      protectedValues[dimension] = 'changed_since_start';
    } else writes[dimension] = value;
  }
  const hierarchyMatches = () => {
    const topic = writes.topic ?? input.current.topic?.value;
    if (!topic || topic.state === 'unassigned') return true;
    const subject = writes.subject ?? input.current.subject?.value;
    if (!subject || subject.state !== 'assigned') return false;
    const definition = writes.topic ? input.definition : input.current.topic?.definition;
    return topic.valueIds.every((id) =>
      definition?.topics.some((t) => t.id === id && t.subjectId === subject.valueIds[0])
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

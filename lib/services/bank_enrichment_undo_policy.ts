import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentDefinition,
  type EnrichmentDimension,
} from './bank_enrichment_contract.ts';
import type { EnrichmentChangeValue } from './bank_enrichment_change_contract.ts';
import type {
  EnrichmentCurrentChanges,
  EnrichmentStoredChange,
} from './bank_enrichment_changes.ts';
import type { EnrichmentProtection } from './bank_enrichment_apply_policy.ts';

/** Compensation restores the original source/vocabulary as well as the value. */
export type EnrichmentRestoration = {
  readonly value: EnrichmentChangeValue;
  readonly versionId: string;
  readonly revisionId: string;
  readonly definition: EnrichmentDefinition;
};
/** A source run's actual writes and their original predecessors, loaded from immutable history. */
export type EnrichmentUndoTargets = Readonly<
  Record<
    EnrichmentDimension,
    {
      readonly written: EnrichmentStoredChange;
      readonly previous: EnrichmentStoredChange | null;
    } | null
  >
>;

/** Restore only tokens written by the source run; same-value later edits still win. */
export function planEnrichmentUndo(
  current: EnrichmentCurrentChanges,
  targets: EnrichmentUndoTargets,
): {
  readonly writes: Readonly<Partial<Record<EnrichmentDimension, EnrichmentRestoration>>>;
  readonly protected: Readonly<Partial<Record<EnrichmentDimension, EnrichmentProtection>>>;
} {
  const writes: Partial<Record<EnrichmentDimension, EnrichmentRestoration>> = {};
  const protectedValues: Partial<Record<EnrichmentDimension, EnrichmentProtection>> = {};
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    const target = targets[dimension];
    if (!target) continue;
    if (current[dimension]?.changeId !== target.written.changeId) {
      protectedValues[dimension] = 'changed_since_start';
      continue;
    }
    const previous = target.previous;
    const source = previous ?? target.written;
    writes[dimension] = {
      value: previous?.value ?? { state: 'absent' },
      versionId: source.versionId,
      revisionId: source.revisionId,
      definition: source.definition,
    };
  }
  const hierarchyMatches = () => {
    const topic = writes.topic ? writes.topic.value : current.topic?.value;
    if (!topic || topic.state !== 'assigned') return true;
    const subject = writes.subject ? writes.subject.value : current.subject?.value;
    if (!subject || subject.state !== 'assigned') return false;
    const definition = writes.topic ? writes.topic.definition : current.topic?.definition;
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

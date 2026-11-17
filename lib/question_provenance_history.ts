import { parsePositiveInteger } from './persistence_parse.ts';
import {
  canOwnSourceContent,
  parseQuestionProvenanceEntry,
  type QuestionOrigin,
  questionOriginFromEntry,
  type QuestionProvenanceEntry,
} from './question_provenance.ts';

/** One persisted provenance value paired with the revision number that owns it. */
export type PersistedQuestionProvenanceRevision = {
  readonly revision: number;
  readonly provenance: unknown;
};

/** Validated question origin and provenance entries indexed by their revision number. */
export type ParsedQuestionProvenanceHistory = {
  readonly origin: QuestionOrigin;
  readonly entries: ReadonlyMap<number, QuestionProvenanceEntry>;
};

/**
 * Parse and validate a complete provenance chain.
 *
 * Readers that hydrate a complete revision record use this boundary. Bounded history pages parse
 * their immutable origin, latest revision, and visible entries independently so reads stay paged.
 */
export function parseQuestionProvenanceHistory(
  rows: readonly PersistedQuestionProvenanceRevision[],
): ParsedQuestionProvenanceHistory {
  if (rows.length === 0) throw new Error('Question history is missing its first revision.');
  const ordered = [...rows].sort((left, right) => left.revision - right.revision);
  const entries = new Map<number, QuestionProvenanceEntry>();
  let origin: QuestionOrigin | null = null;
  let previous: { readonly revision: number; readonly entry: QuestionProvenanceEntry } | null =
    null;

  for (const row of ordered) {
    const revision = parsePositiveInteger(
      row.revision,
      'Question revision number must be positive.',
    );
    if (entries.has(revision)) throw new Error('Question history contains a duplicate revision.');
    const entry = parseQuestionProvenanceEntry(row.provenance);
    if (previous === null) {
      if (revision !== 1 || entry.event.operation !== 'created' || !('origin' in entry)) {
        throw new Error('Question history has an invalid first revision.');
      }
      origin = questionOriginFromEntry(entry);
      entries.set(revision, entry);
      previous = { revision, entry };
      continue;
    }
    if (
      revision !== previous.revision + 1 ||
      entry.event.operation === 'created' ||
      entry.event.parentRevision !== previous.revision
    ) {
      throw new Error('Question history contains a missing or contradictory revision.');
    }
    if (
      (entry.event.operation === 'transformed' &&
        (previous.entry.event.contentBasis !== 'source' ||
          entry.event.contentBasis !== 'qflow')) ||
      (entry.event.operation === 'revised' &&
        entry.event.contentBasis !== previous.entry.event.contentBasis)
    ) {
      throw new Error('Question history contains a contradictory content transition.');
    }
    if (
      entry.event.operation === 'restored' &&
      (entry.event.restoredFromRevision >= previous.revision ||
        entries.get(entry.event.restoredFromRevision)?.event.contentBasis !==
          entry.event.contentBasis)
    ) {
      throw new Error('Question restoration references an invalid source revision.');
    }
    entries.set(revision, entry);
    previous = { revision, entry };
  }

  if (!origin) throw new Error('Question history is missing its first revision.');
  const first = entries.get(1);
  if (
    !first ||
    (!canOwnSourceContent(origin) && first.event.contentBasis !== 'qflow') ||
    (origin._tag === 'Imported' && first.event.contentBasis !== 'source')
  ) {
    throw new Error('Question origin has a contradictory initial content basis.');
  }
  return { origin, entries };
}

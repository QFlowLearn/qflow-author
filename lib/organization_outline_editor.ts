import type { EnrichmentDefinition } from './services/bank_enrichment_contract.ts';

export type OutlineTopicsResult =
  | {
    readonly ok: true;
    readonly definition: EnrichmentDefinition;
    readonly added: number;
    readonly skipped: number;
  }
  | { readonly ok: false; readonly code: 'empty' | 'too_long' | 'topic_limit' | 'subject_missing' }
  | { readonly ok: false; readonly code: 'label_length'; readonly line: number };

/** Paste is a draft edit. Existing IDs, definitions, teaching and ownership remain untouched. */
export function addOutlineTopics(input: {
  readonly text: string;
  readonly definition: EnrichmentDefinition;
  readonly subjectId: string;
  readonly collectionName: string;
  readonly newId: () => string;
}): OutlineTopicsResult {
  if (input.text.length > 30000) return { ok: false, code: 'too_long' };
  const subject = input.definition.subjects.find((s) => s.id === input.subjectId);
  if (!subject) return { ok: false, code: 'subject_missing' };
  const topics = input.definition.topics.filter((t) =>
    !(t.id === 'topic' && !t.label && !t.definition)
  );
  const key = (value: string) => value.normalize('NFC').trim().toLowerCase();
  const seen = new Set(topics.map((t) => key(t.label)));
  const labels: string[] = [];
  let skipped = 0;
  for (const [index, raw] of input.text.split(/\r\n|[\r\n]/).entries()) {
    if (/^(?:[-*•‣▪]|\d+[.)])$/u.test(raw.trim())) continue;
    const label = raw.trim()
      .replace(/^(?:[-*•‣▪]|\d+[.)])\s+/u, '')
      .replace(/\s*\.{2,}\s*(?:\d+|[ivxlcdm]+)\s*$/iu, '')
      .trim();
    if (!label) continue;
    if (label.length > 80) return { ok: false, code: 'label_length', line: index + 1 };
    if (seen.has(key(label))) {
      skipped++;
      continue;
    }
    seen.add(key(label));
    labels.push(label);
  }
  if (!labels.length && !skipped) return { ok: false, code: 'empty' };
  if (topics.length + labels.length > 250) return { ok: false, code: 'topic_limit' };
  if (!labels.length) return { ok: true, definition: input.definition, added: 0, skipped };
  return {
    ok: true,
    added: labels.length,
    skipped,
    definition: {
      ...input.definition,
      name: input.definition.name || input.collectionName.slice(0, 160),
      subjects: input.definition.subjects.map((s) =>
        s.id === subject.id
          ? {
            ...s,
            label: s.label || input.collectionName.slice(0, 80),
            definition: s.definition || input.collectionName.slice(0, 1000),
          }
          : s
      ),
      topics: [
        ...topics,
        ...labels.map((label) => ({
          id: `outline-${input.newId()}`,
          subjectId: subject.id,
          label,
          definition: label,
        })),
      ],
    },
  };
}

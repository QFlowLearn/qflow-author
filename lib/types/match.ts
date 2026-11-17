import { assertValidQtiIdentifier, isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import { sanitizeInlineHtml } from '../sanitize.ts';
import {
  type QtiInteractionVocabulary,
  qtiStateFromInteractionVocabulary,
} from '../shared_vocabulary.ts';
import {
  type Qti3MatchAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
  trustedQti3Fragment,
} from './qti3_writer_adapter.ts';

export type MatchChoice = { id: string; text?: string; html?: string; matchMax?: number };
export type MatchDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  sources: MatchChoice[];
  targets: MatchChoice[];
  correctPairs: Array<{ sourceId: string; targetId: string }>;
  minAssociations?: number; // 0 = none
  maxAssociations?: number; // 0 = unlimited
  shuffle?: boolean;
  sharedVocabulary?: QtiInteractionVocabulary;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

export function toQti3MatchAuthoringItem(
  draft: MatchDraft,
  opts: BuildOptions,
): Qti3MatchAuthoringItem {
  const identifier = opts.identifier ?? `item-${crypto.randomUUID()}`;
  const choice = (c: MatchChoice) => ({
    identifier: assertValidQtiIdentifier(c.id, 'Match choice identifier'),
    text: c.text,
    contentHtml: c.html && c.html.trim() !== ''
      ? trustedQti3Fragment(sanitizeInlineHtml(c.html))
      : undefined,
    matchMax: c.matchMax,
  });
  return {
    interactionType: 'match',
    identifier,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    sources: (draft.sources || []).map(choice),
    targets: (draft.targets || []).map(choice),
    correctResponse: (draft.correctPairs || []).map((pair) => ({
      sourceIdentifier: pair.sourceId,
      targetIdentifier: pair.targetId,
    })),
    minAssociations: draft.minAssociations,
    maxAssociations: draft.maxAssociations,
    shuffle: draft.shuffle,
    sharedVocabulary: draft.sharedVocabulary
      ? qtiStateFromInteractionVocabulary(draft.sharedVocabulary)
      : undefined,
  };
}

export function defaultsMatch(): MatchDraft {
  return {
    title: 'Matching',
    promptHtml: 'Match the terms',
    bodyHtml: '<p>Match the items.</p>',
    sources: [{ id: 'A', text: 'Dog', matchMax: 1 }, { id: 'B', text: 'Cat', matchMax: 1 }],
    targets: [{ id: 'T1', text: 'Barks', matchMax: 1 }, { id: 'T2', text: 'Meows', matchMax: 1 }],
    correctPairs: [{ sourceId: 'A', targetId: 'T1' }, { sourceId: 'B', targetId: 'T2' }],
    maxAssociations: 0,
  };
}

export function validateMatch(d: MatchDraft): string[] {
  const errs: string[] = [];
  const bodyText = (d.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!d.title?.trim()) errs.push('Title is required.');
  if (!bodyText) errs.push('Body is required.');
  if (!Array.isArray(d.sources) || d.sources.length < 1) {
    errs.push('At least one source choice required.');
  }
  if (!Array.isArray(d.targets) || d.targets.length < 1) {
    errs.push('At least one target choice required.');
  }
  for (const choice of [...(d.sources ?? []), ...(d.targets ?? [])]) {
    const id = (choice.id ?? '').trim();
    if (!id) {
      errs.push('Each match choice must have an identifier.');
      continue;
    }
    if (!isValidQtiIdentifier(id)) errs.push(`Match choice identifier "${id}" is not valid.`);
  }
  for (const p of d.correctPairs || []) {
    if (
      !d.sources.some((s) => s.id === p.sourceId) || !d.targets.some((t) => t.id === p.targetId)
    ) {
      errs.push('Correct pair references unknown choice.');
      break;
    }
  }
  if (typeof d.minAssociations === 'number' && d.minAssociations < 0) {
    errs.push('Minimum associations must be 0 or greater.');
  }
  if (typeof d.maxAssociations === 'number' && d.maxAssociations < 0) {
    errs.push('Maximum associations must be 0 or greater.');
  }
  if (
    typeof d.minAssociations === 'number' &&
    typeof d.maxAssociations === 'number' &&
    d.maxAssociations > 0 &&
    d.minAssociations > d.maxAssociations
  ) {
    errs.push('Minimum associations must be less than or equal to maximum associations.');
  }
  return errs;
}

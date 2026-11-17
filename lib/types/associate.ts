import { assertValidQtiIdentifier, isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import { sanitizeInlineHtml } from '../sanitize.ts';
import { findDuplicateStrings } from './authoring_normalization.ts';
import {
  type Qti3AssociateAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
  trustedQti3Fragment,
} from './qti3_writer_adapter.ts';

export type AssociateChoice = { id: string; text?: string; html?: string; matchMax?: number };
export type AssociateDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  choices: AssociateChoice[];
  correctPairs: Array<{ sourceId: string; targetId: string }>;
  shuffle?: boolean;
  minAssociations?: number;
  maxAssociations?: number;
  responseIdentifier?: string;
};

export type BuildOptions = {
  identifier?: string;
  lang: ItemLanguage;
  scoring?: 'match_correct' | 'map_response';
};

type Pair = { sourceId: string; targetId: string };

function normalizePair(sourceId: string, targetId: string): Pair | null {
  const left = (sourceId ?? '').trim();
  const right = (targetId ?? '').trim();
  if (!left || !right) return null;
  if (left === right) return null;
  return left < right ? { sourceId: left, targetId: right } : { sourceId: right, targetId: left };
}

function uniqPairs(pairs: Pair[]): Pair[] {
  const out: Pair[] = [];
  const seen = new Set<string>();
  for (const pair of pairs) {
    const key = `${pair.sourceId} ${pair.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
  }
  return out;
}

export function toQti3AssociateAuthoringItem(
  draft: AssociateDraft,
  opts: BuildOptions,
): Qti3AssociateAuthoringItem {
  const identifier = opts.identifier ?? `item-${crypto.randomUUID()}`;
  const rid = assertValidQtiIdentifier(
    draft.responseIdentifier ?? 'RESPONSE',
    'Response identifier',
  );
  const normalized = (draft.correctPairs || [])
    .map((p) => normalizePair(p.sourceId, p.targetId))
    .filter((p): p is Pair => Boolean(p));
  const correctPairs = uniqPairs(normalized);
  return {
    interactionType: 'associate',
    identifier,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    responseIdentifier: rid,
    choices: (draft.choices || []).map((choice) => ({
      identifier: assertValidQtiIdentifier(choice.id, 'Associate choice identifier'),
      text: choice.text,
      contentHtml: choice.html && choice.html.trim() !== ''
        ? trustedQti3Fragment(sanitizeInlineHtml(choice.html))
        : undefined,
      matchMax: choice.matchMax,
    })),
    correctResponse: correctPairs.map((pair) => ({
      sourceIdentifier: pair.sourceId,
      targetIdentifier: pair.targetId,
    })),
    scoring: opts.scoring ?? 'match_correct',
    shuffle: draft.shuffle,
    minAssociations: draft.minAssociations,
    maxAssociations: draft.maxAssociations,
  };
}

export function defaultsAssociate(): AssociateDraft {
  return {
    title: 'Associate',
    promptHtml: 'Connect the related pairs.',
    bodyHtml: '<p>Create the correct pairings.</p>',
    choices: [
      { id: 'A', text: 'Sun', matchMax: 1 },
      { id: 'B', text: 'Moon', matchMax: 1 },
      { id: 'C', text: 'Day', matchMax: 1 },
      { id: 'D', text: 'Night', matchMax: 1 },
    ],
    correctPairs: [
      { sourceId: 'A', targetId: 'C' },
      { sourceId: 'B', targetId: 'D' },
    ],
    shuffle: true,
    minAssociations: 0,
    maxAssociations: 0,
  };
}

export function validateAssociate(d: AssociateDraft): string[] {
  const errs: string[] = [];
  if (!d.title?.trim()) errs.push('Title is required.');
  const bodyText = (d.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');
  const choices = Array.isArray(d.choices) ? d.choices : [];
  if (choices.length < 2) errs.push('At least two choices required.');
  const rid = (d.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(rid)) errs.push('Response identifier must be a valid QTI identifier.');

  const ids = choices.map((c) => (c.id ?? '').trim()).filter(Boolean);
  const dupes = findDuplicateStrings(ids);
  if (dupes.length) errs.push(`Choice identifiers must be unique: ${dupes.join(', ')}.`);
  for (const choice of choices) {
    const id = (choice.id ?? '').trim();
    if (!id) {
      errs.push('Each choice must have an identifier.');
      continue;
    }
    if (!isValidQtiIdentifier(id)) errs.push(`Choice identifier "${id}" is not valid.`);
    const hasContent = (choice.text ?? '').trim() || (choice.html ?? '').trim();
    if (!hasContent) errs.push(`Choice "${id}" must have text or HTML.`);
    if (typeof choice.matchMax === 'number' && choice.matchMax < 0) {
      errs.push(`Choice "${id}" matchMax must be 0 or greater.`);
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

  const pairs = Array.isArray(d.correctPairs) ? d.correctPairs : [];
  if (!pairs.length) errs.push('Add at least one correct pair.');
  const seen = new Set<string>();
  for (const p of pairs) {
    const normalized = normalizePair(p.sourceId, p.targetId);
    if (!normalized) {
      errs.push('Pairs must reference two different choices.');
      continue;
    }
    const key = `${normalized.sourceId} ${normalized.targetId}`;
    if (seen.has(key)) {
      errs.push('Correct pairs must be unique (order does not matter).');
      break;
    }
    seen.add(key);
    if (!ids.includes(normalized.sourceId) || !ids.includes(normalized.targetId)) {
      errs.push('Correct pair references unknown choice.');
      break;
    }
  }

  return errs;
}

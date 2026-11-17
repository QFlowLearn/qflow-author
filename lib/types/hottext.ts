import { sanitizeBodyHtml, sanitizeInlineHtml } from '../sanitize.ts';
import type { ItemLanguage } from './item_language.ts';
import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import { createMarkerHtml, listMarkerIds, replaceAllMarkers } from '../qti_markers.ts';
import { findDuplicateStrings, uniqueTrimmedStrings } from './authoring_normalization.ts';
import {
  type QtiInteractionVocabulary,
  qtiStateFromInteractionVocabulary,
} from '../shared_vocabulary.ts';
import {
  type Qti3HottextAuthoringItem,
  sanitizedQti3InlineFragment,
  trustedQti3Fragment,
} from './qti3_writer_adapter.ts';

export const HOTTEXT_MARKER_ATTR = 'data-qti-hottext';

export type HottextSpan = {
  id: string;
  text?: string;
  html?: string;
};

export type HottextDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  hottexts: HottextSpan[];
  correctIds?: string[];
  responseIdentifier?: string;
  maxChoices?: number;
  minChoices?: number;
  minChoicesMessage?: string;
  maxChoicesMessage?: string;
  sharedVocabulary?: QtiInteractionVocabulary;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

export function createHottextMarkerHtml(opts: { id: string; label?: string }) {
  return createMarkerHtml({
    attr: HOTTEXT_MARKER_ATTR,
    id: opts.id,
    label: opts.label ?? opts.id,
    className: 'qti-hottext-marker ds-badge ds-badge-ghost',
  });
}

export function listHottextIds(html: string): string[] {
  return listMarkerIds(html, HOTTEXT_MARKER_ATTR);
}

export function defaultsHottext(): HottextDraft {
  const hottexts: HottextSpan[] = [
    { id: 'A', text: 'first option' },
    { id: 'B', text: 'second option' },
    { id: 'C', text: 'no error' },
  ];
  const markers = hottexts.map((h) => createHottextMarkerHtml({ id: h.id, label: h.text }));
  return {
    title: 'Hot Text',
    promptHtml: '<p>Select the highlighted error.</p>',
    bodyHtml: `<p>${markers.join(' ')}.</p>`,
    hottexts,
    correctIds: ['B'],
    responseIdentifier: 'RESPONSE',
    maxChoices: 1,
  };
}

export function validateHottext(draft: HottextDraft): string[] {
  const errs: string[] = [];
  if (!draft.title?.trim()) errs.push('Title is required.');

  const bodyText = (draft.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');

  const responseId = (draft.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }

  const hottexts = Array.isArray(draft.hottexts) ? draft.hottexts : [];
  if (!hottexts.length) errs.push('Add at least one hot text span.');
  const hottextIds = hottexts.map((h) => (h.id ?? '').trim()).filter(Boolean);
  const dupes = findDuplicateStrings(hottextIds);
  if (dupes.length) errs.push(`Hot text identifiers must be unique: ${dupes.join(', ')}.`);
  for (const span of hottexts) {
    const id = (span.id ?? '').trim();
    if (!id) {
      errs.push('Each hot text must have an identifier.');
      continue;
    }
    if (!isValidQtiIdentifier(id)) {
      errs.push(`Hot text identifier "${id}" is not a valid QTI identifier.`);
    }
    const hasContent = (span.text ?? '').trim() || (span.html ?? '').trim();
    if (!hasContent) errs.push(`Hot text "${id}" must include text or HTML.`);
  }

  const markerIds = listHottextIds(draft.bodyHtml ?? '');
  if (!markerIds.length) errs.push('Insert at least one hot text span into the body.');
  const markerDupes = findDuplicateStrings(markerIds);
  if (markerDupes.length) {
    errs.push(`Body contains duplicate hot text markers: ${markerDupes.join(', ')}.`);
  }
  const markerSet = new Set(markerIds);
  for (const id of hottextIds) {
    if (!markerSet.has(id)) errs.push(`Hot text "${id}" is not placed in the body.`);
  }
  for (const id of markerIds) {
    if (!hottextIds.includes(id)) errs.push(`Body references unknown hot text "${id}".`);
  }

  const maxChoices = normalizeBound(draft.maxChoices);
  const minChoices = normalizeBound(draft.minChoices, 0);
  if (maxChoices !== null && maxChoices < 1) errs.push('Maximum choices must be 1 or greater.');
  if (minChoices !== null && minChoices < 0) errs.push('Minimum choices cannot be negative.');
  if (maxChoices !== null && minChoices !== null && minChoices > maxChoices) {
    errs.push('Minimum choices must be less than or equal to maximum choices.');
  }

  const correctIds = uniqueTrimmedStrings(draft.correctIds ?? []);
  for (const cid of correctIds) {
    if (!hottextIds.includes(cid)) {
      errs.push(`Correct response references unknown hot text "${cid}".`);
    }
  }
  const cardinalitySingle = maxChoices === 1;
  if (cardinalitySingle && correctIds.length > 1) {
    errs.push('Single-response hot text items can only have one correct selection.');
  }

  return errs;
}

export function toQti3HottextAuthoringItem(
  draft: HottextDraft,
  opts: BuildOptions,
): Qti3HottextAuthoringItem {
  const bodyClean = sanitizeBodyHtml(draft.bodyHtml ?? '');
  const { html: bodyWithPlaceholders } = replaceAllMarkers(
    bodyClean,
    HOTTEXT_MARKER_ATTR,
    ({ id }) => `<qti-hottext identifier="${id}"/>`,
  );
  const maxChoices = normalizeBound(draft.maxChoices);
  const minChoices = normalizeBound(draft.minChoices, 0);
  return {
    interactionType: 'hottext',
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    bodyHtml: trustedQti3Fragment(bodyWithPlaceholders.trim() || '<p></p>'),
    choices: (draft.hottexts ?? []).map((span) => ({
      identifier: span.id,
      text: span.text,
      contentHtml: span.html && span.html.trim() !== ''
        ? trustedQti3Fragment(sanitizeInlineHtml(span.html))
        : undefined,
    })),
    correctResponse: uniqueTrimmedStrings(draft.correctIds ?? []),
    minChoices: minChoices ?? undefined,
    maxChoices: maxChoices ?? undefined,
    minChoicesMessage: draft.minChoicesMessage,
    maxChoicesMessage: draft.maxChoicesMessage,
    sharedVocabulary: draft.sharedVocabulary
      ? qtiStateFromInteractionVocabulary(draft.sharedVocabulary)
      : undefined,
  };
}

function normalizeBound(value: number | undefined, min: number = 1): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  const intVal = Math.trunc(value);
  if (intVal < min) return min === 0 ? 0 : min;
  return intVal;
}

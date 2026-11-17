import { toQtiResponseFeedback } from '../answer_feedback_qti.ts';
import type { AnswerFeedback } from '../answer_feedback.ts';
import { sanitizeBodyHtml, sanitizeInlineHtml } from '../sanitize.ts';
import type { ItemLanguage } from './item_language.ts';
import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import { createMarkerHtml, listMarkerIds, replaceAllMarkers } from '../qti_markers.ts';
import { normalizeInputWidthClass, type QtiWritingOrientation } from '../shared_vocabulary.ts';
import { findDuplicateStrings } from './authoring_normalization.ts';
import {
  type Qti3InlineChoiceAuthoringItem,
  sanitizedQti3InlineFragment,
  trustedQti3Fragment,
} from './qti3_writer_adapter.ts';

export const INLINE_CHOICE_MARKER_ATTR = 'data-qti-inline-choice';

export type InlineChoiceOption = {
  id: string;
  text?: string;
  html?: string;
  fixed?: boolean;
  score?: number;
};

export type InlineChoiceSlot = {
  id: string; // QTI response-identifier
  label: string;
  required?: boolean;
  shuffle?: boolean;
  widthClass?: string;
  writingOrientation?: QtiWritingOrientation;
  options: InlineChoiceOption[];
  correctId?: string;
};

export type InlineChoiceDraft = {
  readonly answerFeedback?: AnswerFeedback;
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  inlineChoices: InlineChoiceSlot[];
  maximumScore?: number;
  responseMode?: 'all_or_nothing' | 'partial' | 'custom';
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

export function createInlineChoiceMarkerHtml(opts: { id: string; label?: string }): string {
  return createMarkerHtml({
    attr: INLINE_CHOICE_MARKER_ATTR,
    id: opts.id,
    label: opts.label ?? opts.id,
    className: 'qti-inline-choice-slot ds-badge ds-badge-primary',
    contentEditable: false,
  });
}

export function listInlineChoiceSlotIds(html: string): string[] {
  return listMarkerIds(html, INLINE_CHOICE_MARKER_ATTR);
}

/** Recognize a single dropdown in its own final paragraph without changing the question HTML. */
export function standaloneInlineChoice(
  draft: Pick<InlineChoiceDraft, 'bodyHtml' | 'inlineChoices'>,
):
  | { readonly slot: InlineChoiceSlot; readonly questionHtml: string; readonly suffix: string }
  | null {
  const [slot] = draft.inlineChoices;
  if (!slot || draft.inlineChoices.length !== 1) return null;
  const body = draft.bodyHtml ?? '';
  const ids = listInlineChoiceSlotIds(body);
  if (ids.length !== 1 || ids[0] !== slot.id) return null;
  const end = /<p(?:\s[^>]*)?>\s*<span\b[^>]*>[^<]*<\/span>\s*<\/p>\s*$/i.exec(body);
  if (!end || listInlineChoiceSlotIds(end[0])[0] !== slot.id) return null;
  return { slot, questionHtml: body.slice(0, end.index), suffix: end[0] };
}

export function defaultsInlineChoice(): InlineChoiceDraft {
  const slot: InlineChoiceSlot = {
    id: 'RESPONSE_1',
    label: 'Blank 1',
    required: true,
    shuffle: false,
    options: [
      { id: 'A', text: 'Option A', score: 0 },
      { id: 'B', text: 'Option B', score: 1 },
      { id: 'C', text: 'Option C', score: 0 },
    ],
    correctId: 'B',
  };
  const marker = createInlineChoiceMarkerHtml({ id: slot.id, label: slot.label });
  return {
    title: 'Inline Choice',
    promptHtml: '<p>Select the best option for the blank.</p>',
    bodyHtml: `<p>Choose ${marker} to complete the sentence.</p>`,
    inlineChoices: [slot],
    responseMode: 'all_or_nothing',
  };
}

export function validateInlineChoice(d: InlineChoiceDraft): string[] {
  const errs: string[] = [];
  if (!d.title?.trim()) errs.push('Title is required.');

  const bodyText = (d.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');

  const slots = Array.isArray(d.inlineChoices) ? d.inlineChoices : [];
  if (!slots.length) errs.push('Add at least one inline choice slot.');

  const slotIds = slots.map((s) => (s.id ?? '').trim()).filter(Boolean);
  const slotDupes = findDuplicateStrings(slotIds);
  if (slotDupes.length) {
    errs.push(`Inline choice response identifiers must be unique: ${slotDupes.join(', ')}.`);
  }
  for (const slot of slots) {
    const id = (slot.id ?? '').trim();
    if (!id) {
      errs.push('Each inline choice slot must have a response identifier.');
      continue;
    }
    if (!isValidQtiIdentifier(id)) {
      errs.push(`Inline choice response identifier "${id}" is not a valid QTI identifier.`);
    }
    if (!slot.label?.trim()) errs.push(`Inline choice "${id}" must have a label.`);
    if (!Array.isArray(slot.options) || slot.options.length < 2) {
      errs.push(`Inline choice "${id}" must have at least two options.`);
      continue;
    }
    const optionIds = slot.options.map((o) => (o.id ?? '').trim()).filter(Boolean);
    const optionDupes = findDuplicateStrings(optionIds);
    if (optionDupes.length) {
      errs.push(
        `Inline choice "${id}" has duplicate option identifiers: ${optionDupes.join(', ')}.`,
      );
    }
    for (const opt of slot.options) {
      const oid = (opt.id ?? '').trim();
      if (!oid) {
        errs.push(`Inline choice "${id}" has an option missing an identifier.`);
        continue;
      }
      if (!isValidQtiIdentifier(oid)) {
        errs.push(`Inline choice "${id}" option identifier "${oid}" is not valid.`);
      }
      const hasContent = (opt.text ?? '').trim() || (opt.html ?? '').trim();
      if (!hasContent) errs.push(`Inline choice "${id}" option "${oid}" must have text or HTML.`);
    }
    if (slot.correctId && !slot.options.some((o) => o.id === slot.correctId)) {
      errs.push(`Inline choice "${id}" correct option must match one of its option identifiers.`);
    }
    if (!slot.correctId) errs.push(`Inline choice "${id}" must have a correct option.`);
  }

  const markerIds = listInlineChoiceSlotIds(d.bodyHtml ?? '');
  if (!markerIds.length) errs.push('Insert at least one inline choice slot into the body.');
  const markerDupes = findDuplicateStrings(markerIds);
  if (markerDupes.length) {
    errs.push(`Duplicate inline choice slots found in body: ${markerDupes.join(', ')}.`);
  }
  const slotIdSet = new Set(slotIds);
  for (const mid of markerIds) {
    if (!slotIdSet.has(mid)) errs.push(`Body references unknown inline choice slot "${mid}".`);
  }
  for (const sid of slotIds) {
    if (!markerIds.includes(sid)) errs.push(`Inline choice "${sid}" is not placed in the body.`);
  }

  return errs;
}

export function toQti3InlineChoiceAuthoringItem(
  draft: InlineChoiceDraft,
  opts: BuildOptions,
): Qti3InlineChoiceAuthoringItem {
  const prompt = draft.promptHtml != null ? sanitizeInlineHtml(draft.promptHtml) : '';
  const bodyClean = sanitizeBodyHtml(draft.bodyHtml ?? '');
  const { html: bodyWithPlaceholders } = replaceAllMarkers(
    bodyClean,
    INLINE_CHOICE_MARKER_ATTR,
    ({ id }) => `<qti-inline-choice-interaction response-identifier="${id}"/>`,
  );
  const standalone = standaloneInlineChoice(draft);
  const orderedBody = standalone && prompt
    ? `${sanitizeBodyHtml(standalone.questionHtml)}<div class="qti-inline-prompt">${prompt}</div>${
      replaceAllMarkers(sanitizeBodyHtml(standalone.suffix), INLINE_CHOICE_MARKER_ATTR, ({ id }) =>
        `<qti-inline-choice-interaction response-identifier="${id}"/>`).html
    }`
    : `${prompt ? `<div class="qti-inline-prompt">${prompt}</div>\n` : ''}${
      bodyWithPlaceholders.trim() || '<p></p>'
    }`;

  return {
    interactionType: 'inlineChoice',
    responseFeedback: toQtiResponseFeedback(draft.answerFeedback),
    maximumScore: draft.maximumScore,
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: trustedQti3Fragment(orderedBody),
    slots: (draft.inlineChoices ?? []).map(toQti3InlineChoiceSlot),
    scoring: draft.responseMode === 'partial' || draft.responseMode === 'custom'
      ? 'map_response'
      : 'all_or_nothing',
  };
}

function toQti3InlineChoiceSlot(
  slot: InlineChoiceSlot,
): Qti3InlineChoiceAuthoringItem['slots'][number] {
  return {
    responseIdentifier: slot.id,
    correctResponse: slot.correctId,
    shuffle: Boolean(slot.shuffle),
    required: slot.required,
    classNames: [
      normalizeInputWidthClass(slot.widthClass),
      slot.writingOrientation ? `qti-writing-orientation-${slot.writingOrientation}` : undefined,
    ].filter((className): className is string => Boolean(className)),
    options: (slot.options ?? []).map((option) => ({
      identifier: option.id,
      text: option.text,
      contentHtml: option.html && option.html.trim() !== ''
        ? sanitizedQti3InlineFragment(option.html)
        : undefined,
      fixed: option.fixed,
      score: option.score,
    })),
  };
}

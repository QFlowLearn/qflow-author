import { sanitizeBodyHtml } from '../sanitize.ts';
import type { ItemLanguage } from './item_language.ts';
import {
  createPlaceholderHtml,
  listPlaceholderIds,
  replaceAllPlaceholders,
} from '../text_entry_placeholders.ts';
import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import { normalizeInputWidthClass } from '../shared_vocabulary.ts';
import { xmlEscape } from '../xml.ts';
import { findDuplicateStrings } from './authoring_normalization.ts';
import {
  type Qti3TextEntryAuthoringItem,
  sanitizedQti3InlineFragment,
  trustedQti3Fragment,
} from './qti3_writer_adapter.ts';

export type TextEntryAnswer = {
  id: string;
  value: string;
  score?: number;
  caseSensitive?: boolean;
};

export type TextEntrySlot = {
  id: string;
  label: string;
  base?: number;
  stringIdentifier?: string;
  expectedLength?: number;
  widthClass?: string;
  patternMask?: string;
  patternMessage?: string;
  placeholderText?: string;
  format?: string;
  responseBaseType?: 'string' | 'integer' | 'float';
  answers: TextEntryAnswer[];
};

export type TextEntryDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  textEntries: TextEntrySlot[];
  requirePattern?: boolean;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

export function toQti3TextEntryAuthoringItem(
  draft: TextEntryDraft,
  opts: BuildOptions,
): Qti3TextEntryAuthoringItem {
  const identifier = opts.identifier ?? `item-${crypto.randomUUID()}`;
  const bodyClean = sanitizeBodyHtml(draft.bodyHtml ?? '');
  const slots = Array.isArray(draft.textEntries) ? draft.textEntries : [];
  if (!slots.length) throw new Error('Text entry items must include at least one blank.');
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const { html: bodyWithInteractions, ids: usedIds } = replaceAllPlaceholders(
    bodyClean,
    ({ id }) => {
      const slot = slotById.get(id);
      if (!slot) throw new Error(`Body references unknown text entry "${id}".`);
      return buildInteraction(slot);
    },
  );
  const unused = slots.filter((slot) => !usedIds.includes(slot.id));
  if (unused.length) {
    throw new Error(`Text entry "${unused[0].label}" is not placed in the body content.`);
  }
  return {
    interactionType: 'textEntry',
    identifier,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    bodyHtml: trustedQti3Fragment(bodyWithInteractions),
    responses: slots.map((slot) => ({
      responseIdentifier: slot.id,
      baseType:
        slot.responseBaseType && ['string', 'integer', 'float'].includes(slot.responseBaseType)
          ? slot.responseBaseType
          : 'string',
      answers: (slot.answers ?? []).map((answer) => ({
        value: answer.value,
        score: answer.score,
        caseSensitive: answer.caseSensitive,
      })),
    })),
  };
}

function buildInteraction(slot: TextEntrySlot): string {
  const attrs: string[] = [`response-identifier="${xmlEscape(slot.id)}"`];
  if (slot.base != null && Number.isFinite(slot.base)) {
    const baseVal = Math.trunc(slot.base);
    if (baseVal >= 0) attrs.push(`base="${String(baseVal)}"`);
  }
  if (slot.stringIdentifier) {
    attrs.push(`string-identifier="${xmlEscape(slot.stringIdentifier)}"`);
  }
  if (slot.expectedLength && slot.expectedLength > 0) {
    attrs.push(`expected-length="${String(slot.expectedLength)}"`);
  }
  const widthClass = normalizeInputWidthClass(slot.widthClass);
  if (widthClass) {
    attrs.push(`class="${xmlEscape(widthClass)}"`);
  }
  if (slot.patternMask) {
    attrs.push(`pattern-mask="${xmlEscape(slot.patternMask)}"`);
  }
  if (slot.patternMessage) {
    attrs.push(`data-patternmask-message="${xmlEscape(slot.patternMessage)}"`);
  }
  if (slot.placeholderText) {
    attrs.push(`placeholder-text="${xmlEscape(slot.placeholderText)}"`);
  }
  if (slot.format) {
    attrs.push(`format="${xmlEscape(slot.format)}"`);
  }
  return `<qti-text-entry-interaction ${attrs.join(' ')}/>`;
}

export function createTextEntrySlot(id: string, label?: string): TextEntrySlot {
  return {
    id,
    label: label ?? id,
    base: 10,
    expectedLength: 15,
    widthClass: 'qti-input-width-10',
    responseBaseType: 'string',
    answers: [
      { id: crypto.randomUUID(), value: '', score: 1, caseSensitive: true },
    ],
  };
}

export function defaultsTextEntry(): TextEntryDraft {
  const slot = createTextEntrySlot('RESPONSE', 'Blank 1');
  const placeholder = createPlaceholderHtml({
    id: slot.id,
    label: slot.label,
    widthClass: slot.widthClass,
  });
  return {
    title: 'Fill in the Blank',
    promptHtml: 'Complete the sentence:',
    bodyHtml: `<p>Now is the winter of our discontent ${placeholder}</p>`,
    textEntries: [slot],
  };
}

export function validateTextEntry(d: TextEntryDraft): string[] {
  const errs: string[] = [];
  if (!d.title?.trim()) errs.push('Title is required.');
  const bodyText = (d.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');
  const slots = Array.isArray(d.textEntries) ? d.textEntries : [];
  const requirePattern = Boolean(d.requirePattern);
  if (!slots.length) errs.push('Add at least one text entry blank.');
  const placeholders = listPlaceholderIds(d.bodyHtml ?? '');
  if (!placeholders.length) errs.push('Insert at least one blank into the body.');
  const dupes = findDuplicateStrings(placeholders);
  if (dupes.length) errs.push(`Duplicate blank identifiers found: ${dupes.join(', ')}.`);
  const slotIds = new Set(slots.map((slot) => slot.id));
  for (const id of placeholders) {
    if (!slotIds.has(id)) errs.push(`Body references unknown text entry "${id}".`);
  }
  const slotDupes = findDuplicateStrings(slots.map((slot) => slot.id));
  if (slotDupes.length) {
    errs.push(`Text entry identifiers must be unique: ${slotDupes.join(', ')}.`);
  }
  for (const slot of slots) {
    if (!placeholders.includes(slot.id)) {
      errs.push(`Text entry "${slot.label}" is not placed in the body.`);
    }
    if (requirePattern && !slot.patternMask) {
      errs.push(`Blank "${slot.label}" must include a pattern mask.`);
    }
    if (slot.stringIdentifier && !isValidQtiIdentifier(slot.stringIdentifier)) {
      errs.push(`Blank "${slot.label}" string identifier must be a valid QTI identifier.`);
    }
    if (slot.base != null && (!Number.isFinite(slot.base) || Math.trunc(slot.base) < 0)) {
      errs.push(`Blank "${slot.label}" base must be a non-negative integer.`);
    }
    if (slot.responseBaseType && !['string', 'integer', 'float'].includes(slot.responseBaseType)) {
      errs.push(`Blank "${slot.label}" base-type must be string, integer, or float.`);
    }
  }
  return errs;
}

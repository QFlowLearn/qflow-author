import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import {
  findDuplicateStrings,
  normalizeUnlimitedBound,
  uniqueTrimmedStrings,
} from './authoring_normalization.ts';
import { hasImageMimeType, resolveImageMimeType } from './image_asset.ts';
import {
  type QtiInteractionVocabulary,
  qtiStateFromInteractionVocabulary,
} from '../shared_vocabulary.ts';
import {
  type Qti3HotspotAuthoringItem,
  sanitizedQti3InlineFragment,
} from './qti3_writer_adapter.ts';

export type HotspotRegion = {
  id: string;
  shape: 'circle' | 'rect' | 'poly';
  coords: string;
  label?: string;
};

export type HotspotChoice = HotspotRegion;

export type HotspotDraft = {
  title: string;
  promptHtml?: string;
  hotspotImageSrc?: string;
  hotspotImageAlt?: string;
  hotspotImageType?: string;
  hotspotImageLongDesc?: string;
  responseIdentifier?: string;
  maxChoices?: number;
  minChoices?: number;
  maxChoicesMessage?: string;
  minChoicesMessage?: string;
  choices: HotspotChoice[];
  correctIds?: string[];
  sharedVocabulary?: QtiInteractionVocabulary;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

export function defaultsHotspot(): HotspotDraft {
  return {
    title: 'Hotspot',
    promptHtml: '<p>Click the correct area.</p>',
    hotspotImageSrc: '',
    hotspotImageAlt: '',
    hotspotImageType: '',
    hotspotImageLongDesc: '',
    responseIdentifier: 'RESPONSE',
    maxChoices: 1,
    choices: [
      { id: 'A', shape: 'circle', coords: '50,50,30' },
      { id: 'B', shape: 'rect', coords: '120,120,200,200' },
    ],
    correctIds: ['A'],
  };
}

export function validateHotspot(d: HotspotDraft): string[] {
  const errs: string[] = [];
  if (!d.title?.trim()) errs.push('Title is required.');
  const imageSrc = (d.hotspotImageSrc ?? '').trim();
  const imageAlt = (d.hotspotImageAlt ?? '').trim();
  const imageType = (d.hotspotImageType ?? '').trim();
  if (!imageSrc) errs.push('Image src is required.');
  if (imageSrc && !imageAlt) errs.push('Image alt text is required.');
  if (!hasImageMimeType({ source: imageSrc, mimeType: imageType })) {
    errs.push('Image type is required when it cannot be inferred from the image path.');
  }

  const responseId = (d.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }

  const choices = Array.isArray(d.choices) ? d.choices : [];
  if (!choices.length) errs.push('Add at least one hotspot choice.');
  const ids = choices.map((c) => (c.id ?? '').trim()).filter(Boolean);
  const dupes = findDuplicateStrings(ids);
  if (dupes.length) errs.push(`Hotspot identifiers must be unique: ${dupes.join(', ')}.`);
  for (const c of choices) {
    const id = (c.id ?? '').trim();
    if (!id) {
      errs.push('Each hotspot must have an identifier.');
      continue;
    }
    if (!isValidQtiIdentifier(id)) errs.push(`Hotspot identifier "${id}" is not valid.`);
    if (!c.coords?.trim()) errs.push(`Hotspot "${id}" must have coordinates.`);
    if (!c.shape || !['circle', 'rect', 'poly'].includes(c.shape)) {
      errs.push(`Hotspot "${id}" shape must be circle, rect, or poly.`);
    }
  }

  const maxChoices = normalizeUnlimitedBound(d.maxChoices, 1);
  const minChoices = normalizeUnlimitedBound(d.minChoices, 0);
  if (maxChoices !== null && maxChoices < 1) errs.push('Maximum choices must be at least 1.');
  if (minChoices !== null && minChoices < 0) errs.push('Minimum choices cannot be negative.');
  if (maxChoices !== null && minChoices !== null && minChoices > maxChoices) {
    errs.push('Minimum choices must be less than or equal to maximum choices.');
  }

  const correctIds = uniqueTrimmedStrings(d.correctIds ?? []);
  for (const cid of correctIds) {
    if (!ids.includes(cid)) errs.push(`Correct response references unknown hotspot "${cid}".`);
  }
  if ((maxChoices ?? 1) === 1 && correctIds.length > 1) {
    errs.push('Single-response hotspot items can only have one correct selection.');
  }

  return errs;
}

export function toQti3HotspotAuthoringItem(
  draft: HotspotDraft,
  opts: BuildOptions,
): Qti3HotspotAuthoringItem {
  const identifier = opts.identifier ?? `item-${crypto.randomUUID()}`;
  const imageSrc = (draft.hotspotImageSrc ?? '').trim();
  const choices = Array.isArray(draft.choices) ? draft.choices : [];
  const correctIds = uniqueTrimmedStrings(draft.correctIds ?? []);

  return {
    interactionType: 'hotspot',
    identifier,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    object: {
      data: imageSrc,
      alt: (draft.hotspotImageAlt ?? '').trim(),
      type: resolveImageMimeType({ source: imageSrc, mimeType: draft.hotspotImageType }),
      longDescription: (draft.hotspotImageLongDesc ?? '').trim(),
    },
    choices: choices.map((c) => {
      return { identifier: c.id, shape: c.shape, coords: (c.coords ?? '').trim() };
    }),
    correctResponse: correctIds,
    minChoices: draft.minChoices,
    maxChoices: draft.maxChoices,
    minChoicesMessage: draft.minChoicesMessage,
    maxChoicesMessage: draft.maxChoicesMessage,
    sharedVocabulary: draft.sharedVocabulary
      ? qtiStateFromInteractionVocabulary(draft.sharedVocabulary)
      : undefined,
  };
}

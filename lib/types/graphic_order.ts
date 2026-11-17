import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import {
  findDuplicateStrings,
  normalizeOptionalUnlimitedBound,
  normalizePositiveDimension,
  uniqueTrimmedStrings,
} from './authoring_normalization.ts';
import {
  type Qti3GraphicOrderAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
} from './qti3_writer_adapter.ts';
import { hasImageMimeType, resolveImageMimeType } from './image_asset.ts';

export type GraphicOrderShape = 'circle' | 'rect' | 'poly' | 'ellipse' | 'default';

export type GraphicOrderHotspot = {
  id: string;
  shape: GraphicOrderShape;
  coords: string;
  label?: string;
};

export type GraphicOrderDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  responseIdentifier?: string;
  graphicOrderBackgroundSrc?: string;
  graphicOrderBackgroundAlt?: string;
  graphicOrderBackgroundLongDesc?: string;
  graphicOrderBackgroundType?: string;
  graphicOrderBackgroundWidth?: number;
  graphicOrderBackgroundHeight?: number;
  graphicOrderHotspots: GraphicOrderHotspot[];
  graphicOrderCorrectOrder?: string[];
  minChoices?: number;
  maxChoices?: number;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

const SHAPES: GraphicOrderShape[] = ['circle', 'rect', 'poly', 'ellipse', 'default'];

export function defaultsGraphicOrder(): GraphicOrderDraft {
  return {
    title: 'Graphic Order',
    promptHtml: '<p>Order the highlighted areas.</p>',
    bodyHtml: '<p>Arrange the hotspots in the correct order.</p>',
    responseIdentifier: 'RESPONSE',
    graphicOrderBackgroundSrc: 'background.png',
    graphicOrderBackgroundAlt: 'Background image',
    graphicOrderBackgroundLongDesc: '',
    graphicOrderHotspots: [
      { id: 'A', shape: 'circle', coords: '60,60,12', label: 'First' },
      { id: 'B', shape: 'circle', coords: '160,60,12', label: 'Second' },
      { id: 'C', shape: 'circle', coords: '60,140,12', label: 'Third' },
    ],
    graphicOrderCorrectOrder: ['A', 'B', 'C'],
  };
}

export function validateGraphicOrder(draft: GraphicOrderDraft): string[] {
  const errs: string[] = [];
  if (!draft.title?.trim()) errs.push('Title is required.');

  const bodyText = (draft.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');

  const responseId = (draft.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }

  const bgSrc = (draft.graphicOrderBackgroundSrc ?? '').trim();
  if (!bgSrc) errs.push('Background image is required.');
  if (!(draft.graphicOrderBackgroundAlt ?? '').trim()) {
    errs.push('Background alt text is required.');
  }
  if (
    !hasImageMimeType({
      source: bgSrc,
      mimeType: draft.graphicOrderBackgroundType,
    })
  ) {
    errs.push('Background MIME type is required when it cannot be inferred from the image source.');
  }

  const width = draft.graphicOrderBackgroundWidth;
  if (width != null && (!Number.isFinite(width) || Number(width) <= 0)) {
    errs.push('Background width must be a positive number.');
  }
  const height = draft.graphicOrderBackgroundHeight;
  if (height != null && (!Number.isFinite(height) || Number(height) <= 0)) {
    errs.push('Background height must be a positive number.');
  }

  const hotspots = Array.isArray(draft.graphicOrderHotspots) ? draft.graphicOrderHotspots : [];
  if (hotspots.length < 2) errs.push('Add at least two hotspots.');
  const ids = hotspots.map((h) => (h.id ?? '').trim()).filter(Boolean);
  const dupes = findDuplicateStrings(ids);
  if (dupes.length) errs.push(`Hotspot identifiers must be unique: ${dupes.join(', ')}.`);
  for (const hotspot of hotspots) {
    const id = (hotspot.id ?? '').trim();
    if (!id) {
      errs.push('Each hotspot must have an identifier.');
      continue;
    }
    if (!isValidQtiIdentifier(id)) errs.push(`Hotspot identifier "${id}" is not valid.`);
    if (!hotspot.coords?.trim()) errs.push(`Hotspot "${id}" must have coordinates.`);
    if (!hotspot.shape || !SHAPES.includes(hotspot.shape)) {
      errs.push(`Hotspot "${id}" shape must be circle, rect, poly, ellipse, or default.`);
    }
  }

  const minChoices = normalizeOptionalUnlimitedBound(draft.minChoices, 0);
  const maxChoices = normalizeOptionalUnlimitedBound(draft.maxChoices, 0);
  if (
    minChoices !== undefined && maxChoices !== undefined && maxChoices > 0 &&
    minChoices > maxChoices
  ) {
    errs.push('Minimum choices must be less than or equal to maximum choices.');
  }
  if (maxChoices !== undefined && maxChoices > 0 && maxChoices > hotspots.length) {
    errs.push('Maximum choices cannot exceed number of hotspots.');
  }

  const correctOrder = uniqueTrimmedStrings(draft.graphicOrderCorrectOrder ?? []);
  if (correctOrder.length) {
    const seen = new Set<string>();
    for (const value of correctOrder) {
      if (!ids.includes(value)) {
        errs.push(`Correct order references unknown hotspot "${value}".`);
        break;
      }
      if (seen.has(value)) {
        errs.push('Correct order must not repeat hotspot identifiers.');
        break;
      }
      seen.add(value);
    }
  }

  return errs;
}

export function toQti3GraphicOrderAuthoringItem(
  draft: GraphicOrderDraft,
  opts: BuildOptions,
): Qti3GraphicOrderAuthoringItem {
  return {
    interactionType: 'graphicOrder',
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    object: {
      data: (draft.graphicOrderBackgroundSrc ?? '').trim(),
      alt: draft.graphicOrderBackgroundAlt,
      type: resolveImageMimeType({
        source: draft.graphicOrderBackgroundSrc ?? '',
        mimeType: draft.graphicOrderBackgroundType,
      }),
      width: normalizePositiveDimension(draft.graphicOrderBackgroundWidth),
      height: normalizePositiveDimension(draft.graphicOrderBackgroundHeight),
      longDescription: draft.graphicOrderBackgroundLongDesc,
    },
    hotspots: (draft.graphicOrderHotspots ?? []).map((hotspot) => ({
      identifier: hotspot.id,
      shape: toQti3HotspotShape(hotspot.shape),
      coords: hotspot.coords,
      hotspotLabel: hotspot.label,
    })),
    correctOrder: uniqueTrimmedStrings(draft.graphicOrderCorrectOrder ?? []),
    minChoices: normalizeOptionalUnlimitedBound(draft.minChoices, 0),
    maxChoices: normalizeOptionalUnlimitedBound(draft.maxChoices, 0),
  };
}

function toQti3HotspotShape(shape: GraphicOrderShape): 'circle' | 'rect' | 'poly' {
  if (shape === 'circle' || shape === 'poly') return shape;
  return 'rect';
}

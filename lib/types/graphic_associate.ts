import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import { findDuplicateStrings, normalizePositiveDimension } from './authoring_normalization.ts';
import { hasImageMimeType, resolveImageMimeType } from './image_asset.ts';
import {
  type Qti3GraphicAssociateAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
} from './qti3_writer_adapter.ts';
import type { HotspotRegion } from './hotspot.ts';

export type GraphicAssociateHotspot = HotspotRegion & { matchMax?: number };
export type GraphicAssociatePair = { sourceId: string; targetId: string };

export type GraphicAssociateDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  responseIdentifier?: string;
  graphicAssociateBackgroundSrc?: string;
  graphicAssociateBackgroundAlt?: string;
  graphicAssociateBackgroundLongDesc?: string;
  graphicAssociateBackgroundType?: string;
  graphicAssociateBackgroundWidth?: number;
  graphicAssociateBackgroundHeight?: number;
  graphicAssociateHotspots: GraphicAssociateHotspot[];
  graphicAssociateCorrectPairs: GraphicAssociatePair[];
  minAssociations?: number;
  maxAssociations?: number;
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

export function defaultsGraphicAssociate(): GraphicAssociateDraft {
  return {
    title: 'Graphic Associate',
    promptHtml: '<p>Connect the related locations.</p>',
    bodyHtml: '<p>Use the map to pair the related hotspots.</p>',
    responseIdentifier: 'RESPONSE',
    graphicAssociateBackgroundSrc: 'background.png',
    graphicAssociateBackgroundAlt: 'Map',
    graphicAssociateBackgroundLongDesc: '',
    graphicAssociateHotspots: [
      { id: 'A', shape: 'circle', coords: '50,50,10', matchMax: 2 },
      { id: 'B', shape: 'circle', coords: '150,50,10', matchMax: 2 },
      { id: 'C', shape: 'circle', coords: '50,120,10', matchMax: 2 },
      { id: 'D', shape: 'circle', coords: '150,120,10', matchMax: 2 },
    ],
    graphicAssociateCorrectPairs: [
      { sourceId: 'A', targetId: 'B' },
      { sourceId: 'C', targetId: 'D' },
    ],
    minAssociations: 0,
    maxAssociations: 0,
  };
}

export function validateGraphicAssociate(draft: GraphicAssociateDraft): string[] {
  const errs: string[] = [];
  if (!draft.title?.trim()) errs.push('Title is required.');

  const bodyText = (draft.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');

  const responseId = (draft.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }

  const bgSrc = (draft.graphicAssociateBackgroundSrc ?? '').trim();
  if (!bgSrc) errs.push('Background image is required.');
  if (!(draft.graphicAssociateBackgroundAlt ?? '').trim()) {
    errs.push('Background alt text is required.');
  }
  if (
    !hasImageMimeType({
      source: bgSrc,
      mimeType: draft.graphicAssociateBackgroundType,
    })
  ) {
    errs.push('Background MIME type is required when it cannot be inferred from the image source.');
  }

  const width = draft.graphicAssociateBackgroundWidth;
  if (width != null && (!Number.isFinite(width) || Number(width) <= 0)) {
    errs.push('Background width must be a positive number.');
  }
  const height = draft.graphicAssociateBackgroundHeight;
  if (height != null && (!Number.isFinite(height) || Number(height) <= 0)) {
    errs.push('Background height must be a positive number.');
  }

  const hotspots = Array.isArray(draft.graphicAssociateHotspots)
    ? draft.graphicAssociateHotspots
    : [];
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
    if (!hotspot.shape || !['rect', 'circle', 'poly'].includes(hotspot.shape)) {
      errs.push(`Hotspot "${id}" shape must be rect, circle, or poly.`);
    }
    if (typeof hotspot.matchMax === 'number' && hotspot.matchMax < 0) {
      errs.push(`Hotspot "${id}" matchMax must be 0 or greater.`);
    }
  }

  if (typeof draft.minAssociations === 'number' && draft.minAssociations < 0) {
    errs.push('Minimum associations must be 0 or greater.');
  }
  if (typeof draft.maxAssociations === 'number' && draft.maxAssociations < 0) {
    errs.push('Maximum associations must be 0 or greater.');
  }
  if (
    typeof draft.minAssociations === 'number' &&
    typeof draft.maxAssociations === 'number' &&
    draft.maxAssociations > 0 &&
    draft.minAssociations > draft.maxAssociations
  ) {
    errs.push('Minimum associations must be less than or equal to maximum associations.');
  }

  const pairs = Array.isArray(draft.graphicAssociateCorrectPairs)
    ? draft.graphicAssociateCorrectPairs
    : [];
  if (!pairs.length) errs.push('Add at least one correct pair.');
  const normalizedPairs = pairs
    .map((p) => normalizePair(p.sourceId, p.targetId))
    .filter((p): p is Pair => Boolean(p));
  const seen = new Set<string>();
  for (const p of normalizedPairs) {
    const key = `${p.sourceId} ${p.targetId}`;
    if (seen.has(key)) {
      errs.push('Correct pairs must be unique (order does not matter).');
      break;
    }
    seen.add(key);
    if (!ids.includes(p.sourceId) || !ids.includes(p.targetId)) {
      errs.push('Correct pair references unknown hotspot.');
      break;
    }
  }

  return errs;
}

export function toQti3GraphicAssociateAuthoringItem(
  draft: GraphicAssociateDraft,
  opts: BuildOptions,
): Qti3GraphicAssociateAuthoringItem {
  const identifier = opts.identifier ?? `item-${crypto.randomUUID()}`;
  const bgSrc = (draft.graphicAssociateBackgroundSrc ?? '').trim();
  const bgType = resolveImageMimeType({
    source: bgSrc,
    mimeType: draft.graphicAssociateBackgroundType,
  });
  const hotspots = Array.isArray(draft.graphicAssociateHotspots)
    ? draft.graphicAssociateHotspots
    : [];
  const normalized = (draft.graphicAssociateCorrectPairs || [])
    .map((p) => normalizePair(p.sourceId, p.targetId))
    .filter((p): p is Pair => Boolean(p));
  const correctPairs = uniqPairs(normalized);

  return {
    interactionType: 'graphicAssociate',
    identifier,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    object: {
      data: bgSrc,
      alt: (draft.graphicAssociateBackgroundAlt ?? '').trim(),
      type: bgType,
      width: normalizePositiveDimension(draft.graphicAssociateBackgroundWidth),
      height: normalizePositiveDimension(draft.graphicAssociateBackgroundHeight),
      longDescription: (draft.graphicAssociateBackgroundLongDesc ?? '').trim(),
    },
    hotspots: hotspots.map((hotspot) => {
      return {
        identifier: hotspot.id,
        hotspotLabel: hotspot.label,
        shape: hotspot.shape,
        coords: (hotspot.coords ?? '').trim(),
        matchMax: Number.isFinite(hotspot.matchMax) ? Math.max(0, Number(hotspot.matchMax)) : 1,
      };
    }),
    correctResponse: correctPairs.map((pair) => ({
      sourceIdentifier: pair.sourceId,
      targetIdentifier: pair.targetId,
    })),
    scoring: opts.scoring ?? 'match_correct',
    minAssociations: draft.minAssociations,
    maxAssociations: draft.maxAssociations,
  };
}

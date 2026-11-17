import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import {
  normalizeCoordinatePoints,
  normalizeMappedImageTargets,
  normalizeOptionalUnlimitedBound,
  normalizePositiveDimension,
  normalizeUnlimitedBound,
} from './authoring_normalization.ts';
import {
  type Qti3SelectPointAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
} from './qti3_writer_adapter.ts';
import { selectPointCardinalityPolicy } from './select_point_cardinality.ts';
import { hasImageMimeType, resolveImageMimeType } from './image_asset.ts';

export type SelectPointShape = 'circle' | 'rect' | 'poly' | 'default';

export type SelectPointTarget = {
  shape: SelectPointShape;
  coords: string;
  mappedValue?: number;
};

export type SelectPointDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  responseIdentifier?: string;
  selectPointImageSrc?: string;
  selectPointImageAlt?: string;
  selectPointImageLongDesc?: string;
  selectPointImageType?: string;
  selectPointImageWidth?: number;
  selectPointImageHeight?: number;
  selectPointTargets?: SelectPointTarget[];
  selectPointCorrectPoints?: string[];
  minChoices?: number;
  maxChoices?: number;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

const SHAPES: SelectPointShape[] = ['circle', 'rect', 'poly', 'default'];

export function defaultsSelectPoint(): SelectPointDraft {
  return {
    title: 'Select Point',
    promptHtml: '<p>Select the correct point on the image.</p>',
    bodyHtml: '<p>Click the correct location on the image below.</p>',
    responseIdentifier: 'RESPONSE',
    selectPointImageSrc: 'images/map.png',
    selectPointImageAlt: 'Background image',
    selectPointImageLongDesc: '',
    selectPointImageWidth: 320,
    selectPointImageHeight: 240,
    selectPointTargets: [
      { shape: 'circle', coords: '120,120,12', mappedValue: 1 },
    ],
    selectPointCorrectPoints: ['120 120'],
    minChoices: 0,
    maxChoices: 1,
  };
}

export function validateSelectPoint(draft: SelectPointDraft): string[] {
  const errs: string[] = [];
  if (!draft.title?.trim()) errs.push('Title is required.');

  const responseId = (draft.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }

  const imageSrc = (draft.selectPointImageSrc ?? '').trim();
  if (!imageSrc) errs.push('Image source is required.');
  const imageAlt = (draft.selectPointImageAlt ?? '').trim();
  if (!imageAlt) errs.push('Image alt text is required.');
  if (!hasImageMimeType({ source: imageSrc, mimeType: draft.selectPointImageType })) {
    errs.push('Image MIME type is required when it cannot be inferred from the image source.');
  }

  const width = draft.selectPointImageWidth;
  if (width != null && (!Number.isFinite(width) || Number(width) <= 0)) {
    errs.push('Image width must be a positive number.');
  }
  const height = draft.selectPointImageHeight;
  if (height != null && (!Number.isFinite(height) || Number(height) <= 0)) {
    errs.push('Image height must be a positive number.');
  }

  const minChoices = normalizeUnlimitedBound(draft.minChoices, 0);
  const cardinality = selectPointCardinalityPolicy(draft.maxChoices);
  if (
    draft.maxChoices != null &&
    (!Number.isFinite(draft.maxChoices) || draft.maxChoices < 0)
  ) {
    errs.push('Maximum choices must be a non-negative number.');
  }
  if (
    minChoices !== null &&
    cardinality.maxChoices !== undefined &&
    cardinality.maxChoices > 0 &&
    minChoices > cardinality.maxChoices
  ) {
    errs.push('Minimum choices must be less than or equal to maximum choices.');
  }

  const targets = normalizeMappedImageTargets<SelectPointShape>(
    draft.selectPointTargets,
    'circle',
  );
  for (const target of targets) {
    if (!target.coords.trim()) errs.push('Each target must include coordinates.');
    if (!target.shape || !SHAPES.includes(target.shape)) {
      errs.push('Target shapes must be circle, rect, poly, or default.');
    }
  }

  const points = normalizeCoordinatePoints(draft.selectPointCorrectPoints);
  if ((draft.selectPointCorrectPoints ?? []).length && points.length === 0) {
    errs.push('Correct points must be in the format "x y".');
  }
  if (cardinality.pointLimit !== undefined && points.length > cardinality.pointLimit) {
    errs.push(
      cardinality.pointLimit === 1
        ? 'This item allows one correct point.'
        : `Correct points cannot exceed the maximum of ${cardinality.pointLimit}.`,
    );
  }

  return errs;
}

export function toQti3SelectPointAuthoringItem(
  draft: SelectPointDraft,
  opts: BuildOptions,
): Qti3SelectPointAuthoringItem {
  return {
    interactionType: 'selectPoint',
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    object: {
      data: (draft.selectPointImageSrc ?? '').trim(),
      alt: draft.selectPointImageAlt,
      type: resolveImageMimeType({
        source: draft.selectPointImageSrc ?? '',
        mimeType: draft.selectPointImageType,
      }),
      width: normalizePositiveDimension(draft.selectPointImageWidth),
      height: normalizePositiveDimension(draft.selectPointImageHeight),
      longDescription: draft.selectPointImageLongDesc,
    },
    targets: normalizeMappedImageTargets<SelectPointShape>(draft.selectPointTargets, 'circle'),
    correctResponse: normalizeCoordinatePoints(draft.selectPointCorrectPoints),
    minChoices: normalizeOptionalUnlimitedBound(draft.minChoices, 0),
    maxChoices: selectPointCardinalityPolicy(draft.maxChoices).maxChoices,
  };
}

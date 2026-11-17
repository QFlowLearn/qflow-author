import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import {
  normalizeCoordinatePoints,
  normalizeMappedImageTargets,
  normalizeOptionalUnlimitedBound,
  normalizePointString,
  normalizePositiveDimension,
  normalizeUnlimitedBound,
} from './authoring_normalization.ts';
import {
  type Qti3PositionObjectAuthoringItem,
  sanitizedQti3BodyFragment,
} from './qti3_writer_adapter.ts';
import { hasImageMimeType, resolveImageMimeType } from './image_asset.ts';

export type PositionObjectShape = 'circle' | 'rect' | 'poly' | 'default';

export type PositionObjectTarget = {
  shape: PositionObjectShape;
  coords: string;
  mappedValue?: number;
};

export type PositionObjectDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  responseIdentifier?: string;
  positionStageSrc?: string;
  positionStageAlt?: string;
  positionStageLongDesc?: string;
  positionStageType?: string;
  positionStageWidth?: number;
  positionStageHeight?: number;
  positionObjectSrc?: string;
  positionObjectAlt?: string;
  positionObjectType?: string;
  positionObjectWidth?: number;
  positionObjectHeight?: number;
  positionCenterPoint?: string;
  positionTargets?: PositionObjectTarget[];
  positionCorrectPoints?: string[];
  minChoices?: number;
  maxChoices?: number;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

const SHAPES: PositionObjectShape[] = ['circle', 'rect', 'poly', 'default'];

export function defaultsPositionObject(): PositionObjectDraft {
  return {
    title: 'Position Object',
    promptHtml: '<p>Drag the marker to the correct location.</p>',
    bodyHtml: '<p>Place the marker on the map.</p>',
    responseIdentifier: 'RESPONSE',
    positionStageSrc: 'images/stage.png',
    positionStageAlt: 'Background stage',
    positionStageLongDesc: '',
    positionStageWidth: 320,
    positionStageHeight: 240,
    positionObjectSrc: 'images/marker.png',
    positionObjectAlt: 'Draggable marker',
    positionObjectWidth: 24,
    positionObjectHeight: 24,
    positionTargets: [
      { shape: 'circle', coords: '120,120,12', mappedValue: 1 },
    ],
    positionCorrectPoints: ['120 120'],
    minChoices: 0,
    maxChoices: 1,
  };
}

export function validatePositionObject(draft: PositionObjectDraft): string[] {
  const errs: string[] = [];
  if (!draft.title?.trim()) errs.push('Title is required.');

  const bodyText = (draft.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');

  const responseId = (draft.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }

  const stageSrc = (draft.positionStageSrc ?? '').trim();
  if (!stageSrc) errs.push('Stage image source is required.');
  if (!(draft.positionStageAlt ?? '').trim()) errs.push('Stage alt text is required.');
  if (!hasImageMimeType({ source: stageSrc, mimeType: draft.positionStageType })) {
    errs.push('Stage MIME type is required when it cannot be inferred from the image source.');
  }
  const objectSrc = (draft.positionObjectSrc ?? '').trim();
  if (!objectSrc) errs.push('Draggable object source is required.');
  if (!(draft.positionObjectAlt ?? '').trim()) errs.push('Draggable object alt text is required.');
  if (!hasImageMimeType({ source: objectSrc, mimeType: draft.positionObjectType })) {
    errs.push('Object MIME type is required when it cannot be inferred from the image source.');
  }

  const stageWidth = draft.positionStageWidth;
  if (stageWidth != null && (!Number.isFinite(stageWidth) || Number(stageWidth) <= 0)) {
    errs.push('Stage width must be a positive number.');
  }
  const stageHeight = draft.positionStageHeight;
  if (stageHeight != null && (!Number.isFinite(stageHeight) || Number(stageHeight) <= 0)) {
    errs.push('Stage height must be a positive number.');
  }
  const objectWidth = draft.positionObjectWidth;
  if (objectWidth != null && (!Number.isFinite(objectWidth) || Number(objectWidth) <= 0)) {
    errs.push('Object width must be a positive number.');
  }
  const objectHeight = draft.positionObjectHeight;
  if (objectHeight != null && (!Number.isFinite(objectHeight) || Number(objectHeight) <= 0)) {
    errs.push('Object height must be a positive number.');
  }

  const minChoices = normalizeUnlimitedBound(draft.minChoices, 0);
  const maxChoices = normalizeUnlimitedBound(draft.maxChoices, 0);
  if (minChoices !== null && maxChoices !== null && maxChoices > 0 && minChoices > maxChoices) {
    errs.push('Minimum choices must be less than or equal to maximum choices.');
  }

  const targets = normalizeMappedImageTargets<PositionObjectShape>(
    draft.positionTargets,
    'circle',
  );
  for (const target of targets) {
    if (!target.coords.trim()) errs.push('Each target must include coordinates.');
    if (!target.shape || !SHAPES.includes(target.shape)) {
      errs.push('Target shapes must be circle, rect, poly, or default.');
    }
  }

  const points = normalizeCoordinatePoints(draft.positionCorrectPoints);
  if ((draft.positionCorrectPoints ?? []).length && points.length === 0) {
    errs.push('Correct points must be in the format "x y".');
  }

  return errs;
}

export function toQti3PositionObjectAuthoringItem(
  draft: PositionObjectDraft,
  opts: BuildOptions,
): Qti3PositionObjectAuthoringItem {
  return {
    interactionType: 'positionObject',
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: positionObjectBodyHtml(draft),
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    stageObject: {
      data: (draft.positionStageSrc ?? '').trim(),
      alt: draft.positionStageAlt,
      type: resolveImageMimeType({
        source: draft.positionStageSrc ?? '',
        mimeType: draft.positionStageType,
      }),
      width: normalizePositiveDimension(draft.positionStageWidth),
      height: normalizePositiveDimension(draft.positionStageHeight),
      longDescription: draft.positionStageLongDesc,
    },
    movableObject: {
      data: (draft.positionObjectSrc ?? '').trim(),
      alt: draft.positionObjectAlt,
      type: resolveImageMimeType({
        source: draft.positionObjectSrc ?? '',
        mimeType: draft.positionObjectType,
      }),
      width: normalizePositiveDimension(draft.positionObjectWidth),
      height: normalizePositiveDimension(draft.positionObjectHeight),
    },
    targets: normalizeMappedImageTargets<PositionObjectShape>(draft.positionTargets, 'circle'),
    correctResponse: normalizeCoordinatePoints(draft.positionCorrectPoints),
    centerPoint: normalizePointString(draft.positionCenterPoint ?? ''),
    minChoices: normalizeOptionalUnlimitedBound(draft.minChoices, 0),
    maxChoices: normalizeOptionalUnlimitedBound(draft.maxChoices, 0),
  };
}

function positionObjectBodyHtml(draft: PositionObjectDraft) {
  const promptHtml = draft.promptHtml ?? '';
  const promptContainer = promptHtml.trim() ? `<div>${promptHtml}</div>` : '';
  return sanitizedQti3BodyFragment(`${draft.bodyHtml ?? ''}${promptContainer}`);
}

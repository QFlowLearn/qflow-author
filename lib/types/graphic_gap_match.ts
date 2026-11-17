import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import { findDuplicateStrings, uniqueTrimmedStrings } from './authoring_normalization.ts';
import { hasImageMimeType, resolveImageMimeType } from './image_asset.ts';
import {
  type QtiInteractionVocabulary,
  qtiStateFromInteractionVocabulary,
} from '../shared_vocabulary.ts';
import {
  type Qti3GraphicGapMatchAuthoringItem,
  sanitizedQti3InlineFragment,
} from './qti3_writer_adapter.ts';
import type { HotspotRegion } from './hotspot.ts';

export type GraphicGapChoice = {
  id: string;
  kind: 'text' | 'image';
  text?: string;
  html?: string;
  imgSrc?: string;
  imgAlt?: string;
  imgType?: string;
  matchMax?: number;
  fixed?: boolean;
};

export type GraphicGapTarget = HotspotRegion & {
  matchMax?: number;
};

export type GraphicGapPair = { choiceId: string; targetId: string };

export type GraphicGapMatchDraft = {
  title: string;
  promptHtml?: string;
  graphicBackgroundSrc?: string;
  graphicBackgroundAlt?: string;
  graphicBackgroundLongDesc?: string;
  graphicBackgroundType?: string;
  responseIdentifier?: string;
  choices: GraphicGapChoice[];
  targets: GraphicGapTarget[];
  correctPairs: GraphicGapPair[];
  minAssociations?: number;
  maxAssociations?: number;
  minAssociationsMessage?: string;
  maxAssociationsMessage?: string;
  sharedVocabulary?: QtiInteractionVocabulary;
};

export type BuildOptions = {
  identifier?: string;
  lang: ItemLanguage;
  scoring?: 'match_correct' | 'map_response';
};

export function defaultsGraphicGapMatch(): GraphicGapMatchDraft {
  return {
    title: 'Graphic Gap Match',
    promptHtml: '<p>Drag each label to the correct region.</p>',
    graphicBackgroundSrc: 'background.png',
    graphicBackgroundAlt: 'Background image',
    graphicBackgroundLongDesc: '',
    responseIdentifier: 'RESPONSE',
    choices: [
      { id: 'A', kind: 'image', imgSrc: 'choice-a.png', imgAlt: 'Choice A', matchMax: 1 },
      { id: 'B', kind: 'image', imgSrc: 'choice-b.png', imgAlt: 'Choice B', matchMax: 1 },
    ],
    targets: [
      { id: 'T1', shape: 'rect', coords: '50,50,150,120', matchMax: 1 },
      { id: 'T2', shape: 'rect', coords: '200,50,300,120', matchMax: 1 },
    ],
    correctPairs: [
      { choiceId: 'A', targetId: 'T1' },
      { choiceId: 'B', targetId: 'T2' },
    ],
    sharedVocabulary: {
      choicesPosition: 'top',
      choicesContainerWidth: 300,
    },
  };
}

export function validateGraphicGapMatch(d: GraphicGapMatchDraft): string[] {
  const errs: string[] = [];
  if (!d.title?.trim()) errs.push('Title is required.');
  if (!(d.graphicBackgroundSrc ?? '').trim()) errs.push('Background image is required.');
  if (!(d.graphicBackgroundAlt ?? '').trim()) errs.push('Background alt text is required.');
  if (
    !hasImageMimeType({
      source: d.graphicBackgroundSrc ?? '',
      mimeType: d.graphicBackgroundType,
    })
  ) {
    errs.push('Background MIME type is required when it cannot be inferred from the image source.');
  }

  const responseId = (d.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }

  const choices = Array.isArray(d.choices) ? d.choices : [];
  if (!choices.length) errs.push('Add at least one draggable choice.');
  const choiceIds = choices.map((c) => (c.id ?? '').trim()).filter(Boolean);
  const choiceDupes = findDuplicateStrings(choiceIds);
  if (choiceDupes.length) {
    errs.push(`Choice identifiers must be unique: ${choiceDupes.join(', ')}.`);
  }
  for (const c of choices) {
    const id = (c.id ?? '').trim();
    if (!id) {
      errs.push('Each choice must have an identifier.');
      continue;
    }
    if (!isValidQtiIdentifier(id)) errs.push(`Choice identifier "${id}" is not valid.`);
    if (c.kind === 'image') {
      if (!(c.imgSrc ?? '').trim()) errs.push(`Choice "${id}" must set imgSrc.`);
      if (!(c.imgAlt ?? '').trim()) errs.push(`Choice "${id}" must set imgAlt.`);
      if (!hasImageMimeType({ source: c.imgSrc ?? '', mimeType: c.imgType })) {
        errs.push(
          `Choice "${id}" MIME type is required when it cannot be inferred from the image source.`,
        );
      }
    } else if (c.kind === 'text') {
      const hasContent = (c.html ?? '').trim() || (c.text ?? '').trim();
      if (!hasContent) errs.push(`Choice "${id}" must have text or HTML.`);
    } else {
      errs.push(`Choice "${id}" must set kind to "text" or "image".`);
    }
    if (typeof c.matchMax === 'number' && c.matchMax < 0) {
      errs.push(`Choice "${id}" matchMax must be 0 or greater.`);
    }
  }

  const targets = Array.isArray(d.targets) ? d.targets : [];
  if (!targets.length) errs.push('Add at least one drop target.');
  const targetIds = targets.map((t) => (t.id ?? '').trim()).filter(Boolean);
  const targetDupes = findDuplicateStrings(targetIds);
  if (targetDupes.length) {
    errs.push(`Target identifiers must be unique: ${targetDupes.join(', ')}.`);
  }
  for (const t of targets) {
    const id = (t.id ?? '').trim();
    if (!id) {
      errs.push('Each target must have an identifier.');
      continue;
    }
    if (!isValidQtiIdentifier(id)) errs.push(`Target identifier "${id}" is not valid.`);
    if (!t.coords?.trim()) errs.push(`Target "${id}" must have coordinates.`);
    if (!t.shape || !['rect', 'circle', 'poly'].includes(t.shape)) {
      errs.push(`Target "${id}" shape must be rect, circle, or poly.`);
    }
    if (typeof t.matchMax === 'number' && t.matchMax < 0) {
      errs.push(`Target "${id}" matchMax must be 0 or greater.`);
    }
  }

  const pairs = Array.isArray(d.correctPairs) ? d.correctPairs : [];
  const pairKeys = pairs.map((p) => `${p.choiceId}→${p.targetId}`);
  const pairDupes = findDuplicateStrings(pairKeys);
  if (pairDupes.length) errs.push(`Correct pairs must be unique: ${pairDupes.join(', ')}.`);
  const choiceSet = new Set(choiceIds);
  const targetSet = new Set(targetIds);
  for (const p of pairs) {
    if (!choiceSet.has((p.choiceId ?? '').trim())) {
      errs.push(`Correct pair references unknown choice "${p.choiceId}".`);
    }
    if (!targetSet.has((p.targetId ?? '').trim())) {
      errs.push(`Correct pair references unknown target "${p.targetId}".`);
    }
  }

  const minAssociations = normalizeBound(d.minAssociations, 0);
  const maxAssociations = normalizeBound(d.maxAssociations, 0);
  if (maxAssociations !== null && maxAssociations < 0) {
    errs.push('Maximum associations must be 0 or greater.');
  }
  if (minAssociations !== null && minAssociations < 0) {
    errs.push('Minimum associations must be 0 or greater.');
  }
  if (
    minAssociations !== null && maxAssociations !== null && maxAssociations > 0 &&
    minAssociations > maxAssociations
  ) {
    errs.push('Minimum associations must be less than or equal to maximum associations.');
  }

  return errs;
}

export function toQti3GraphicGapMatchAuthoringItem(
  draft: GraphicGapMatchDraft,
  opts: BuildOptions,
): Qti3GraphicGapMatchAuthoringItem {
  const identifier = opts.identifier ?? `item-${crypto.randomUUID()}`;
  const bgSrc = (draft.graphicBackgroundSrc ?? '').trim();
  const choices = Array.isArray(draft.choices) ? draft.choices : [];
  const targets = Array.isArray(draft.targets) ? draft.targets : [];
  const pairs = Array.isArray(draft.correctPairs) ? draft.correctPairs : [];
  const correctValues = uniqueTrimmedStrings(
    pairs.map((p) => `${(p.choiceId ?? '').trim()} ${(p.targetId ?? '').trim()}`.trim()).filter(
      Boolean,
    ),
  );
  return {
    interactionType: 'graphicGapMatch',
    identifier,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    object: {
      data: bgSrc,
      alt: (draft.graphicBackgroundAlt ?? '').trim(),
      type: resolveImageMimeType({
        source: bgSrc,
        mimeType: draft.graphicBackgroundType,
      }),
      longDescription: (draft.graphicBackgroundLongDesc ?? '').trim(),
    },
    choices: choices.map((choice) => {
      const matchMax = Number.isFinite(choice.matchMax) ? Math.max(0, Number(choice.matchMax)) : 1;
      if (choice.kind === 'text') {
        const html = (choice.html ?? '').trim();
        return {
          identifier: choice.id,
          kind: 'text',
          text: (choice.text ?? '').trim(),
          contentHtml: html ? sanitizedQti3InlineFragment(html) : undefined,
          matchMax,
        };
      }
      return {
        identifier: choice.id,
        kind: 'image',
        object: {
          data: (choice.imgSrc ?? '').trim(),
          alt: (choice.imgAlt ?? '').trim(),
          type: resolveImageMimeType({
            source: choice.imgSrc ?? '',
            mimeType: choice.imgType,
          }),
        },
        matchMax,
      };
    }),
    targets: targets.map((target) => ({
      targetType: 'hotspot',
      identifier: target.id,
      shape: target.shape,
      coords: (target.coords ?? '').trim(),
      matchMax: Number.isFinite(target.matchMax) ? Math.max(0, Number(target.matchMax)) : 1,
    })),
    correctResponse: correctValues.map((value) => {
      const [sourceIdentifier = '', targetIdentifier = ''] = value.split(/\s+/);
      return { sourceIdentifier, targetIdentifier };
    }),
    minAssociations: draft.minAssociations,
    maxAssociations: draft.maxAssociations,
    minAssociationsMessage: draft.minAssociationsMessage,
    maxAssociationsMessage: draft.maxAssociationsMessage,
    scoring: opts.scoring ?? 'match_correct',
    sharedVocabulary: draft.sharedVocabulary
      ? qtiStateFromInteractionVocabulary(draft.sharedVocabulary)
      : undefined,
  };
}

function normalizeBound(value: number | undefined, min: number): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  const intVal = Math.trunc(value);
  if (intVal < min) return min;
  return intVal;
}

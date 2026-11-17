import { sanitizeBodyHtml, sanitizeInlineHtml } from '../sanitize.ts';
import type { ItemLanguage } from './item_language.ts';
import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import { createMarkerHtml, listMarkerIds, replaceAllMarkers } from '../qti_markers.ts';
import {
  normalizeInputWidthClass,
  type QtiInteractionVocabulary,
  qtiStateFromInteractionVocabulary,
} from '../shared_vocabulary.ts';
import { xmlEscape } from '../xml.ts';
import { findDuplicateStrings, uniqueTrimmedStrings } from './authoring_normalization.ts';
import {
  type Qti3GapMatchAuthoringItem,
  sanitizedQti3InlineFragment,
  trustedQti3Fragment,
} from './qti3_writer_adapter.ts';

export const GAP_MARKER_ATTR = 'data-qti-gap';

export type GapMatchChoice = {
  id: string;
  kind: 'text' | 'image';
  text?: string;
  html?: string;
  imgSrc?: string;
  imgAlt?: string;
  matchMax?: number;
  fixed?: boolean;
};

export type GapTarget = {
  id: string;
  label: string;
  widthClass?: string;
};

export type GapMatchPair = { choiceId: string; gapId: string };

export type GapMatchDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;

  responseIdentifier?: string;
  shuffle?: boolean;
  minAssociations?: number;
  maxAssociations?: number;
  minAssociationsMessage?: string;
  maxAssociationsMessage?: string;

  gapChoices: GapMatchChoice[];
  gaps: GapTarget[];
  correctGapPairs: GapMatchPair[];
  sharedVocabulary?: QtiInteractionVocabulary;
};

export type BuildOptions = {
  identifier?: string;
  lang: ItemLanguage;
  scoring?: 'match_correct' | 'map_response';
};

export function createGapMarkerHtml(
  opts: { id: string; label?: string; widthClass?: string },
): string {
  const widthClass = normalizeInputWidthClass(opts.widthClass);
  return createMarkerHtml({
    attr: GAP_MARKER_ATTR,
    id: opts.id,
    label: opts.label ?? opts.id,
    className: ['qti-gap-marker', 'ds-badge', 'ds-badge-ghost', widthClass].filter(Boolean).join(
      ' ',
    ),
    contentEditable: false,
  });
}

export function listGapIds(html: string): string[] {
  return listMarkerIds(html, GAP_MARKER_ATTR);
}

export function defaultsGapMatch(): GapMatchDraft {
  const responseIdentifier = 'RESPONSE';
  const gaps: GapTarget[] = [
    { id: 'GAP_1', label: 'Gap 1' },
    { id: 'GAP_2', label: 'Gap 2' },
  ];
  const marker1 = createGapMarkerHtml({ id: gaps[0].id, label: gaps[0].label });
  const marker2 = createGapMarkerHtml({ id: gaps[1].id, label: gaps[1].label });
  const gapChoices: GapMatchChoice[] = [
    { id: 'A', kind: 'text', text: 'Choice A', matchMax: 1 },
    { id: 'B', kind: 'text', text: 'Choice B', matchMax: 1 },
    { id: 'C', kind: 'text', text: 'Choice C', matchMax: 1 },
  ];
  const correctGapPairs: GapMatchPair[] = [
    { choiceId: 'A', gapId: 'GAP_1' },
    { choiceId: 'B', gapId: 'GAP_2' },
  ];
  return {
    title: 'Gap Match',
    promptHtml: '<p>Drag each choice into the correct blank.</p>',
    bodyHtml: `<p>Complete the sentence: ${marker1} and ${marker2}.</p>`,
    responseIdentifier,
    shuffle: true,
    minAssociations: undefined,
    maxAssociations: undefined,
    gapChoices,
    gaps,
    correctGapPairs,
  };
}

export function validateGapMatch(d: GapMatchDraft): string[] {
  const errs: string[] = [];
  if (!d.title?.trim()) errs.push('Title is required.');

  const bodyText = (d.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');

  const rid = (d.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(rid)) errs.push('Response identifier must be a valid QTI identifier.');

  const gaps = Array.isArray(d.gaps) ? d.gaps : [];
  if (!gaps.length) errs.push('Add at least one gap.');
  const gapIds = gaps.map((g) => (g.id ?? '').trim()).filter(Boolean);
  const gapDupes = findDuplicateStrings(gapIds);
  if (gapDupes.length) errs.push(`Gap identifiers must be unique: ${gapDupes.join(', ')}.`);
  for (const gap of gaps) {
    const id = (gap.id ?? '').trim();
    if (!id) {
      errs.push('Each gap must have an identifier.');
      continue;
    }
    if (!isValidQtiIdentifier(id)) {
      errs.push(`Gap identifier "${id}" is not a valid QTI identifier.`);
    }
    if (!gap.label?.trim()) errs.push(`Gap "${id}" must have a label.`);
  }

  const markerIds = listGapIds(d.bodyHtml ?? '');
  if (!markerIds.length) errs.push('Insert at least one gap into the body.');
  const markerDupes = findDuplicateStrings(markerIds.map((id) => id.trim()).filter(Boolean));
  if (markerDupes.length) {
    errs.push(`Body contains duplicate gap markers: ${markerDupes.join(', ')}.`);
  }
  const markerSet = new Set(markerIds.map((id) => id.trim()));
  const missingFromBody = gapIds.filter((id) => !markerSet.has(id));
  if (missingFromBody.length) {
    errs.push(`These gaps are not placed in the body: ${missingFromBody.join(', ')}.`);
  }
  const gapSet = new Set(gapIds.map((id) => id.trim()));
  const unknownMarkers = markerIds.filter((id) => !gapSet.has(id.trim()));
  if (unknownMarkers.length) {
    errs.push(
      `Body contains gaps that are not defined in the draft: ${unknownMarkers.join(', ')}.`,
    );
  }

  const choices = Array.isArray(d.gapChoices) ? d.gapChoices : [];
  if (!choices.length) errs.push('Add at least one gap choice.');
  const choiceIds = choices.map((c) => (c.id ?? '').trim()).filter(Boolean);
  const choiceDupes = findDuplicateStrings(choiceIds);
  if (choiceDupes.length) {
    errs.push(`Gap choice identifiers must be unique: ${choiceDupes.join(', ')}.`);
  }
  const crossPoolDupes = Array.from(new Set(choiceIds.filter((id) => gapSet.has(id))));
  if (crossPoolDupes.length) {
    errs.push(`Gap choice and target identifiers must not overlap: ${crossPoolDupes.join(', ')}.`);
  }
  for (const choice of choices) {
    const id = (choice.id ?? '').trim();
    if (!id) {
      errs.push('Each gap choice must have an identifier.');
      continue;
    }
    if (!isValidQtiIdentifier(id)) {
      errs.push(`Gap choice identifier "${id}" is not a valid QTI identifier.`);
    }
    if (choice.kind === 'image') {
      if (!(choice.imgSrc ?? '').trim()) {
        errs.push(`Gap choice "${id}" image choices must set imgSrc.`);
      }
      if (!(choice.imgAlt ?? '').trim()) {
        errs.push(`Gap choice "${id}" image choices must set imgAlt.`);
      }
    } else {
      const hasContent = (choice.text ?? '').trim() || (choice.html ?? '').trim();
      if (!hasContent) errs.push(`Gap choice "${id}" must have text or HTML.`);
    }
    if (typeof choice.matchMax === 'number' && choice.matchMax < 0) {
      errs.push(`Gap choice "${id}" matchMax must be 0 or greater.`);
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

  const pairs = Array.isArray(d.correctGapPairs) ? d.correctGapPairs : [];
  const pairKeys = pairs.map((p) => `${p.choiceId}→${p.gapId}`);
  const pairDupes = findDuplicateStrings(pairKeys);
  if (pairDupes.length) errs.push(`Correct pairs must be unique: ${pairDupes.join(', ')}.`);
  const choiceSet = new Set(choiceIds);
  for (const pair of pairs) {
    const choiceId = (pair.choiceId ?? '').trim();
    const gapId = (pair.gapId ?? '').trim();
    if (!choiceId || !gapId) {
      errs.push('Each correct pair must include both a choiceId and a gapId.');
      continue;
    }
    if (!gapSet.has(gapId)) errs.push(`Correct pair references unknown gap "${gapId}".`);
    if (!choiceSet.has(choiceId)) {
      errs.push(`Correct pair references unknown choice "${choiceId}".`);
    }
  }
  const matchMaxByChoiceId = new Map(
    choices.map((choice) => [(choice.id ?? '').trim(), choice.matchMax ?? 1]),
  );
  const usageByChoiceId = new Map<string, number>();
  for (const pair of pairs) {
    const choiceId = (pair.choiceId ?? '').trim();
    if (!choiceId) continue;
    usageByChoiceId.set(choiceId, (usageByChoiceId.get(choiceId) ?? 0) + 1);
  }
  for (const [choiceId, usage] of usageByChoiceId) {
    const matchMax = matchMaxByChoiceId.get(choiceId) ?? 1;
    if (matchMax > 0 && usage > matchMax) {
      errs.push(`Gap choice "${choiceId}" is used ${usage} times but matchMax allows ${matchMax}.`);
    }
  }

  return errs;
}

export function toQti3GapMatchAuthoringItem(
  draft: GapMatchDraft,
  opts: BuildOptions,
): Qti3GapMatchAuthoringItem {
  const bodyClean = sanitizeBodyHtml(draft.bodyHtml ?? '');
  const gapById = new Map((draft.gaps ?? []).map((gap) => [gap.id, gap]));
  const { html: bodyWithGaps } = replaceAllMarkers(bodyClean, GAP_MARKER_ATTR, ({ id }) => {
    const gap = gapById.get(id);
    const widthClass = normalizeInputWidthClass(gap?.widthClass);
    const classAttr = widthClass ? ` class="${xmlEscape(widthClass)}"` : '';
    return `<qti-gap identifier="${xmlEscape(id)}"${classAttr}/>`;
  });
  const bodyContent = (bodyWithGaps.trim() || '<p></p>')
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return {
    interactionType: 'gapMatch',
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    bodyHtml: trustedQti3Fragment(`<div>\n${bodyContent}\n</div>`),
    choices: (draft.gapChoices ?? []).map(toQti3GapChoice),
    targets: (draft.gaps ?? []).map((gap) => ({ identifier: gap.id })),
    correctResponse: uniqueTrimmedStrings(
      (draft.correctGapPairs ?? []).map((pair) =>
        `${(pair.choiceId ?? '').trim()} ${(pair.gapId ?? '').trim()}`
      ),
    ).map((value) => {
      const [sourceIdentifier = '', targetIdentifier = ''] = value.split(' ');
      return { sourceIdentifier, targetIdentifier };
    }),
    scoring: opts.scoring ?? 'map_response',
    shuffle: Boolean(draft.shuffle),
    minAssociations: draft.minAssociations,
    maxAssociations: draft.maxAssociations,
    minAssociationsMessage: draft.minAssociationsMessage,
    maxAssociationsMessage: draft.maxAssociationsMessage,
    sharedVocabulary: draft.sharedVocabulary
      ? qtiStateFromInteractionVocabulary(draft.sharedVocabulary)
      : undefined,
  };
}

function toQti3GapChoice(choice: GapMatchChoice): Qti3GapMatchAuthoringItem['choices'][number] {
  if (choice.kind === 'image') {
    return {
      identifier: choice.id,
      kind: 'image',
      object: {
        data: (choice.imgSrc ?? '').trim(),
        alt: (choice.imgAlt ?? '').trim(),
      },
      matchMax: choice.matchMax,
    };
  }
  return {
    identifier: choice.id,
    kind: 'text',
    text: choice.text,
    contentHtml: choice.html && choice.html.trim() !== ''
      ? trustedQti3Fragment(sanitizeInlineHtml(choice.html))
      : undefined,
    matchMax: choice.matchMax,
  };
}

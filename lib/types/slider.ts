import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import {
  type Qti3SliderAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
} from './qti3_writer_adapter.ts';

export type SliderOrientation = 'horizontal' | 'vertical';

export type SliderMappingEntry = {
  mapKey: number;
  mappedValue: number;
};

export type SliderDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  responseIdentifier?: string;
  sliderLowerBound?: number;
  sliderUpperBound?: number;
  sliderStep?: number;
  sliderStepLabel?: boolean;
  sliderOrientation?: SliderOrientation;
  sliderReverse?: boolean;
  sliderCorrectValue?: number;
  sliderMappings?: SliderMappingEntry[];
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

const ORIENTATIONS: SliderOrientation[] = ['horizontal', 'vertical'];

export function defaultsSlider(): SliderDraft {
  return {
    title: 'Slider',
    promptHtml: '<p>Select a value on the slider.</p>',
    bodyHtml: '<p>Drag the handle to the best answer.</p>',
    responseIdentifier: 'RESPONSE',
    sliderLowerBound: 0,
    sliderUpperBound: 100,
    sliderStep: 1,
    sliderStepLabel: false,
    sliderOrientation: 'horizontal',
    sliderReverse: false,
    sliderCorrectValue: 50,
    sliderMappings: [{ mapKey: 50, mappedValue: 1 }],
  };
}

export function validateSlider(draft: SliderDraft): string[] {
  const errs: string[] = [];
  if (!draft.title?.trim()) errs.push('Title is required.');

  const responseId = (draft.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }

  const lower = draft.sliderLowerBound;
  const upper = draft.sliderUpperBound;
  if (lower == null || !Number.isFinite(lower)) errs.push('Lower bound is required.');
  if (upper == null || !Number.isFinite(upper)) errs.push('Upper bound is required.');
  if (
    lower != null && upper != null && Number.isFinite(lower) && Number.isFinite(upper) &&
    lower >= upper
  ) {
    errs.push('Lower bound must be less than the upper bound.');
  }

  const step = draft.sliderStep;
  if (step != null && (!Number.isFinite(step) || step <= 0)) {
    errs.push('Step must be a positive number.');
  }

  if (draft.sliderOrientation && !ORIENTATIONS.includes(draft.sliderOrientation)) {
    errs.push('Orientation must be horizontal or vertical.');
  }

  const correct = draft.sliderCorrectValue;
  if (correct == null || !Number.isFinite(correct)) {
    errs.push('Correct value is required.');
  }
  if (correct != null && Number.isFinite(correct)) {
    if (lower != null && Number.isFinite(lower) && correct < lower) {
      errs.push('Correct value must be within the bounds.');
    }
    if (upper != null && Number.isFinite(upper) && correct > upper) {
      errs.push('Correct value must be within the bounds.');
    }
  }

  const mappings = normalizeMappings(draft.sliderMappings);
  for (const entry of mappings) {
    if (!Number.isFinite(entry.mapKey)) errs.push('Mapping entries must include map keys.');
    if (!Number.isFinite(entry.mappedValue)) {
      errs.push('Mapping entries must include mapped values.');
    }
  }

  return errs;
}

export function toQti3SliderAuthoringItem(
  draft: SliderDraft,
  opts: BuildOptions,
): Qti3SliderAuthoringItem {
  const lower = draft.sliderLowerBound;
  const upper = draft.sliderUpperBound;
  const correct = draft.sliderCorrectValue;
  const mappings = normalizeMappings(draft.sliderMappings);
  return {
    interactionType: 'slider',
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    lowerBound: typeof lower === 'number' ? lower : Number.NaN,
    upperBound: typeof upper === 'number' ? upper : Number.NaN,
    step: draft.sliderStep,
    stepLabel: draft.sliderStepLabel,
    orientation: draft.sliderOrientation,
    reverse: draft.sliderReverse,
    correctResponse: typeof correct === 'number' ? correct : Number.NaN,
    mappings,
    scoring: mappings.length ? 'map_response' : 'match_correct',
  };
}

function normalizeMappings(entries?: SliderMappingEntry[]): SliderMappingEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({
      mapKey: Number(entry.mapKey),
      mappedValue: Number(entry.mappedValue),
    }))
    .filter((entry) => Number.isFinite(entry.mapKey) && Number.isFinite(entry.mappedValue));
}

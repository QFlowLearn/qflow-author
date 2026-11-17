import { sanitizeBodyHtml } from '../sanitize.ts';
import type { ItemLanguage } from './item_language.ts';
import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import { normalizeExtendedTextHeightClass } from '../shared_vocabulary.ts';
import {
  type Qti3ExtendedTextAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
  trustedQti3Fragment,
} from './qti3_writer_adapter.ts';

export type ExtendedTextDraft = {
  title: string;
  externalScored?: 'human';
  promptHtml?: string;
  bodyHtml?: string;
  responseIdentifier?: string;
  base?: number;
  stringIdentifier?: string;
  expectedLength?: number;
  expectedLines?: number;
  minStrings?: number;
  maxStrings?: number;
  placeholderText?: string;
  format?: 'plain' | 'preformatted' | 'xhtml';
  responseBaseType?: 'string' | 'integer' | 'float';
  responseCardinality?: 'single' | 'multiple' | 'ordered';
  patternMask?: string;
  patternMessage?: string;
  heightClass?: string;
  counterType?: 'none' | 'up' | 'down';
  rubricHtml?: string;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

const COUNTER_CLASS: Record<'up' | 'down', string> = {
  up: 'qti-counter-up',
  down: 'qti-counter-down',
};

const FORMAT_VALUES = new Set(['plain', 'preformatted', 'xhtml']);

export function defaultsExtendedText(): ExtendedTextDraft {
  return {
    title: 'New Extended Response',
    promptHtml: '<p>Explain your thinking.</p>',
    bodyHtml: '<p>Provide stimulus or context here.</p>',
    responseIdentifier: 'RESPONSE',
    base: 10,
    stringIdentifier: undefined,
    expectedLength: 200,
    expectedLines: 6,
    minStrings: 1,
    maxStrings: 1,
    placeholderText: 'Write your answer...',
    format: 'plain',
    responseBaseType: 'string',
    responseCardinality: 'single',
    patternMask: '',
    patternMessage: '',
    heightClass: 'qti-height-lines-6',
    counterType: 'none',
    rubricHtml: '',
  };
}

export function validateExtendedText(draft: ExtendedTextDraft): string[] {
  const errs: string[] = [];
  if (draft.externalScored !== undefined && draft.externalScored !== 'human') {
    errs.push('Extended text external scoring must be human.');
  }
  if (!draft.title?.trim()) errs.push('Title is required.');
  const bodyText = (draft.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');

  const responseId = draft.responseIdentifier ?? 'RESPONSE';
  if (!isValidQtiIdentifier(responseId)) {
    errs.push(
      'Response identifier must begin with a letter/underscore and contain only letters, numbers, dash, underscore, or period.',
    );
  }
  if (draft.stringIdentifier && !isValidQtiIdentifier(draft.stringIdentifier)) {
    errs.push('String identifier must follow QTI identifier rules.');
  }
  if (draft.base != null && (!Number.isFinite(draft.base) || Math.trunc(draft.base) < 0)) {
    errs.push('Base must be a non-negative integer.');
  }

  if (!validatePositiveInt(draft.expectedLength, 1, 10000)) {
    errs.push('Expected length must be between 1 and 10,000 characters.');
  }
  if (!validatePositiveInt(draft.expectedLines, 1, 200)) {
    errs.push('Expected lines must be between 1 and 200.');
  }
  if (!validatePositiveInt(draft.minStrings, 0, 20)) {
    errs.push('Minimum strings must be zero or a positive whole number no greater than 20.');
  }
  if (!validatePositiveInt(draft.maxStrings, 1, 50)) {
    errs.push('Maximum strings must be a positive whole number no greater than 50.');
  }
  if (
    typeof draft.minStrings === 'number' &&
    typeof draft.maxStrings === 'number' &&
    draft.maxStrings < draft.minStrings
  ) {
    errs.push('Maximum strings must be greater than or equal to minimum strings.');
  }

  if (draft.format && !FORMAT_VALUES.has(draft.format)) {
    errs.push('Format must be plain, preformatted, or xhtml.');
  }
  if (draft.responseBaseType && !['string', 'integer', 'float'].includes(draft.responseBaseType)) {
    errs.push('Response base-type must be string, integer, or float.');
  }
  if (
    draft.responseCardinality &&
    !['single', 'multiple', 'ordered'].includes(draft.responseCardinality)
  ) {
    errs.push('Response cardinality must be single, multiple, or ordered.');
  }

  if (draft.patternMask) {
    try {
      new RegExp(draft.patternMask);
    } catch (_err) {
      errs.push('Pattern mask must be a valid regular expression.');
    }
  }
  if (draft.heightClass && !normalizeExtendedTextHeightClass(draft.heightClass)) {
    errs.push(
      'Textarea height must be qti-height-lines-3, qti-height-lines-6, or qti-height-lines-15.',
    );
  }
  if (draft.counterType && draft.counterType !== 'none' && !draft.expectedLength) {
    errs.push('Counters require expected length.');
  }

  return errs;
}

export function toQti3ExtendedTextAuthoringItem(
  draft: ExtendedTextDraft,
  opts: BuildOptions,
): Qti3ExtendedTextAuthoringItem {
  const rubricHtml = sanitizeBodyHtml(draft.rubricHtml ?? '');
  return {
    interactionType: 'extendedText',
    externalScored: draft.externalScored,
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    rubricHtml: rubricHtml ? trustedQti3Fragment(rubricHtml) : undefined,
    responseBaseType: draft.responseBaseType,
    responseCardinality: draft.responseCardinality,
    base: normalizeNumberAttr(draft.base, 0),
    stringIdentifier: draft.stringIdentifier,
    expectedLength: normalizeNumberAttr(draft.expectedLength, 1),
    expectedLines: normalizeNumberAttr(draft.expectedLines, 1),
    minStrings: normalizeNumberAttr(draft.minStrings, 0),
    maxStrings: normalizeNumberAttr(draft.maxStrings, 1),
    placeholderText: draft.placeholderText,
    format: draft.format,
    patternMask: draft.patternMask,
    patternMessage: draft.patternMessage,
    classNames: buildClassList(draft.heightClass, draft.counterType),
  };
}

function validatePositiveInt(value: number | undefined, min: number, max?: number): boolean {
  if (value == null) return true;
  if (!Number.isFinite(value)) return false;
  const intVal = Math.trunc(value);
  if (intVal !== value) return false;
  if (intVal < min) return false;
  if (typeof max === 'number' && intVal > max) return false;
  return true;
}

function normalizeNumberAttr(value: number | undefined, min: number): number | undefined {
  if (value == null) return undefined;
  if (!Number.isFinite(value)) return undefined;
  const intVal = Math.trunc(value);
  if (intVal < min) return undefined;
  return intVal;
}

function buildClassList(heightClass?: string, counterType?: 'none' | 'up' | 'down'): string[] {
  const classes: string[] = [];
  const sanitizedHeight = normalizeExtendedTextHeightClass(heightClass);
  if (sanitizedHeight) classes.push(sanitizedHeight);
  if (counterType && counterType !== 'none' && COUNTER_CLASS[counterType]) {
    classes.push(COUNTER_CLASS[counterType]);
  }
  return Array.from(new Set(classes));
}

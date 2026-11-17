import { parseAnswerFeedbackDraft } from './answer_feedback.ts';
import type { Draft } from './types/draft.ts';
import { projectJsonPersistenceObject } from './canonical_json.ts';
import { normalizeDraftForDriver } from './types/draft_utils.ts';
import { parseItemLanguage } from './types/item_language.ts';
import { MEDIA_KINDS } from './types/media.ts';
import {
  isQuestionTypeId,
  QUESTION_TYPE_IDS,
  type QuestionTypeId,
  TYPE_DRIVERS,
} from './types/registry.ts';

/** Parsed draft reconstructed from a persistence boundary without authoring defaults. */
export type PersistedDraft = Draft & {
  readonly type: QuestionTypeId;
  readonly title: string;
};

type DraftFieldKind =
  | 'boolean'
  | 'number'
  | 'object'
  | 'object_array'
  | 'string'
  | 'string_array';

const DRAFT_FIELD_KINDS = {
  itemLanguage: 'string',
  itemId: 'string',
  type: 'string',
  title: 'string',
  promptHtml: 'string',
  bodyHtml: 'string',
  answerFeedback: 'object',
  choices: 'object_array',
  sharedVocabulary: 'object',
  correctId: 'string',
  correctIds: 'string_array',
  maximumScore: 'number',
  externalScored: 'string',
  textEntries: 'object_array',
  responseIdentifier: 'string',
  stringIdentifier: 'string',
  customBaseType: 'string',
  customCardinality: 'string',
  customClassName: 'string',
  customDefinition: 'string',
  customAttributes: 'object_array',
  customInteractionMarkup: 'string',
  customResponseProcessingXml: 'string',
  endAttemptTitle: 'string',
  endAttemptCountAttempt: 'boolean',
  drawingImageSrc: 'string',
  drawingImageAlt: 'string',
  drawingImageLongDesc: 'string',
  drawingImageType: 'string',
  drawingImageWidth: 'number',
  drawingImageHeight: 'number',
  drawingClassName: 'string',
  base: 'number',
  expectedLength: 'number',
  expectedLines: 'number',
  minStrings: 'number',
  maxStrings: 'number',
  placeholderText: 'string',
  format: 'string',
  responseBaseType: 'string',
  responseCardinality: 'string',
  patternMask: 'string',
  patternMessage: 'string',
  heightClass: 'string',
  counterType: 'string',
  rubricHtml: 'string',
  correctOrder: 'string_array',
  sources: 'object_array',
  targets: 'object_array',
  correctPairs: 'object_array',
  maxAssociations: 'number',
  inlineChoices: 'object_array',
  hottexts: 'object_array',
  gapChoices: 'object_array',
  gaps: 'object_array',
  correctGapPairs: 'object_array',
  graphicBackgroundSrc: 'string',
  graphicBackgroundAlt: 'string',
  graphicBackgroundLongDesc: 'string',
  graphicBackgroundType: 'string',
  graphicAssociateBackgroundSrc: 'string',
  graphicAssociateBackgroundAlt: 'string',
  graphicAssociateBackgroundLongDesc: 'string',
  graphicAssociateBackgroundType: 'string',
  graphicAssociateBackgroundWidth: 'number',
  graphicAssociateBackgroundHeight: 'number',
  graphicAssociateHotspots: 'object_array',
  graphicAssociateCorrectPairs: 'object_array',
  graphicOrderBackgroundSrc: 'string',
  graphicOrderBackgroundAlt: 'string',
  graphicOrderBackgroundLongDesc: 'string',
  graphicOrderBackgroundType: 'string',
  graphicOrderBackgroundWidth: 'number',
  graphicOrderBackgroundHeight: 'number',
  graphicOrderHotspots: 'object_array',
  graphicOrderCorrectOrder: 'string_array',
  mediaKind: 'string',
  mediaSources: 'object_array',
  mediaInteractionLabel: 'string',
  mediaObjectLabel: 'string',
  mediaCaptionSrc: 'string',
  mediaCaptionLang: 'string',
  mediaTranscript: 'string',
  mediaAutostart: 'boolean',
  mediaLoop: 'boolean',
  mediaMinPlays: 'number',
  mediaMaxPlays: 'number',
  mediaCoords: 'string',
  mediaWidth: 'number',
  mediaHeight: 'number',
  portableCustomTypeIdentifier: 'string',
  portableModule: 'string',
  portableClassName: 'string',
  portableLabel: 'string',
  portableBaseType: 'string',
  portableCardinality: 'string',
  portableInteractionMarkup: 'string',
  portableDataAttributes: 'object_array',
  portableInteractionModules: 'object_array',
  portableModulesPrimaryConfiguration: 'string',
  portableModulesSecondaryConfiguration: 'string',
  portableResponseProcessingXml: 'string',
  positionStageSrc: 'string',
  positionStageAlt: 'string',
  positionStageLongDesc: 'string',
  positionStageType: 'string',
  positionStageWidth: 'number',
  positionStageHeight: 'number',
  positionObjectSrc: 'string',
  positionObjectAlt: 'string',
  positionObjectType: 'string',
  positionObjectWidth: 'number',
  positionObjectHeight: 'number',
  positionCenterPoint: 'string',
  positionTargets: 'object_array',
  positionCorrectPoints: 'string_array',
  selectPointImageSrc: 'string',
  selectPointImageAlt: 'string',
  selectPointImageLongDesc: 'string',
  selectPointImageType: 'string',
  selectPointImageWidth: 'number',
  selectPointImageHeight: 'number',
  selectPointTargets: 'object_array',
  selectPointCorrectPoints: 'string_array',
  sliderLowerBound: 'number',
  sliderUpperBound: 'number',
  sliderStep: 'number',
  sliderStepLabel: 'boolean',
  sliderOrientation: 'string',
  sliderReverse: 'boolean',
  sliderCorrectValue: 'number',
  sliderMappings: 'object_array',
  uploadMaxFileSize: 'number',
  uploadFileTypes: 'string',
  uploadMultiple: 'boolean',
  uploadClassName: 'string',
  hotspotImageSrc: 'string',
  hotspotImageAlt: 'string',
  hotspotImageType: 'string',
  hotspotImageLongDesc: 'string',
  minAssociations: 'number',
  minAssociationsMessage: 'string',
  maxAssociationsMessage: 'string',
  requirePattern: 'boolean',
  shuffle: 'boolean',
  minChoices: 'number',
  maxChoices: 'number',
  minChoicesMessage: 'string',
  maxChoicesMessage: 'string',
  required: 'boolean',
  answerMasking: 'boolean',
  responseMode: 'string',
  note: 'string',
  tags: 'string_array',
  standards: 'object_array',
  standardAlignments: 'object_array',
  importWarnings: 'object_array',
  preserveSourceXml: 'boolean',
  catalogs: 'object_array',
  stylesheets: 'object_array',
} as const satisfies Record<keyof Draft, DraftFieldKind>;

const REQUIRED_DRAFT_FIELDS = {
  single_select: ['title', 'choices', 'correctId'],
  multi_select: ['title', 'choices', 'correctIds'],
  text_entry: ['title', 'textEntries'],
  order: ['title', 'choices'],
  match: ['title', 'sources', 'targets', 'correctPairs'],
  associate: ['title', 'choices', 'correctPairs'],
  inline_choice: ['title', 'inlineChoices'],
  extended_text: ['title'],
  gap_match: ['title', 'gapChoices', 'gaps', 'correctGapPairs'],
  graphic_gap_match: ['title', 'choices', 'targets', 'correctPairs'],
  graphic_associate: [
    'title',
    'graphicAssociateHotspots',
    'graphicAssociateCorrectPairs',
  ],
  graphic_order: ['title', 'graphicOrderHotspots'],
  media: ['title'],
  portable_custom: ['title', 'responseIdentifier'],
  position_object: ['title'],
  select_point: ['title'],
  slider: ['title'],
  upload: ['title'],
  hotspot: ['title', 'choices'],
  hottext: ['title', 'hottexts'],
  custom_interaction: ['title', 'responseIdentifier'],
  drawing: ['title'],
  end_attempt: ['title'],
} as const satisfies Record<QuestionTypeId, readonly (keyof Draft)[]>;

const STRING_ENUMS: Partial<Record<keyof Draft, readonly string[]>> = {
  externalScored: ['human'],
  customCardinality: ['single', 'multiple', 'ordered', 'record'],
  format: ['plain', 'preformatted', 'xhtml'],
  responseBaseType: ['string', 'integer', 'float'],
  responseCardinality: ['single', 'multiple', 'ordered'],
  counterType: ['none', 'up', 'down'],
  mediaKind: MEDIA_KINDS,
  portableCardinality: ['single', 'multiple', 'ordered', 'record'],
  sliderOrientation: ['horizontal', 'vertical'],
  responseMode: ['all_or_nothing', 'partial', 'custom'],
};

/** Parse one persisted draft without adding authoring defaults or compatibility aliases. */
export function parsePersistedDraft(
  value: unknown,
  expectedType: QuestionTypeId,
): PersistedDraft {
  const record = parseRecord(value, 'Persisted draft must be an object.');
  if (record.type !== expectedType) {
    throw new Error('Conversion item draft type does not match its item type.');
  }
  const allowedKeys = new Set(Object.keys(DRAFT_FIELD_KINDS));
  const unknownKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) {
    throw new Error(`Conversion item draft has unknown fields: ${unknownKeys.join(', ')}.`);
  }
  for (const field of REQUIRED_DRAFT_FIELDS[expectedType]) {
    if (!(field in record)) {
      throw new Error(
        `Persisted ${expectedType} draft is missing required field "${String(field)}".`,
      );
    }
  }
  if (!Object.hasOwn(record, 'itemLanguage')) {
    throw new Error('Persisted draft is missing required field "itemLanguage".');
  }
  for (const [field, fieldValue] of Object.entries(record)) {
    // SAFETY: the unknown-key check above established every record key as a Draft field.
    parseDraftField(field as keyof Draft, fieldValue);
  }
  parseItemLanguage(record.itemLanguage);
  if (
    record.externalScored !== undefined && expectedType !== 'extended_text' &&
    expectedType !== 'upload'
  ) {
    throw new Error('Human scoring is supported only for extended text and upload drafts.');
  }
  if (record.answerFeedback !== undefined) {
    const feedback = parseAnswerFeedbackDraft(record.answerFeedback);
    if (
      !feedback.ok || !['single_select', 'multi_select', 'inline_choice'].includes(expectedType)
    ) throw new Error('Persisted answer feedback is invalid or unsupported.');
    record.answerFeedback = feedback.value;
  }
  if (record.maximumScore !== undefined && !TYPE_DRIVERS[expectedType].capabilities?.points) {
    throw new Error(`Persisted ${expectedType} draft does not support explicit points.`);
  }

  // SAFETY: field parsing and the required-field table established the Draft structure
  // needed for driver validation without adding defaults.
  const parsed = record as Draft;
  try {
    // The validation result is review policy, but a thrown validator proves structural corruption.
    TYPE_DRIVERS[expectedType].validate(parsed);
  } catch (_cause: unknown) {
    throw new Error(`Persisted ${expectedType} draft structure is invalid.`);
  }

  // SAFETY: exact keys, field categories, required fields, type identity, and driver access
  // were checked above. Semantic validation warnings remain reviewable domain data.
  return parsed as PersistedDraft;
}

/** Parse and normalize one semantically valid persisted question draft. */
export function parseValidPersistedDraft(value: unknown): PersistedDraft {
  const record = parseRecord(value, 'Persisted question draft must be an object.');
  const type = record.type;
  if (!isQuestionTypeId(type)) throw new Error('Persisted question draft type is invalid.');
  const draft = parsePersistedDraft(record, type);
  const normalized = projectJsonPersistenceObject(normalizeDraftForDriver(type, draft));
  // SAFETY: parsePersistedDraft established the exact allowed persistence fields,
  // the registered driver hydrator preserves the parsed type and required title,
  // and the persistence projection removes only optional undefined properties.
  const normalizedDraft = normalized as PersistedDraft;
  const errors = TYPE_DRIVERS[type].validate(normalizedDraft);
  if (errors.length) {
    throw new Error(`Persisted ${type} draft is invalid: ${errors.join(' ')}`);
  }
  return normalizedDraft;
}

function parseDraftField(field: keyof Draft, value: unknown): void {
  const kind = DRAFT_FIELD_KINDS[field];
  if (kind === 'string') {
    if (typeof value !== 'string') invalidField(field, kind);
    const allowedValues = STRING_ENUMS[field];
    if (allowedValues && !allowedValues.includes(value)) {
      throw new Error(`Persisted draft field "${String(field)}" has an invalid value.`);
    }
    return;
  }
  if (kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) invalidField(field, kind);
    if (field === 'maximumScore' && value < 0) {
      throw new Error('Persisted question points must be non-negative.');
    }
    return;
  }
  if (kind === 'boolean') {
    if (typeof value !== 'boolean') invalidField(field, kind);
    return;
  }
  if (kind === 'string_array') {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      invalidField(field, kind);
    }
    return;
  }
  if (kind === 'object_array') {
    if (!Array.isArray(value)) invalidField(field, kind);
    for (const entry of value) {
      const nested = parseRecord(
        entry,
        `Persisted draft field "${String(field)}" must contain only objects.`,
      );
      parseJsonObject(nested, field);
    }
    return;
  }
  const nested = parseRecord(
    value,
    `Persisted draft field "${String(field)}" must be an object.`,
  );
  parseJsonObject(nested, field);
}

function parseJsonObject(value: Record<string, unknown>, field: keyof Draft): void {
  for (const nestedValue of Object.values(value)) {
    parseJsonValue(nestedValue, field);
  }
}

function parseJsonValue(value: unknown, field: keyof Draft): void {
  if (
    value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) return;
  if (Array.isArray(value)) {
    for (const entry of value) parseJsonValue(entry, field);
    return;
  }
  if (value && typeof value === 'object') {
    parseJsonObject(
      value as Record<string, unknown>,
      field,
    );
    return;
  }
  throw new Error(`Persisted draft field "${String(field)}" is not valid JSON.`);
}

function parseRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  // SAFETY: the runtime checks above establish a non-array object boundary.
  return value as Record<string, unknown>;
}

function invalidField(field: keyof Draft, kind: DraftFieldKind): never {
  throw new Error(`Persisted draft field "${String(field)}" must be ${kind.replace('_', ' ')}.`);
}

if (QUESTION_TYPE_IDS.length !== Object.keys(REQUIRED_DRAFT_FIELDS).length) {
  throw new Error('Persisted draft field requirements are incomplete.');
}

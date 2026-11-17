import {
  isSupportedExtendedTextHeightLinesClassName,
  isSupportedInputWidthClassName,
  isSupportedMediaPlayerControlsToken,
  parseSharedVocabularyAttributes,
  parseSharedVocabularyClasses,
  type QtiInteractionType,
  type QtiSharedVocabularyState,
  SHARED_VOCABULARY_CHOICE_WRITING_ORIENTATIONS,
  SHARED_VOCABULARY_CHOICES_POSITIONS,
  SHARED_VOCABULARY_CHOICES_STACKING,
  SHARED_VOCABULARY_LABEL_STYLES,
  SHARED_VOCABULARY_LABEL_SUFFIXES,
  SHARED_VOCABULARY_MEDIA_PLAYER_CONTROLS,
  SHARED_VOCABULARY_ORIENTATIONS,
  SHARED_VOCABULARY_SELECTION_TONES,
  sharedVocabularyFieldById,
  sharedVocabularyInteractionFields,
} from '@longsightgroup/qti3-core';
import { qti3InteractionToQflowTypes } from './qti3_support.ts';
import type { QuestionTypeId } from './types/registry.ts';

export const QTI_LABEL_STYLES = SHARED_VOCABULARY_LABEL_STYLES;
export const QTI_LABEL_SUFFIXES = SHARED_VOCABULARY_LABEL_SUFFIXES;
export const QTI_ORIENTATIONS = SHARED_VOCABULARY_ORIENTATIONS;
export const QTI_CHOICES_POSITIONS = SHARED_VOCABULARY_CHOICES_POSITIONS;
export const QTI_SELECTION_TONES = SHARED_VOCABULARY_SELECTION_TONES;
export const QTI_WRITING_ORIENTATIONS = SHARED_VOCABULARY_CHOICE_WRITING_ORIENTATIONS;
export const QTI_MEDIA_PLAYER_CONTROLS = SHARED_VOCABULARY_MEDIA_PLAYER_CONTROLS;
const QTI_CHOICE_STACKING = SHARED_VOCABULARY_CHOICES_STACKING;

export type QtiLabelStyle = typeof QTI_LABEL_STYLES[number];
export type QtiLabelSuffix = typeof QTI_LABEL_SUFFIXES[number];
export type QtiOrientation = typeof QTI_ORIENTATIONS[number];
export type QtiChoicesPosition = typeof QTI_CHOICES_POSITIONS[number];
export type QtiSelectionTone = typeof QTI_SELECTION_TONES[number];
export type QtiWritingOrientation = typeof QTI_WRITING_ORIENTATIONS[number];
export type QtiMediaPlayerControls = typeof QTI_MEDIA_PLAYER_CONTROLS[number];
export type QtiChoiceStacking = typeof QTI_CHOICE_STACKING[number];

export type QtiInteractionVocabulary = {
  labelStyle?: QtiLabelStyle;
  labelSuffix?: QtiLabelSuffix;
  orientation?: QtiOrientation;
  choicesStacking?: QtiChoiceStacking;
  choicesPosition?: QtiChoicesPosition;
  choicesContainerWidth?: number;
  selectionTone?: QtiSelectionTone;
  inputControlHidden?: boolean;
  unselectedHidden?: boolean;
  writingOrientation?: QtiWritingOrientation;
  matchTabular?: boolean;
  matchHeaderHidden?: boolean;
  matchFirstColumnHeader?: string;
  gapPlacement?: boolean;
  mediaPlayerControls?: QtiMediaPlayerControls[];
  mediaPauseDelay?: number;
  mediaPauseDuration?: number;
};

export type SharedVocabularyProperty = keyof QtiInteractionVocabulary;

export type SharedVocabularyInteractionDefinition = {
  scope: 'interaction';
  property: SharedVocabularyProperty;
  types: QuestionTypeId[];
  qtiFieldId: string;
};

const QTI_FIELD_PROPERTY_ALIASES = {
  'labels-style': 'labelStyle',
  'labels-suffix': 'labelSuffix',
  'orientation': 'orientation',
  'choices-stacking': 'choicesStacking',
  'choices-position': 'choicesPosition',
  'choices-container-width': 'choicesContainerWidth',
  'selections-tone': 'selectionTone',
  'input-control-hidden': 'inputControlHidden',
  'unselected-hidden': 'unselectedHidden',
  'writing-orientation': 'writingOrientation',
  'match-tabular': 'matchTabular',
  'header-hidden': 'matchHeaderHidden',
  'first-column-header': 'matchFirstColumnHeader',
  'gap-placement': 'gapPlacement',
  'media-player-controls': 'mediaPlayerControls',
  'media-player-pause-delay': 'mediaPauseDelay',
  'media-player-pause-duration': 'mediaPauseDuration',
} as const satisfies Record<string, SharedVocabularyProperty>;

type QtiInteractionVocabularyFieldId = keyof typeof QTI_FIELD_PROPERTY_ALIASES;

/** UI display order for interaction vocabulary controls in the right rail. */
const SHARED_VOCABULARY_INTERACTION_FIELD_ORDER = [
  'labels-style',
  'labels-suffix',
  'orientation',
  'choices-stacking',
  'choices-position',
  'choices-container-width',
  'selections-tone',
  'input-control-hidden',
  'unselected-hidden',
  'writing-orientation',
  'match-tabular',
  'header-hidden',
  'first-column-header',
  'gap-placement',
  'media-player-controls',
  'media-player-pause-delay',
  'media-player-pause-duration',
] as const satisfies readonly QtiInteractionVocabularyFieldId[];

const CORE_INTERACTION_FIELD_IDS = new Set(
  sharedVocabularyInteractionFields.map((field) => field.id),
);
for (const fieldId of Object.keys(QTI_FIELD_PROPERTY_ALIASES)) {
  if (!CORE_INTERACTION_FIELD_IDS.has(fieldId)) {
    throw new Error(`Unknown qti shared vocabulary interaction field ${fieldId}`);
  }
}
for (const fieldId of CORE_INTERACTION_FIELD_IDS) {
  if (!(fieldId in QTI_FIELD_PROPERTY_ALIASES)) {
    throw new Error(`Missing QFlow property alias for qti shared vocabulary field ${fieldId}`);
  }
}

export const SHARED_VOCABULARY_INTERACTION_DEFINITION_TABLE =
  SHARED_VOCABULARY_INTERACTION_FIELD_ORDER.map((qtiFieldId) => ({
    property: QTI_FIELD_PROPERTY_ALIASES[qtiFieldId],
    qtiFieldId,
  }));

export const SHARED_VOCABULARY_INTERACTION_DEFINITIONS: SharedVocabularyInteractionDefinition[] =
  SHARED_VOCABULARY_INTERACTION_DEFINITION_TABLE.map(
    (entry) => ({
      ...entry,
      scope: 'interaction',
      types: qflowTypesForSharedVocabularyField(entry.qtiFieldId),
    }),
  );

const QTI_FIELD_TO_PROPERTY = new Map<string, SharedVocabularyProperty>();
const PROPERTY_TO_QTI_FIELD = new Map<SharedVocabularyProperty, string>();

for (const entry of SHARED_VOCABULARY_INTERACTION_DEFINITION_TABLE) {
  QTI_FIELD_TO_PROPERTY.set(entry.qtiFieldId, entry.property);
  PROPERTY_TO_QTI_FIELD.set(entry.property, entry.qtiFieldId);
}

export function sharedVocabularyFieldAppliesToType(
  typeId: QuestionTypeId,
  entry: SharedVocabularyInteractionDefinition,
): boolean {
  return entry.types.includes(typeId);
}

function qflowTypesForSharedVocabularyField(fieldId: string): QuestionTypeId[] {
  const field = sharedVocabularyFieldById(fieldId);
  if (!field) throw new Error(`Unknown qti shared vocabulary field ${fieldId}`);
  return field.interactions.flatMap((interaction) => qti3InteractionToQflowTypes(interaction));
}

export type QtiSelectOption = { value: string; label: string };

const EMPTY_SELECT_OPTION: QtiSelectOption = { value: '', label: 'Default' };

const LABEL_STYLE_LABELS: Record<QtiLabelStyle, string> = {
  none: 'None',
  decimal: 'Decimal',
  'cjk-ideographic': 'CJK ideographic',
  'lower-alpha': 'Lower alpha',
  'upper-alpha': 'Upper alpha',
};

const LABEL_SUFFIX_LABELS: Record<QtiLabelSuffix, string> = {
  none: 'None',
  period: 'Period',
  parenthesis: 'Parenthesis',
};

export function parseVocabularyToken<T extends string>(
  value: string,
  allowed: readonly T[],
): T | undefined {
  return (allowed as readonly string[]).includes(value) ? value as T : undefined;
}

export function parseVocabularyStacking(value: string): QtiChoiceStacking | undefined {
  const stacking = Number(value);
  return (QTI_CHOICE_STACKING as readonly number[]).includes(stacking)
    ? stacking as QtiChoiceStacking
    : undefined;
}

function qtiSelectOptions<T extends string>(
  values: readonly T[],
  labelFor?: (value: T) => string,
): QtiSelectOption[] {
  return values.map((value) => ({
    value,
    label: labelFor ? labelFor(value) : value,
  }));
}

function qtiSelectOptionsWithDefault<T extends string>(
  values: readonly T[],
  labelFor?: (value: T) => string,
): QtiSelectOption[] {
  return [EMPTY_SELECT_OPTION, ...qtiSelectOptions(values, labelFor)];
}

export const LABEL_STYLE_OPTIONS = qtiSelectOptionsWithDefault(
  QTI_LABEL_STYLES,
  (value) => LABEL_STYLE_LABELS[value],
);
export const LABEL_SUFFIX_OPTIONS = qtiSelectOptionsWithDefault(
  QTI_LABEL_SUFFIXES,
  (value) => LABEL_SUFFIX_LABELS[value],
);
export const CHOICE_STACKING_OPTIONS: QtiSelectOption[] = [
  EMPTY_SELECT_OPTION,
  ...QTI_CHOICE_STACKING.map((value) => ({ value: String(value), label: String(value) })),
];
export const CHOICES_POSITION_OPTIONS = qtiSelectOptionsWithDefault(QTI_CHOICES_POSITIONS);
export const SELECTION_TONE_OPTIONS = qtiSelectOptionsWithDefault(
  QTI_SELECTION_TONES,
  (value) => value === 'light' ? 'Light' : 'Dark',
);
export const ORIENTATION_OPTIONS = qtiSelectOptionsWithDefault(QTI_ORIENTATIONS);
export const WRITING_ORIENTATION_OPTIONS = qtiSelectOptionsWithDefault(
  QTI_WRITING_ORIENTATIONS,
  (value) => (value === 'vertical-rl' ? 'Vertical RL' : 'Vertical LR'),
);

export function parseImportedInteractionVocabulary(
  className: string | undefined,
  attrs: Record<string, string | undefined>,
  interaction: QtiInteractionType,
  orientationAttribute?: string,
): QtiInteractionVocabulary {
  const vocab = parseInteractionVocabulary(className, attrs, interaction);
  const orientation = parseVocabularyToken(orientationAttribute ?? '', QTI_ORIENTATIONS);
  if (!orientation) return vocab;
  return mergeInteractionVocabulary({ orientation }, vocab) ?? { orientation };
}

export function parseMediaInteractionVocabulary(
  attrs: Record<string, string | undefined>,
): QtiInteractionVocabulary | undefined {
  return pruneInteractionVocabulary(parseInteractionVocabulary(undefined, attrs, 'media'));
}

export function parseInteractionVocabulary(
  className?: string,
  attrs: Record<string, string | undefined> = {},
  interaction?: QtiInteractionType,
): QtiInteractionVocabulary {
  const qtiState = {
    ...parseSharedVocabularyClasses(className ?? '', interaction),
    ...parseSharedVocabularyAttributes(attrs, interaction),
  };
  return interactionVocabularyFromQtiState(qtiState);
}

function normalizeTokenListFieldValue(
  fieldId: string,
  value: unknown,
): string[] | undefined {
  const field = sharedVocabularyFieldById(fieldId);
  if (!field || field.kind !== 'attribute' || field.valueType !== 'token-list') {
    return undefined;
  }
  const allowed = new Set(field.values ?? []);
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
    ? [value.trim()]
    : [];
  const tokens = raw
    .map((token) => String(token).trim())
    .filter((token) => token && allowed.has(token));
  const unique = [...new Set(tokens)];
  return unique.length ? unique : undefined;
}

/** Normalize token-list vocabulary at the qti3/XML boundary. */
export function normalizeInteractionTokenList(
  fieldId: string,
  value: unknown,
): string[] | undefined {
  return normalizeTokenListFieldValue(fieldId, value);
}

function vocabularyPropertyToQtiStateValue(
  fieldId: string,
  value: unknown,
): QtiSharedVocabularyState[string] | undefined {
  if (value === undefined || value === false) return undefined;
  const field = sharedVocabularyFieldById(fieldId);
  if (!field) return undefined;
  if (field.kind === 'class-fixed') return true;
  if (field.kind === 'attribute') {
    if (field.valueType === 'number') {
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }
    if (field.valueType === 'token-list') {
      return normalizeTokenListFieldValue(fieldId, value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : undefined;
    }
    return undefined;
  }
  return value as QtiSharedVocabularyState[string];
}

function qtiStateValueToVocabularyProperty(
  fieldId: string,
  value: unknown,
): unknown {
  if (value === undefined) return undefined;
  const field = sharedVocabularyFieldById(fieldId);
  if (!field) return undefined;
  if (field.kind === 'class-fixed') return true;
  if (field.kind === 'attribute' && field.valueType === 'number') {
    return typeof value === 'number' ? value : undefined;
  }
  if (field.kind === 'attribute' && field.valueType === 'token-list') {
    return normalizeTokenListFieldValue(fieldId, value);
  }
  return value;
}

export function qtiStateFromInteractionVocabulary(
  vocab: QtiInteractionVocabulary,
): QtiSharedVocabularyState {
  const state: QtiSharedVocabularyState = {};
  for (const [property, fieldId] of PROPERTY_TO_QTI_FIELD) {
    const value = vocabularyPropertyToQtiStateValue(fieldId, vocab[property]);
    if (value === undefined) continue;
    state[fieldId] = value;
  }
  return state;
}

function interactionVocabularyFromQtiState(
  state: QtiSharedVocabularyState,
): QtiInteractionVocabulary {
  const partial: Record<string, unknown> = {};
  for (const [fieldId, property] of QTI_FIELD_TO_PROPERTY) {
    const value = qtiStateValueToVocabularyProperty(fieldId, state[fieldId]);
    if (value === undefined) continue;
    partial[property] = value;
  }
  return pruneInteractionVocabulary(partial as Partial<QtiInteractionVocabulary>) ?? {};
}

export function normalizeInputWidthClass(value?: string): string | undefined {
  const token = (value ?? '').trim();
  return isSupportedInputWidthClassName(token) ? token : undefined;
}

export function normalizeExtendedTextHeightClass(value?: string): string | undefined {
  const token = (value ?? '').trim();
  return isSupportedExtendedTextHeightLinesClassName(token) ? token : undefined;
}

export function isSupportedMediaPlayerControls(value?: string): value is QtiMediaPlayerControls {
  return isSupportedMediaPlayerControlsToken(value ?? '');
}

export function mergeInteractionVocabulary(
  ...sources: Array<Partial<QtiInteractionVocabulary> | undefined>
): QtiInteractionVocabulary | undefined {
  const merged: QtiInteractionVocabulary = {};
  for (const source of sources) {
    if (!source) continue;
    Object.assign(merged, source);
  }
  return pruneInteractionVocabulary(merged);
}

function pruneInteractionVocabulary(
  vocab: Partial<QtiInteractionVocabulary>,
): QtiInteractionVocabulary | undefined {
  const next: QtiInteractionVocabulary = { ...vocab };
  for (const [key, value] of Object.entries(next)) {
    if (
      value === undefined ||
      value === '' ||
      value === false ||
      (Array.isArray(value) && value.length === 0)
    ) {
      delete (next as Record<string, unknown>)[key];
    }
  }
  return Object.keys(next).length ? next : undefined;
}

export function applySharedVocabularyPatch(
  current: QtiInteractionVocabulary | undefined,
  patch: Partial<QtiInteractionVocabulary>,
): QtiInteractionVocabulary | undefined {
  return pruneInteractionVocabulary({ ...(current ?? {}), ...patch });
}

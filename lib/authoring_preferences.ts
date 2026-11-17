import type { Draft } from './types/draft.ts';
import { isQuestionTypeId, type QuestionTypeId, TYPE_DRIVERS } from './types/registry.ts';
import {
  QTI_LABEL_STYLES,
  QTI_LABEL_SUFFIXES,
  QTI_ORIENTATIONS,
  type QtiLabelStyle,
  type QtiLabelSuffix,
  type QtiOrientation,
} from './shared_vocabulary.ts';

/** Only reusable authoring choices; never content, answer keys or custom scoring. */
type SettingValues = {
  maximumScore: number;
  shuffle: boolean;
  required: boolean;
  answerMasking: boolean;
  responseMode: 'all_or_nothing' | 'partial';
  labelStyle: QtiLabelStyle;
  labelSuffix: QtiLabelSuffix;
  orientation: QtiOrientation;
  expectedLength: number;
  expectedLines: number;
  format: 'plain' | 'preformatted' | 'xhtml';
  heightClass: 'qti-height-lines-3' | 'qti-height-lines-6' | 'qti-height-lines-15';
  counterType: 'none' | 'up' | 'down';
};
/** Explicit changes. Null clears a remembered override and uses the type's default. */
export type AuthoringSettingsPatch = {
  readonly [K in keyof SettingValues]?: SettingValues[K] | null;
};
/** One author's saved defaults for a question type in one assessment. */
export type AuthoringPreference = {
  readonly typeId: QuestionTypeId;
  readonly settings: AuthoringSettingsPatch;
};
type SettingKey = keyof SettingValues;
const vocabularyKeys = new Set<string>(['labelStyle', 'labelSuffix', 'orientation']);
const choiceKeys = new Set<string>(['shuffle', 'labelStyle', 'labelSuffix', 'orientation']);
const bool = (v: unknown) => typeof v === 'boolean';
const size = (max: number) => (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max;
const oneOf = (values: readonly unknown[]) => (v: unknown) => values.includes(v);
const validators = {
  maximumScore: (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0,
  shuffle: bool,
  required: bool,
  answerMasking: bool,
  responseMode: oneOf(['all_or_nothing', 'partial']),
  labelStyle: oneOf(QTI_LABEL_STYLES),
  labelSuffix: oneOf(QTI_LABEL_SUFFIXES),
  orientation: oneOf(QTI_ORIENTATIONS),
  expectedLength: size(10000),
  expectedLines: size(200),
  format: oneOf(['plain', 'preformatted', 'xhtml']),
  heightClass: oneOf(['qti-height-lines-3', 'qti-height-lines-6', 'qti-height-lines-15']),
  counterType: oneOf(['none', 'up', 'down']),
} satisfies Record<SettingKey, (v: unknown) => boolean>;
const keys = Object.keys(validators) as SettingKey[]; // SAFETY: validators has exactly the closed setting keys.
function supports(type: QuestionTypeId, key: SettingKey, value: unknown): boolean {
  const driver = TYPE_DRIVERS[type];
  switch (key) {
    case 'maximumScore':
      return type === 'single_select' || type === 'multi_select';
    case 'shuffle':
      return type === 'inline_choice' || Boolean(driver.capabilities?.shuffle);
    case 'required':
      return Boolean(driver.capabilities?.required);
    case 'answerMasking':
      return Boolean(driver.capabilities?.answerMasking);
    case 'responseMode':
      return Boolean(
        driver.scoringTemplates?.some((t) =>
          !t.disabled && (value === null || t.id === value) && t.id !== 'custom'
        ),
      );
    case 'labelStyle':
    case 'labelSuffix':
    case 'orientation':
      return type === 'single_select' || type === 'multi_select';
    default:
      return type === 'extended_text';
  }
}
/** Parse a closed, type-compatible patch at an HTTP or storage boundary. */
export function parseAuthoringSettingsPatch(
  type: QuestionTypeId,
  input: unknown,
): AuthoringSettingsPatch | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(validators, key)) return null;
    const k = key as SettingKey; // SAFETY: own-key membership in the closed validators above.
    if (!supports(type, k, value) || (value !== null && !validators[k](value))) return null;
  }
  // SAFETY: all own fields and values were checked against their type-specific contracts.
  return input as AuthoringSettingsPatch;
}
/** Parse saved rows or a server-rendered preference list. */
export function parseAuthoringPreferences(input: unknown): readonly AuthoringPreference[] | null {
  if (!Array.isArray(input) || input.length > Object.keys(TYPE_DRIVERS).length) return null;
  const seen = new Set<QuestionTypeId>();
  const result: AuthoringPreference[] = [];
  const entries: readonly unknown[] = input;
  for (const entry of entries) {
    if (
      !entry || typeof entry !== 'object' || !('typeId' in entry) || !('settings' in entry) ||
      !isQuestionTypeId(entry.typeId) ||
      seen.has(entry.typeId)
    ) return null;
    const settings = parseAuthoringSettingsPatch(entry.typeId, entry.settings);
    if (!settings) return null;
    seen.add(entry.typeId);
    result.push({ typeId: entry.typeId, settings });
  }
  return result;
}
/** Capture only setting differences caused by an explicit author interaction. */
export function changedAuthoringSettings(
  type: QuestionTypeId,
  before: Draft,
  after: Draft,
): AuthoringSettingsPatch {
  const entries: [SettingKey, unknown][] = [];
  for (const key of keys) {
    const from = settingValue(type, before, key);
    const to = settingValue(type, after, key);
    if (to === undefined || from === to || !supports(type, key, to)) continue;
    if (to !== null && !validators[key](to)) continue;
    entries.push([key, to]);
  }
  const parsed = parseAuthoringSettingsPatch(type, Object.fromEntries(entries));
  if (!parsed) throw new Error('Invalid authoring setting transition');
  return parsed;
}
function settingValue(type: QuestionTypeId, draft: Draft, key: SettingKey): unknown {
  if (type === 'inline_choice' && key === 'shuffle') {
    const slots = draft.inlineChoices;
    if (!slots?.length) return undefined;
    const shuffle = Boolean(slots[0]?.shuffle);
    // A mixed per-slot policy has no single reusable setting; keep the remembered value intact.
    return slots.every((slot) => Boolean(slot.shuffle) === shuffle) ? shuffle : undefined;
  }
  if (key === 'labelStyle' || key === 'labelSuffix' || key === 'orientation') {
    return draft.sharedVocabulary?.[key] ?? null;
  }
  if (key === 'responseMode' && draft.responseMode === 'custom') return null;
  return draft[key] ?? null;
}
/** Share only cosmetic choice preferences between single and multiple selection. */
export function authoringPreferenceUpdates(
  typeId: QuestionTypeId,
  settings: AuthoringSettingsPatch,
): readonly AuthoringPreference[] {
  const updates: AuthoringPreference[] = [{ typeId, settings }];
  if (typeId === 'single_select' || typeId === 'multi_select') {
    const shared = Object.fromEntries(
      Object.entries(settings).filter(([key]) => choiceKeys.has(key)),
    );
    const other = typeId === 'single_select' ? 'multi_select' : 'single_select';
    const parsed = parseAuthoringSettingsPatch(other, shared);
    if (parsed && Object.keys(parsed).length) updates.push({ typeId: other, settings: parsed });
  }
  return updates;
}
/** Merge committed explicit changes without replacing unrelated remembered fields. */
export function mergeAuthoringPreferences(
  current: readonly AuthoringPreference[],
  type: QuestionTypeId,
  patch: AuthoringSettingsPatch,
): readonly AuthoringPreference[] {
  const result = new Map(current.map((p) => [p.typeId, p.settings]));
  for (const update of authoringPreferenceUpdates(type, patch)) {
    result.set(update.typeId, { ...result.get(update.typeId), ...update.settings });
  }
  return [...result].map(([typeId, settings]) => ({ typeId, settings }));
}
/** Apply remembered choices once to a newly constructed blank draft. */
export function applyAuthoringPreferences<T extends Draft>(
  blank: T,
  type: QuestionTypeId,
  preferences: readonly AuthoringPreference[],
): T {
  const settings = preferences.find((p) => p.typeId === type)?.settings;
  if (!settings) return blank;
  const fields: Record<string, unknown> = {};
  const vocabulary: Record<string, unknown> = { ...blank.sharedVocabulary };
  let vocabularyChanged = false;
  for (const [key, value] of Object.entries(settings)) {
    if (value === null) continue;
    if (
      key === 'maximumScore' && (blank.maximumScore !== undefined ||
        blank.preserveSourceXml === true || blank.responseMode === 'custom' ||
        Boolean(blank.customResponseProcessingXml))
    ) continue;
    if (type === 'inline_choice' && key === 'shuffle') {
      fields.inlineChoices = blank.inlineChoices?.map((slot) => ({ ...slot, shuffle: value }));
    } else if (vocabularyKeys.has(key)) {
      vocabulary[key] = value;
      vocabularyChanged = true;
    } else fields[key] = value;
  }
  if (!Object.keys(fields).length && !vocabularyChanged) return blank;
  return { ...blank, ...fields, ...(vocabularyChanged ? { sharedVocabulary: vocabulary } : {}) };
}

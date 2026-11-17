import type { AssessmentQuestionPointDefault } from './assessment_question_defaults.ts';
import type { AuthoringPreference } from './authoring_preferences.ts';
import type { QuestionTypeId } from './types/registry.ts';
import type { InterfaceLocale } from './i18n/locale.ts';
import { parseQuestionPointsInput } from './question_points.ts';

const answerOrderTypes = ['single_select', 'multi_select', 'inline_choice'] as const;
const pointTypes = ['single_select', 'multi_select'] as const;

/** Question families with a canonical answer-choice order for new-question defaults. */
export function supportsInstructorAnswerOrder(type: QuestionTypeId): boolean {
  return answerOrderTypes.some((supported) => supported === type);
}

/** First-milestone question families with editable canonical point controls. */
export function supportsInstructorQuestionPoints(type: QuestionTypeId): boolean {
  return pointTypes.some((supported) => supported === type);
}

/** An instructor's explicit starting answer order, scoped to one workspace. */
export type AnswerChoiceOrder = 'authored' | 'shuffled';
/** Each opted-in workspace policy is explicit; null fields mean no override for that setting. */
export type InstructorDefaults = {
  readonly answerChoiceOrder: AnswerChoiceOrder | null;
  readonly maximumScore: number | null;
} | null;

/** Parse the persisted policy; absence means the instructor has not opted in. */
export function parseInstructorDefaults(value: unknown): InstructorDefaults {
  if (value === null) return null;
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== 2 || !Object.hasOwn(value, 'answerChoiceOrder') ||
    !Object.hasOwn(value, 'maximumScore')
  ) throw new Error('Stored instructor defaults are invalid.');
  const order: unknown = Reflect.get(value, 'answerChoiceOrder');
  const maximumScore: unknown = Reflect.get(value, 'maximumScore');
  if (
    (order !== null && order !== 'authored' && order !== 'shuffled') ||
    (maximumScore !== null &&
      (typeof maximumScore !== 'number' || !Number.isFinite(maximumScore) || maximumScore < 0)) ||
    (order === null && maximumScore === null)
  ) throw new Error('Stored instructor defaults are invalid.');
  return { answerChoiceOrder: order, maximumScore };
}

/** Canonical preferences saved atomically by the editor-settings route. */
export type EditorPreferences = {
  readonly choiceRichText: boolean;
  readonly instructorDefaults: InstructorDefaults;
};

/** User input retained for a recoverable point-format rejection, separate from persisted policy. */
export type EditorPreferencesFormValues = {
  readonly choiceRichText: boolean;
  readonly answerChoiceOrder: 'question-default' | AnswerChoiceOrder;
  readonly pointText: string;
};

/** Closed form outcomes; invalid numeric spelling never becomes a saved default. */
export type EditorPreferencesFormResult =
  | { readonly _tag: 'Parsed'; readonly preferences: EditorPreferences }
  | { readonly _tag: 'InvalidPoints'; readonly form: EditorPreferencesFormValues }
  | { readonly _tag: 'InvalidForm' };

/** Decode one complete localized editor form without guessing malformed or missing preferences. */
export function parseEditorPreferencesForm(
  form: FormData,
  locale: InterfaceLocale,
): EditorPreferencesFormResult {
  if (
    [...form.keys()].some((key) =>
      !['choiceRichText', 'answerChoiceOrder', 'maximumScore'].includes(key)
    )
  ) {
    return { _tag: 'InvalidForm' };
  }
  const richText = form.getAll('choiceRichText');
  const order = form.getAll('answerChoiceOrder');
  const points = form.getAll('maximumScore');
  if (richText.length > 1 || (richText.length === 1 && richText[0] !== 'on')) {
    return { _tag: 'InvalidForm' };
  }
  if (order.length !== 1 || points.length !== 1 || typeof points[0] !== 'string') {
    return { _tag: 'InvalidForm' };
  }
  const value = order[0];
  if (value !== 'question-default' && value !== 'authored' && value !== 'shuffled') {
    return { _tag: 'InvalidForm' };
  }
  const parsedPoints = parseQuestionPointsInput(points[0], locale);
  if (parsedPoints._tag === 'Invalid') {
    return {
      _tag: 'InvalidPoints',
      form: {
        choiceRichText: richText.length === 1,
        answerChoiceOrder: value,
        pointText: points[0],
      },
    };
  }
  const answerChoiceOrder = value === 'question-default' ? null : value;
  const maximumScore = parsedPoints._tag === 'Value' ? parsedPoints.value : null;
  return {
    _tag: 'Parsed',
    preferences: {
      choiceRichText: richText.length === 1,
      instructorDefaults: answerChoiceOrder === null && maximumScore === null
        ? null
        : { answerChoiceOrder, maximumScore },
    },
  };
}

/** Shared point policy wins over personal presets; explicit draft values still win during creation. */
export function resolveAuthoringPreferences(
  defaults: InstructorDefaults,
  assessment: readonly AuthoringPreference[],
  assessmentMaximumScore: AssessmentQuestionPointDefault,
): readonly AuthoringPreference[] {
  const preferences = new Map(
    assessment.map((preference) => [preference.typeId, preference.settings]),
  );
  if (defaults && defaults.answerChoiceOrder !== null) {
    for (const typeId of answerOrderTypes) {
      preferences.set(typeId, {
        shuffle: defaults.answerChoiceOrder === 'shuffled',
        ...preferences.get(typeId),
      });
    }
  }
  if (defaults && defaults.maximumScore !== null) {
    for (const typeId of pointTypes) {
      preferences.set(typeId, { maximumScore: defaults.maximumScore, ...preferences.get(typeId) });
    }
  }
  if (assessmentMaximumScore !== null) {
    for (const typeId of pointTypes) {
      preferences.set(typeId, { ...preferences.get(typeId), maximumScore: assessmentMaximumScore });
    }
  }
  return [...preferences].map(([typeId, settings]) => ({ typeId, settings }));
}

import {
  parseQuestionText,
  prepareQuestionText,
  type QuestionStructure,
} from '../../lib/authoring/question_text.ts';
import {
  applyAuthoringPreferences,
  type AuthoringPreference,
} from '../../lib/authoring_preferences.ts';
import { newAuthoringItemLanguage } from '../../lib/types/item_language.ts';
import { createRailDraft } from '../drivers/right_rail/rail_draft.ts';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { AuthoringState } from './types.ts';

/** Starts first-pass authoring for any registered authorable question type. */
export function beginCreatingQuestion(type: QuestionTypeId, partId: string): AuthoringState {
  return { _tag: 'Creating', type, partId };
}

/** The stable creation state and localized presentation for a new question. */
export function createCreatingQuestionPresentation(
  i18n: Pick<I18n, 't'>,
  type: QuestionTypeId,
  partId: string,
): {
  readonly state: AuthoringState;
  readonly typeLabel: string;
  readonly questionLabel: string;
} {
  const typeLabel = i18n.t('assessments.builder.questionTypeLabel', { type });
  return {
    state: beginCreatingQuestion(type, partId),
    typeLabel,
    questionLabel: i18n.t('assessments.builder.newQuestion', { type: typeLabel }),
  };
}

/** Prepare the one canonical question draft and settings for text-assisted creation. */
export function createTextAssistancePresentation(
  structure: QuestionStructure,
  preferences: readonly AuthoringPreference[],
  destination: { readonly partId: string; readonly beforePlacementId?: string },
) {
  const draft = applyAuthoringPreferences(
    prepareQuestionText(
      parseQuestionText(''),
      structure.type,
      structure.choiceCount,
      newAuthoringItemLanguage(),
    ).draft,
    structure.type,
    preferences,
  );
  return {
    settings: applyAuthoringPreferences(
      createRailDraft(structure.type, draft),
      structure.type,
      preferences,
    ),
    state: {
      _tag: 'Creating',
      ...destination,
      type: structure.type,
      initialDraft: draft,
      textAssistance: true,
    } satisfies AuthoringState,
  };
}

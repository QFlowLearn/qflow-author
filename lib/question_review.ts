import { type AssessmentBlueprint, findAssessmentBlueprintTarget } from './assessment_blueprint.ts';
import { type A11yIssue, collectA11yIssues } from './a11y_checks.ts';
import type { QuestionReviewSuggestion } from './question_review_types.ts';
import type { Draft } from './types/draft.ts';

/** Assessment and revision context used to review one canonical question draft. */
export type QuestionReviewContext = {
  readonly blueprint?: AssessmentBlueprint;
  readonly blueprintTargetId?: string;
  readonly aiSuggestions?: readonly QuestionReviewSuggestion[];
};

/** Collect deterministic checks plus model-authored suggestions without rewriting the draft. */
export function collectQuestionReviewSuggestions(
  draft: Draft,
  context: QuestionReviewContext = {},
): QuestionReviewSuggestion[] {
  return collectQuestionReviewSuggestionsFromAnalysis(draft, collectA11yIssues(draft), context);
}

/** Build question-review suggestions from already-completed accessibility analysis. */
export function collectQuestionReviewSuggestionsFromAnalysis(
  draft: Draft,
  a11yIssues: readonly A11yIssue[],
  context: QuestionReviewContext = {},
): QuestionReviewSuggestion[] {
  const suggestions: QuestionReviewSuggestion[] = [];
  const stem = textContent(`${draft.promptHtml ?? ''} ${draft.bodyHtml ?? ''}`);
  suggestions.push(...ambiguousStemSuggestions(stem));
  suggestions.push(...choiceSuggestions(draft, stem));
  suggestions.push(...answerKeySuggestions(draft));
  suggestions.push(...collectBlueprintAlignmentSuggestions(draft, context));
  suggestions.push(
    ...a11yIssues.map((issue) => ({
      source: 'deterministic' as const,
      code: `accessibility.${issue.code.toLocaleLowerCase()}`,
      category: 'accessibility' as const,
      message: issue.message,
    })),
  );
  suggestions.push(...(context.aiSuggestions ?? []).filter((entry) => entry.source === 'ai'));
  return dedupeSuggestions(suggestions);
}

function ambiguousStemSuggestions(stem: string): QuestionReviewSuggestion[] {
  if (!stem) return [];
  if ((stem.match(/\?/g) ?? []).length > 1) {
    return [suggestion(
      'ambiguous_stem.multiple_questions',
      'ambiguity',
      'The stem asks more than one question. Check that learners know which task to answer.',
    )];
  }
  if (stem.length < 18) {
    return [suggestion(
      'ambiguous_stem.short',
      'ambiguity',
      'The stem is very short. Check that it provides enough context for one clear interpretation.',
    )];
  }
  return [];
}

function choiceSuggestions(draft: Draft, stem: string): QuestionReviewSuggestion[] {
  const choices = draft.choices ?? [];
  if (choices.length < 2) return [];
  const normalized = choices.map((choice) =>
    (choice.html ?? choice.text ?? '').replaceAll(/\s+/g, ' ').trim()
  );
  const duplicates = normalized.filter((value, index) =>
    value && normalized.indexOf(value) !== index
  );
  const suggestions: QuestionReviewSuggestion[] = duplicates.length
    ? [suggestion(
      'duplicate_options.normalized_text',
      'duplicate_options',
      'Two or more answer options have identical content apart from spacing.',
    )]
    : [];

  const correctIds = draft.type === 'single_select'
    ? draft.correctId ? [draft.correctId] : []
    : draft.type === 'multi_select'
    ? draft.correctIds ?? []
    : [];
  const correctLengths = choices
    .filter((choice) => correctIds.includes(choice.id))
    .map((choice) => textContent(choice.html ?? choice.text ?? '').length);
  const distractorLengths = choices
    .filter((choice) => !correctIds.includes(choice.id))
    .map((choice) => textContent(choice.html ?? choice.text ?? '').length)
    .filter((length) => length > 0);
  if (correctLengths.length === 1 && distractorLengths.length >= 2) {
    const correctLength = correctLengths[0];
    const averageDistractor = distractorLengths.reduce((sum, length) => sum + length, 0) /
      distractorLengths.length;
    if (correctLength >= 20 && correctLength > averageDistractor * 2) {
      suggestions.push(suggestion(
        'clueing.correct_option_length',
        'clueing',
        'The correct option is much longer than the distractors. Check whether length reveals the key.',
      ));
    }
  }
  const correctText = choices.find((choice) => correctIds.includes(choice.id));
  const correctPhrase = normalizeOption(correctText?.html ?? correctText?.text ?? '');
  if (correctPhrase.split(' ').length >= 3 && normalizeOption(stem).includes(correctPhrase)) {
    suggestions.push(suggestion(
      'clueing.answer_repeated_in_stem',
      'clueing',
      'The stem repeats the correct option closely. Check whether it gives away the answer.',
    ));
  }
  return suggestions;
}

function answerKeySuggestions(draft: Draft): QuestionReviewSuggestion[] {
  const choiceIds = new Set((draft.choices ?? []).map((choice) => choice.id));
  if (draft.type === 'single_select') {
    if ((draft.correctIds ?? []).length > 0) {
      return [suggestion(
        'answer_key.conflicting_choice_keys',
        'answer_key',
        'This single-select question also contains a multiple-answer key. Keep one answer-key format.',
      )];
    }
    if (!draft.correctId || !choiceIds.has(draft.correctId)) {
      return [suggestion(
        'answer_key.single_select_reference',
        'answer_key',
        'The correct answer does not reference a current option.',
      )];
    }
  }
  if (draft.type === 'multi_select') {
    if (draft.correctId) {
      return [suggestion(
        'answer_key.conflicting_choice_keys',
        'answer_key',
        'This multiple-select question also contains a single-answer key. Keep one answer-key format.',
      )];
    }
    const correctIds = draft.correctIds ?? [];
    if (
      !correctIds.length || new Set(correctIds).size !== correctIds.length ||
      correctIds.some((id) => !choiceIds.has(id))
    ) {
      return [suggestion(
        'answer_key.multi_select_reference',
        'answer_key',
        'The answer key is empty, duplicated, or references an option that no longer exists.',
      )];
    }
  }
  if (
    draft.type === 'text_entry' &&
    (draft.textEntries ?? []).some((entry) =>
      !entry.answers?.some((answer) => answer.value.trim().length > 0)
    )
  ) {
    return [suggestion(
      'answer_key.text_entry_empty',
      'answer_key',
      'At least one text-entry blank has no accepted answer.',
    )];
  }
  return [];
}

/** Check one question's exact target assignment against a saved assessment blueprint. */
export function collectBlueprintAlignmentSuggestions(
  draft: Draft,
  context: Pick<QuestionReviewContext, 'blueprint' | 'blueprintTargetId'>,
): QuestionReviewSuggestion[] {
  const { blueprint, blueprintTargetId } = context;
  if (!blueprint || blueprint._tag !== 'Defined') return [];
  const target = findAssessmentBlueprintTarget(blueprint, blueprintTargetId);
  if (!target) {
    return [suggestion(
      'alignment.blueprint_target_missing',
      'alignment',
      'This question is not aligned with a current blueprint target.',
    )];
  }
  if (target.questionType !== draft.type) {
    return [suggestion(
      'alignment.question_type_mismatch',
      'alignment',
      `The blueprint target calls for ${target.questionType}, but this question is ${draft.type}.`,
    )];
  }
  return [];
}

function suggestion(
  code: string,
  category: QuestionReviewSuggestion['category'],
  message: string,
): QuestionReviewSuggestion {
  return { source: 'deterministic', code, category, message };
}

function normalizeOption(value: string): string {
  return textContent(value).toLocaleLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function textContent(value: string): string {
  return value.replaceAll(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' ').trim();
}

function dedupeSuggestions(
  suggestions: readonly QuestionReviewSuggestion[],
): QuestionReviewSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((entry) => {
    const key = `${entry.source}:${entry.code}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

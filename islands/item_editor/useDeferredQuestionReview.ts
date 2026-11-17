import { useEffect, useRef, useState } from 'preact/hooks';
import type { AssessmentBlueprint } from '../../lib/assessment_blueprint.ts';
import type { A11yIssue } from '../../lib/a11y_checks.ts';
import { collectQuestionReviewSuggestionsFromAnalysis } from '../../lib/question_review.ts';
import type { QuestionReviewSuggestion } from '../../lib/question_review_types.ts';
import type { Draft } from '../../lib/types/draft.ts';

/** Quiet period before advisory question review runs after an input change. */
const QUESTION_REVIEW_DEBOUNCE_MS = 160;

/** Inputs for advisory review that may lag behind the synchronous editor model. */
export type DeferredQuestionReviewInput = {
  readonly draft: Draft;
  readonly a11yIssues: readonly A11yIssue[];
  readonly blueprint?: AssessmentBlueprint;
  readonly blueprintTargetId?: string;
  readonly aiSuggestions?: readonly QuestionReviewSuggestion[];
  readonly enabled: boolean;
};

/** Return the latest completed advisory review while debouncing subsequent analysis. */
export function useDeferredQuestionReview({
  draft,
  a11yIssues,
  blueprint,
  blueprintTargetId,
  aiSuggestions,
  enabled,
}: DeferredQuestionReviewInput): readonly QuestionReviewSuggestion[] {
  const initialRender = useRef(true);
  const [suggestions, setSuggestions] = useState<readonly QuestionReviewSuggestion[]>(() =>
    enabled
      ? collectQuestionReviewSuggestionsFromAnalysis(draft, a11yIssues, {
        blueprint,
        blueprintTargetId,
        aiSuggestions,
      })
      : []
  );

  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    if (!enabled) return;

    const timer = globalThis.setTimeout(() => {
      setSuggestions(
        collectQuestionReviewSuggestionsFromAnalysis(draft, a11yIssues, {
          blueprint,
          blueprintTargetId,
          aiSuggestions,
        }),
      );
    }, QUESTION_REVIEW_DEBOUNCE_MS);
    return () => globalThis.clearTimeout(timer);
  }, [draft, a11yIssues, blueprint, blueprintTargetId, aiSuggestions, enabled]);

  return suggestions;
}

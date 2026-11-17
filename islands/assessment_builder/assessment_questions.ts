import {
  assessmentQuestionPlacements,
  collectAssessmentContentFindings,
} from '../../lib/assessment_content.ts';
import type { Draft } from '../../lib/types/draft.ts';
import { labelForTypeId } from '../../lib/types/registry.ts';
import { projectQuestionPreviewFromDraft } from '../../lib/question_preview.ts';
import type { ItemMeta, Part } from './types.ts';
import type { AssessmentBlueprint } from '../../lib/assessment_blueprint.ts';
import { collectQuestionReviewSuggestions } from '../../lib/question_review.ts';
import type { QuestionReviewSuggestion } from '../../lib/question_review_types.ts';

export type { QuestionPreview } from '../../lib/question_preview.ts';

/** Question diagnostics ignore unscored anchors while the canvas retains the full sequence. */
export function assessmentQuestionContentFindings(
  parts: readonly Part[],
  metadata: Readonly<Record<string, ItemMeta>>,
) {
  return collectAssessmentContentFindings(
    parts.map((part) => ({
      placements: assessmentQuestionPlacements(part.placements),
    })),
    metadata,
  );
}

export function assessmentHasQuestions(parts: readonly Part[]): boolean {
  return parts.some((part) => assessmentQuestionPlacements(part.placements).length > 0);
}

/** Project blueprint alignments only from placements that still belong to the assessment. */
export function assessmentBlueprintAlignments(
  parts: readonly Part[],
  itemMeta: Readonly<Record<string, ItemMeta>>,
): ReadonlyArray<{
  readonly blueprintTargetId: string | undefined;
  readonly questionType: ItemMeta['questionTypeId'];
}> {
  return parts.flatMap((part) =>
    part.placements.flatMap((placement) => {
      const meta = itemMeta[placement.id];
      return meta
        ? [{
          blueprintTargetId: meta.blueprintTargetId,
          questionType: meta.questionTypeId,
        }]
        : [];
    })
  );
}

export function itemMetaFromDraft(
  placementId: string,
  itemId: string,
  rev: number,
  draft: Draft,
  context: {
    readonly blueprint?: AssessmentBlueprint;
    readonly blueprintTargetId?: string;
    readonly aiSuggestions?: readonly QuestionReviewSuggestion[];
  } = {},
): ItemMeta {
  return {
    id: placementId,
    itemId,
    title: draft.title ?? 'Untitled question',
    latestRev: rev,
    questionTypeId: requireQuestionType(draft),
    questionType: labelForTypeId(draft.type),
    preview: projectQuestionPreviewFromDraft(draft),
    blueprintTargetId: context.blueprintTargetId,
    reviewSuggestions: collectQuestionReviewSuggestions(draft, context),
  };
}

function requireQuestionType(draft: Draft): NonNullable<Draft['type']> {
  if (!draft.type) throw new Error('Question type is required.');
  return draft.type;
}

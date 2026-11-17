import type { QtiFixedTestOrdering, QtiTestRubricBlock } from '@longsightgroup/qti3-core';
import type {
  AssessmentContentPlacement,
  AssessmentStandaloneContent,
} from './assessment_standalone_content.ts';
import { parseStandaloneRubric } from './assessment_content_qti.ts';
import { canonicalJsonStringify } from './canonical_json.ts';

/** Instructions anchor before a real question number, or after the final question. */
export type QuestionOrderPreviewInstructions = {
  readonly placementId: string;
  readonly beforeQuestionNumber: number;
  readonly content: AssessmentStandaloneContent;
};

/** Bind shared parsed section rubrics to exact authored content without question identities. */
export function contentOrderPreview(
  placements: readonly ({ readonly itemId: string } | AssessmentContentPlacement)[],
  sections: QtiFixedTestOrdering['sections'],
  rubrics: readonly QtiTestRubricBlock[],
): readonly QuestionOrderPreviewInstructions[] {
  const contentSections = sections.filter((section) => section.items.length === 0);
  const content = placements.filter((placement) => 'content' in placement);
  if (content.length === 0) return [];
  if (content.length !== contentSections.length) {
    throw new Error('Preview content section bindings differ from the canonical export.');
  }
  let questionNumber = 1;
  let contentIndex = 0;
  return placements.flatMap((placement) => {
    if ('itemId' in placement) {
      questionNumber++;
      return [];
    }
    const section = contentSections[contentIndex++];
    const owned = rubrics.filter((rubric) =>
      rubric.scopeType === 'assessment-section' &&
      rubric.scopeIdentifier === section.sectionIdentifier
    );
    if (owned.length !== 1) {
      throw new Error('Preview content rubric ownership is missing or ambiguous.');
    }
    const parsed = parseStandaloneRubric(owned[0].node);
    if (!parsed || canonicalJsonStringify(parsed) !== canonicalJsonStringify(placement.content)) {
      throw new Error('Shared preview content differs from authored content.');
    }
    return [{ placementId: placement.id, beforeQuestionNumber: questionNumber, content: parsed }];
  });
}

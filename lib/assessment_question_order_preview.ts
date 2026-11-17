import {
  contentOrderPreview,
  type QuestionOrderPreviewInstructions,
} from './assessment_content_order_preview.ts';
import { assessmentQuestionPlacements } from './assessment_content.ts';
import {
  parseQtiFixedTestOrdering,
  parseQtiTestRubrics,
  prepareQtiFixedTestOrder,
} from '@longsightgroup/qti3-core';
import type { AssessmentExportDocument } from './export/assessment.ts';
import type { PlacementQuestionView } from './placement_question_views.ts';

/** A saved question identity shown in an example learner order, without an attempt. */
export type QuestionOrderPreviewQuestion = {
  readonly placementId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly title: string;
  readonly authoredPosition: number;
  readonly fixed: boolean;
};

/** Example order for the exact saved arrangement, retaining authored part boundaries. */
export type AssessmentQuestionOrderPreview = {
  readonly version: string;
  readonly parts: readonly {
    readonly id: string;
    readonly title: string;
    readonly shuffleQuestions: boolean;
    readonly questions: readonly QuestionOrderPreviewQuestion[];
    readonly instructions: readonly QuestionOrderPreviewInstructions[];
  }[];
};

/** Project shared QTI ordering onto the same snapshot's placement-owned question metadata. */
export function buildQuestionOrderPreview(input: {
  readonly xml: string;
  readonly document: AssessmentExportDocument;
  readonly views: Readonly<Record<string, PlacementQuestionView>>;
  readonly version: string;
  readonly seed: string | number;
}):
  | { readonly ok: true; readonly value: AssessmentQuestionOrderPreview }
  | { readonly ok: false; readonly code: 'ordering_unsupported' } {
  const rubrics = parseQtiTestRubrics(input.xml);
  if (!rubrics.ok) return { ok: false, code: 'ordering_unsupported' };
  const definition = parseQtiFixedTestOrdering(input.xml);
  if (!definition.ok) return { ok: false, code: 'ordering_unsupported' };
  const order = prepareQtiFixedTestOrder(definition.value, { kind: 'new', seed: input.seed });
  if (!order.ok) return { ok: false, code: 'ordering_unsupported' };
  const partIdentifiers = [
    ...new Set(definition.value.sections.map((section) => section.partIdentifier)),
  ];
  if (partIdentifiers.length !== input.document.parts.length) {
    throw new Error('Preview section bindings differ from the canonical export.');
  }
  return {
    ok: true,
    value: {
      version: input.version,
      parts: partIdentifiers.map((partIdentifier, partIndex) => {
        const part = input.document.parts[partIndex];
        const sections = definition.value.sections.filter((section) =>
          section.partIdentifier === partIdentifier
        );
        const references = sections.flatMap((section) => section.items);
        const generated = order.value.sections.filter((section) =>
          section.partIdentifier === partIdentifier
        );
        if (
          !part || generated.length !== sections.length ||
          references.length !== assessmentQuestionPlacements(part.placements).length
        ) {
          throw new Error('Preview placement bindings differ from the canonical export.');
        }
        const questions = new Map<string, QuestionOrderPreviewQuestion>();
        const questionPlacements = assessmentQuestionPlacements(part.placements);
        references.forEach((reference, position) => {
          const placement = questionPlacements[position];
          if (!placement || reference.href !== `items/${placement.itemId}.xml`) {
            throw new Error('Preview resource binding differs from the canonical export.');
          }
          const view = input.views[placement.id];
          if (!view) throw new Error('Preview placement metadata is missing.');
          questions.set(reference.identifier, {
            placementId: placement.id,
            itemId: view.itemId,
            revision: view.revision,
            title: view.title,
            authoredPosition: position + 1,
            fixed: reference.fixed === true,
          });
        });
        return {
          id: part.id,
          title: part.title,
          shuffleQuestions: sections.some((section) => section.shuffle),
          instructions: contentOrderPreview(part.placements, sections, rubrics.value),
          questions: generated.flatMap((section) => section.itemRefs).map((identifier) => {
            const question = questions.get(identifier);
            if (!question) throw new Error('Shared preview order references an unbound question.');
            return question;
          }),
        };
      }),
    },
  };
}

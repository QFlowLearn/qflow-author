import {
  assessBlueprintCoverage,
  type AssessmentBlueprintCoverage,
  type DefinedAssessmentBlueprint,
} from '../assessment_blueprint.ts';
import { isQuestionTypeId, type QuestionTypeId } from '../types/registry.ts';

type MigrationBlueprintItem = {
  readonly id: string;
  readonly decision: 'pending' | 'accepted' | 'rejected';
  readonly blueprintTargetId: string | null;
  readonly itemType: string;
};

/** Measure the bank represented by accepted conversion questions only. */
export function assessAcceptedMigrationBlueprintCoverage(
  blueprint: DefinedAssessmentBlueprint,
  items: readonly MigrationBlueprintItem[],
): AssessmentBlueprintCoverage {
  return assessBlueprintCoverage(
    blueprint,
    items.filter((item) => item.decision === 'accepted').map(projectAlignment),
  );
}

/** Measure the exact accepted selection proposed for one conversion commit. */
export function assessMigrationCommitBlueprintCoverage(
  blueprint: DefinedAssessmentBlueprint,
  items: readonly MigrationBlueprintItem[],
  approvedItemIds: ReadonlySet<string>,
): AssessmentBlueprintCoverage {
  return assessBlueprintCoverage(
    blueprint,
    items.filter((item) => item.decision === 'accepted' && approvedItemIds.has(item.id)).map(
      projectAlignment,
    ),
  );
}

function projectAlignment(item: MigrationBlueprintItem): {
  readonly blueprintTargetId?: string;
  readonly questionType: QuestionTypeId;
} {
  const questionType = item.itemType;
  if (!isQuestionTypeId(questionType)) {
    throw new Error(`Unsupported migration question type "${item.itemType}".`);
  }
  return {
    ...(item.blueprintTargetId === null ? {} : { blueprintTargetId: item.blueprintTargetId }),
    questionType,
  };
}

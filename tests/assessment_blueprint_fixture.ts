import {
  type DefinedAssessmentBlueprint,
  parseAssessmentBlueprint,
  requireDefinedAssessmentBlueprint,
} from '../lib/assessment_blueprint.ts';
import { isQuestionTypeId } from '../lib/types/registry.ts';

/** Builds explicit blueprint intent for tests that exercise generation and review boundaries. */
export function testAssessmentBlueprint(
  targets: readonly {
    readonly id: string;
    readonly questionType: string;
    readonly count: number;
  }[],
): DefinedAssessmentBlueprint {
  return requireDefinedAssessmentBlueprint(parseAssessmentBlueprint({
    _tag: 'Defined',
    version: 1,
    outcomes: [{ id: 'test-outcome', title: 'Test outcome', weight: 100 }],
    targets: targets.map((target) => {
      const questionType = target.questionType;
      if (!isQuestionTypeId(questionType)) {
        throw new Error(`Unsupported test question type: ${target.questionType}`);
      }
      return {
        ...target,
        questionType,
        outcomeId: 'test-outcome',
        cognitiveDemand: 'understand',
        difficulty: 'medium',
      };
    }),
  }));
}

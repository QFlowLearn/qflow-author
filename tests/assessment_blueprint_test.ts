import { expect, test as testCase } from 'vitest';

import {
  assessBlueprintCoverage,
  AssessmentBlueprintAlignmentError,
  assessmentBlueprintQuestionCount,
  parseAssessmentBlueprint,
  requireCompatibleBlueprintTarget,
  requireDefinedAssessmentBlueprint,
  UNSPECIFIED_ASSESSMENT_BLUEPRINT,
} from '../lib/assessment_blueprint.ts';

const defined = {
  _tag: 'Defined',
  version: 1,
  outcomes: [
    { id: 'fractions', title: 'Reason with fractions', weight: 60 },
    { id: 'decimals', title: 'Reason with decimals', weight: 40 },
  ],
  targets: [
    {
      id: 'fractions-apply',
      outcomeId: 'fractions',
      count: 3,
      cognitiveDemand: 'apply',
      difficulty: 'medium',
      questionType: 'single_select',
    },
    {
      id: 'decimals-analyze',
      outcomeId: 'decimals',
      count: 2,
      cognitiveDemand: 'analyze',
      difficulty: 'hard',
      questionType: 'text_entry',
    },
  ],
} as const;

testCase('assessment blueprint parser preserves explicit targets and coverage intent', () => {
  const parsed = requireDefinedAssessmentBlueprint(parseAssessmentBlueprint(defined));
  expect(assessmentBlueprintQuestionCount(parsed)).toStrictEqual(5);
  expect(
    assessBlueprintCoverage(parsed, [
      { blueprintTargetId: 'fractions-apply', questionType: 'single_select' },
      { blueprintTargetId: 'fractions-apply', questionType: 'single_select' },
      { blueprintTargetId: 'fractions-apply', questionType: 'single_select' },
      { blueprintTargetId: 'decimals-analyze', questionType: 'text_entry' },
      { blueprintTargetId: 'decimals-analyze', questionType: 'text_entry' },
    ]).complete,
  ).toStrictEqual(true);
});

testCase('assessment blueprint coverage exposes missing and stale alignment', () => {
  const parsed = requireDefinedAssessmentBlueprint(parseAssessmentBlueprint(defined));
  const coverage = assessBlueprintCoverage(parsed, [
    { questionType: 'single_select' },
    { blueprintTargetId: 'removed-target', questionType: 'single_select' },
    { blueprintTargetId: 'fractions-apply', questionType: 'single_select' },
  ]);
  expect(coverage.complete).toStrictEqual(false);
  expect(coverage.unassigned).toStrictEqual(1);
  expect(coverage.unknownTarget).toStrictEqual(1);
  expect(coverage.targets[0].remaining).toStrictEqual(2);
});

testCase('assessment blueprint coverage rejects an aligned question with the wrong type', () => {
  const parsed = requireDefinedAssessmentBlueprint(parseAssessmentBlueprint(defined));
  const coverage = assessBlueprintCoverage(parsed, [{
    blueprintTargetId: 'fractions-apply',
    questionType: 'text_entry',
  }]);

  expect(coverage.complete).toStrictEqual(false);
  expect(coverage.incompatibleQuestionType).toStrictEqual(1);
  expect(coverage.assigned).toStrictEqual(0);
  expect(coverage.targets[0].actual).toStrictEqual(0);
});

testCase('assessment blueprint alignment rejects user-correctable mismatches explicitly', () => {
  const blueprint = requireDefinedAssessmentBlueprint(parseAssessmentBlueprint(defined));
  expect(() => requireCompatibleBlueprintTarget(blueprint, 'fractions-apply', 'text_entry'))
    .toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof AssessmentBlueprintAlignmentError &&
        caught.message.includes('requires single_select')
      ),
    );
  expect(() =>
    requireCompatibleBlueprintTarget(
      UNSPECIFIED_ASSESSMENT_BLUEPRINT,
      'fractions-apply',
      'single_select',
    )
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof AssessmentBlueprintAlignmentError &&
      caught.message.includes('Define an assessment blueprint first')
    ),
  );
});

testCase('assessment blueprint parser rejects repaired or contradictory intent', () => {
  expect(parseAssessmentBlueprint(UNSPECIFIED_ASSESSMENT_BLUEPRINT)).toStrictEqual({
    _tag: 'Unspecified',
    version: 1,
  });
  expect(() =>
    parseAssessmentBlueprint({
      ...defined,
      outcomes: defined.outcomes.map((outcome) => ({ ...outcome, weight: 40 })),
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('weights must total 100')
    ),
  );
  expect(() => parseAssessmentBlueprint({ ...defined, inferredCount: 5 })).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('unknown: inferredCount')
    ),
  );
});

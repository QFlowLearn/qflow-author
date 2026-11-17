import { expect, test as testCase } from 'vitest';

import {
  assessAcceptedMigrationBlueprintCoverage,
  assessMigrationCommitBlueprintCoverage,
} from '../lib/import/migration_blueprint_coverage.ts';
import { testAssessmentBlueprint } from './assessment_blueprint_fixture.ts';

const BLUEPRINT = testAssessmentBlueprint([
  { id: 'choice-target', questionType: 'single_select', count: 1 },
  { id: 'entry-target', questionType: 'text_entry', count: 1 },
]);

const ITEMS = [
  {
    id: 'accepted-choice',
    decision: 'accepted' as const,
    blueprintTargetId: 'choice-target',
    itemType: 'single_select',
  },
  {
    id: 'accepted-entry',
    decision: 'accepted' as const,
    blueprintTargetId: 'entry-target',
    itemType: 'text_entry',
  },
  {
    id: 'pending-choice',
    decision: 'pending' as const,
    blueprintTargetId: 'choice-target',
    itemType: 'single_select',
  },
  {
    id: 'rejected-entry',
    decision: 'rejected' as const,
    blueprintTargetId: 'entry-target',
    itemType: 'text_entry',
  },
];

testCase('migration blueprint coverage counts accepted questions only', () => {
  const coverage = assessAcceptedMigrationBlueprintCoverage(BLUEPRINT, ITEMS);

  expect(coverage.complete).toStrictEqual(true);
  expect(coverage.assigned).toStrictEqual(2);
  expect(coverage.targets.map((target) => target.actual)).toStrictEqual([1, 1]);
});

testCase('migration commit coverage counts only the accepted approval selection', () => {
  const incomplete = assessMigrationCommitBlueprintCoverage(
    BLUEPRINT,
    ITEMS,
    new Set(['accepted-choice']),
  );
  const complete = assessMigrationCommitBlueprintCoverage(
    BLUEPRINT,
    ITEMS,
    new Set(['accepted-choice', 'accepted-entry', 'rejected-entry']),
  );

  expect(incomplete.complete).toStrictEqual(false);
  expect(incomplete.targets.map((target) => target.actual)).toStrictEqual([1, 0]);
  expect(complete.complete).toStrictEqual(true);
  expect(complete.targets.map((target) => target.actual)).toStrictEqual([1, 1]);
});

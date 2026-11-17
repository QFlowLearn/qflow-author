import {
  listSelectableAssessmentExportTargets,
  type SelectableAssessmentExportTargetId,
} from './export/assessment_export_targets.ts';

export const QUESTION_LIFECYCLE_STATES = ['active', 'archived'] as const;
export type QuestionLifecycleState = (typeof QUESTION_LIFECYCLE_STATES)[number];

export const QUESTION_REVIEW_STATES = ['open', 'approved', 'changes_requested'] as const;
export type QuestionReviewState = (typeof QUESTION_REVIEW_STATES)[number];
export type QuestionReviewFacetState = QuestionReviewState | 'not_requested';

export const QUESTION_COMPATIBILITY_OUTCOMES = [
  'exact',
  'normalized',
  'lossy',
  'blocked',
] as const;
export type QuestionCompatibilityOutcome = (typeof QUESTION_COMPATIBILITY_OUTCOMES)[number];

/** Result of running one immutable QTI 3 revision through an exact export target contract. */
export type QuestionCompatibilityProjection = {
  readonly targetId: SelectableAssessmentExportTargetId;
  readonly targetContractId: string;
  readonly outcome: QuestionCompatibilityOutcome;
  readonly diagnosticCodes: readonly string[];
};

/** Parses the complete compatibility projection stored with one exact revision. */
export function parseQuestionCompatibility(
  value: unknown,
): readonly QuestionCompatibilityProjection[] {
  if (!Array.isArray(value)) throw new Error('Question compatibility must be an array.');
  const targets = listSelectableAssessmentExportTargets();
  const registeredTargetIds = new Set(targets.map((target) => target.id));
  const byTargetId = new Map<string, Record<string, unknown>>();
  for (const entry of value) {
    if (
      !isRecord(entry) || !hasExactKeys(entry, [
        'targetId',
        'targetContractId',
        'outcome',
        'diagnosticCodes',
      ]) || typeof entry.targetId !== 'string'
    ) {
      throw new Error('Question compatibility entry must be an object.');
    }
    if (byTargetId.has(entry.targetId)) {
      throw new Error('Question compatibility target is duplicated.');
    }
    const registeredTarget = targets.find((target) => target.id === entry.targetId);
    if (!registeredTarget || !registeredTargetIds.has(registeredTarget.id)) {
      throw new Error('Question compatibility target is not registered.');
    }
    byTargetId.set(registeredTarget.id, entry);
  }
  if (byTargetId.size !== targets.length) {
    throw new Error('Question compatibility does not cover every selectable target.');
  }
  return targets.map((target) => {
    const input = byTargetId.get(target.id);
    if (!input) {
      throw new Error('Question compatibility does not cover every selectable target.');
    }
    if (input.targetContractId !== target.targetContractId) {
      throw new Error('Question compatibility target contract is out of order or incomplete.');
    }
    const outcome = QUESTION_COMPATIBILITY_OUTCOMES.find((candidate) =>
      candidate === input.outcome
    );
    if (!outcome || !Array.isArray(input.diagnosticCodes)) {
      throw new Error('Question compatibility result is invalid.');
    }
    const diagnosticCodes = input.diagnosticCodes.map((code) => {
      if (typeof code !== 'string' || !code) {
        throw new Error('Question compatibility diagnostic code is invalid.');
      }
      return code;
    });
    return {
      targetId: target.id,
      targetContractId: target.targetContractId,
      outcome,
      diagnosticCodes,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

import { isQuestionTypeId, type QuestionTypeId } from './types/registry.ts';

/** Cognitive demand levels available to assessment blueprint targets. */
export const BLUEPRINT_COGNITIVE_DEMANDS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const;

/** Difficulty intents available to assessment blueprint targets. */
export const BLUEPRINT_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export type BlueprintCognitiveDemand = typeof BLUEPRINT_COGNITIVE_DEMANDS[number];
export type BlueprintDifficulty = typeof BLUEPRINT_DIFFICULTIES[number];

declare const definedAssessmentBlueprintBrand: unique symbol;

export type AssessmentBlueprintOutcome = {
  readonly id: string;
  readonly title: string;
  readonly weight: number;
};

export type AssessmentBlueprintTarget = {
  readonly id: string;
  readonly outcomeId: string;
  readonly count: number;
  readonly cognitiveDemand: BlueprintCognitiveDemand;
  readonly difficulty: BlueprintDifficulty;
  readonly questionType: QuestionTypeId;
};

/** Explicit lifecycle state for an assessment that does not have a blueprint yet. */
export type UnspecifiedAssessmentBlueprint = {
  readonly _tag: 'Unspecified';
  readonly version: 1;
};

/** Author-approved assessment intent used by generation, review, and coverage checks. */
export type DefinedAssessmentBlueprint = {
  readonly _tag: 'Defined';
  readonly version: 1;
  readonly outcomes: readonly AssessmentBlueprintOutcome[];
  readonly targets: readonly AssessmentBlueprintTarget[];
  readonly [definedAssessmentBlueprintBrand]: true;
};

/** Editable blueprint state that may be temporarily invalid while an author changes fields. */
export type AssessmentBlueprintFormDraft = {
  readonly _tag: 'Defined';
  readonly version: 1;
  readonly outcomes: readonly AssessmentBlueprintOutcome[];
  readonly targets: readonly AssessmentBlueprintTarget[];
};

/** Persisted assessment blueprint state. */
export type AssessmentBlueprint =
  | UnspecifiedAssessmentBlueprint
  | DefinedAssessmentBlueprint;

/** One target's expected and assigned question counts. */
export type AssessmentBlueprintCoverageTarget = AssessmentBlueprintTarget & {
  readonly outcomeTitle: string;
  readonly actual: number;
  readonly remaining: number;
  readonly excess: number;
};

/** Coverage of a defined blueprint by a concrete question selection. */
export type AssessmentBlueprintCoverage = {
  readonly complete: boolean;
  readonly expected: number;
  readonly assigned: number;
  readonly unassigned: number;
  readonly unknownTarget: number;
  readonly incompatibleQuestionType: number;
  readonly targets: readonly AssessmentBlueprintCoverageTarget[];
};

/** One question's assessment-local alignment projected into the blueprint domain. */
export type BlueprintQuestionAlignment = {
  readonly blueprintTargetId?: string;
  readonly questionType: QuestionTypeId;
};

const BLUEPRINT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const MAX_BLUEPRINT_QUESTIONS = 200;

/** Parse one canonical assessment-blueprint outcome or target identifier. */
export function parseAssessmentBlueprintId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return BLUEPRINT_ID_PATTERN.test(id) ? id : null;
}

/** A user-correctable assessment-blueprint parsing failure. */
export class AssessmentBlueprintParseError extends Error {
  readonly _tag = 'AssessmentBlueprintParseError' as const;
}

/** An expected persistence rejection while replacing one assessment blueprint. */
export class AssessmentBlueprintUpdateError extends Error {
  readonly _tag = 'AssessmentBlueprintUpdateError' as const;

  constructor(
    readonly code: 'not_found' | 'conflict',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AssessmentBlueprintUpdateError';
  }
}

/** A user-correctable question-to-blueprint alignment failure. */
export class AssessmentBlueprintAlignmentError extends Error {
  readonly _tag = 'AssessmentBlueprintAlignmentError' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AssessmentBlueprintAlignmentError';
  }
}

/** Canonical explicit state used before an author defines assessment intent. */
export const UNSPECIFIED_ASSESSMENT_BLUEPRINT: UnspecifiedAssessmentBlueprint = Object.freeze({
  _tag: 'Unspecified',
  version: 1,
});

/** Parse an assessment blueprint without adding or repairing author intent. */
export function parseAssessmentBlueprint(value: unknown): AssessmentBlueprint {
  const record = parseRecord(value, 'Assessment blueprint must be an object.');
  if (record._tag === 'Unspecified') {
    assertExactKeys(record, ['_tag', 'version'], 'unspecified assessment blueprint');
    if (record.version !== 1) blueprintParseFailure('Assessment blueprint version must be 1.');
    return UNSPECIFIED_ASSESSMENT_BLUEPRINT;
  }
  if (record._tag !== 'Defined') {
    blueprintParseFailure('Assessment blueprint state must be Defined or Unspecified.');
  }
  assertExactKeys(
    record,
    ['_tag', 'version', 'outcomes', 'targets'],
    'defined assessment blueprint',
  );
  if (record.version !== 1) blueprintParseFailure('Assessment blueprint version must be 1.');
  if (!Array.isArray(record.outcomes) || !record.outcomes.length) {
    blueprintParseFailure('A defined assessment blueprint requires at least one outcome.');
  }
  if (!Array.isArray(record.targets) || !record.targets.length) {
    blueprintParseFailure('A defined assessment blueprint requires at least one target.');
  }

  const outcomes = record.outcomes.map((entry, index) => parseOutcome(entry, index));
  assertUnique(outcomes.map((outcome) => outcome.id), 'Blueprint outcome IDs must be unique.');
  const totalWeight = outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
  if (totalWeight !== 100) {
    blueprintParseFailure(
      `Blueprint outcome weights must total 100. Current total: ${totalWeight}.`,
    );
  }

  const outcomeIds = new Set(outcomes.map((outcome) => outcome.id));
  const targets = record.targets.map((entry, index) => parseTarget(entry, index, outcomeIds));
  assertUnique(targets.map((target) => target.id), 'Blueprint target IDs must be unique.');
  const targetedOutcomeIds = new Set(targets.map((target) => target.outcomeId));
  const untargetedOutcome = outcomes.find((outcome) => !targetedOutcomeIds.has(outcome.id));
  if (untargetedOutcome) {
    blueprintParseFailure(
      `Blueprint outcome "${untargetedOutcome.title}" requires at least one target.`,
    );
  }
  const questionCount = targets.reduce((sum, target) => sum + target.count, 0);
  if (questionCount > MAX_BLUEPRINT_QUESTIONS) {
    blueprintParseFailure(`Blueprint question count cannot exceed ${MAX_BLUEPRINT_QUESTIONS}.`);
  }
  // SAFETY: every defined-blueprint invariant is established above before branding.
  return {
    _tag: 'Defined',
    version: 1,
    outcomes,
    targets,
  } as unknown as DefinedAssessmentBlueprint;
}

/** Project a parsed blueprint into editable form state without weakening the domain value. */
export function assessmentBlueprintFormDraft(
  blueprint: DefinedAssessmentBlueprint,
): AssessmentBlueprintFormDraft {
  return {
    _tag: 'Defined',
    version: 1,
    outcomes: blueprint.outcomes.map((outcome) => ({ ...outcome })),
    targets: blueprint.targets.map((target) => ({ ...target })),
  };
}

/** Require a defined blueprint at a workflow boundary. */
export function requireDefinedAssessmentBlueprint(
  value: AssessmentBlueprint,
): DefinedAssessmentBlueprint {
  if (value._tag !== 'Defined') {
    throw new Error('Define the assessment blueprint before continuing.');
  }
  return value;
}

/** Return the exact question count requested by a defined blueprint. */
export function assessmentBlueprintQuestionCount(blueprint: DefinedAssessmentBlueprint): number {
  return blueprint.targets.reduce((sum, target) => sum + target.count, 0);
}

/** Resolve one blueprint target without guessing when an ID is missing or stale. */
export function findAssessmentBlueprintTarget(
  blueprint: DefinedAssessmentBlueprint,
  targetId: string | undefined,
): AssessmentBlueprintTarget | null {
  if (!targetId) return null;
  return blueprint.targets.find((target) => target.id === targetId) ?? null;
}

/** Require one alignment target to exist in the assessment and match the question type. */
export function requireCompatibleBlueprintTarget(
  blueprint: AssessmentBlueprint,
  targetId: string,
  questionType: QuestionTypeId,
): AssessmentBlueprintTarget {
  if (blueprint._tag !== 'Defined') {
    throw new AssessmentBlueprintAlignmentError('Define an assessment blueprint first.');
  }
  const defined = blueprint;
  const target = findAssessmentBlueprintTarget(defined, targetId);
  if (!target) {
    throw new AssessmentBlueprintAlignmentError('Choose a current blueprint target.');
  }
  if (target.questionType !== questionType) {
    throw new AssessmentBlueprintAlignmentError(
      `Blueprint target "${target.id}" requires ${target.questionType}.`,
    );
  }
  return target;
}

/** Compare aligned questions with every exact blueprint target. */
export function assessBlueprintCoverage(
  blueprint: DefinedAssessmentBlueprint,
  questions: readonly BlueprintQuestionAlignment[],
): AssessmentBlueprintCoverage {
  const targetsById = new Map(blueprint.targets.map((target) => [target.id, target]));
  const counts = new Map<string, number>();
  let unassigned = 0;
  let unknownTarget = 0;
  let incompatibleQuestionType = 0;
  for (const question of questions) {
    const targetId = question.blueprintTargetId?.trim();
    if (!targetId) {
      unassigned += 1;
      continue;
    }
    const target = targetsById.get(targetId);
    if (!target) {
      unknownTarget += 1;
      continue;
    }
    if (target.questionType !== question.questionType) {
      incompatibleQuestionType += 1;
      continue;
    }
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }
  const outcomesById = new Map(blueprint.outcomes.map((outcome) => [outcome.id, outcome.title]));
  const targets = blueprint.targets.map((target) => {
    const actual = counts.get(target.id) ?? 0;
    return {
      ...target,
      outcomeTitle: outcomesById.get(target.outcomeId) ?? target.outcomeId,
      actual,
      remaining: Math.max(target.count - actual, 0),
      excess: Math.max(actual - target.count, 0),
    };
  });
  const expected = assessmentBlueprintQuestionCount(blueprint);
  const assigned = questions.length - unassigned - unknownTarget - incompatibleQuestionType;
  return {
    complete: unassigned === 0 && unknownTarget === 0 && incompatibleQuestionType === 0 &&
      targets.every((target) => target.actual === target.count),
    expected,
    assigned,
    unassigned,
    unknownTarget,
    incompatibleQuestionType,
    targets,
  };
}

function parseOutcome(value: unknown, index: number): AssessmentBlueprintOutcome {
  const record = parseRecord(value, `Blueprint outcome ${index + 1} must be an object.`);
  assertExactKeys(record, ['id', 'title', 'weight'], `blueprint outcome ${index + 1}`);
  return {
    id: parseBlueprintId(record.id, `Blueprint outcome ${index + 1} ID is invalid.`),
    title: parseBlueprintString(
      record.title,
      `Blueprint outcome ${index + 1} title is required.`,
    ),
    weight: parseIntegerInRange(
      record.weight,
      1,
      100,
      `Blueprint outcome ${index + 1} weight must be between 1 and 100.`,
    ),
  };
}

function parseTarget(
  value: unknown,
  index: number,
  outcomeIds: ReadonlySet<string>,
): AssessmentBlueprintTarget {
  const record = parseRecord(value, `Blueprint target ${index + 1} must be an object.`);
  assertExactKeys(
    record,
    ['id', 'outcomeId', 'count', 'cognitiveDemand', 'difficulty', 'questionType'],
    `blueprint target ${index + 1}`,
  );
  const outcomeId = parseBlueprintId(
    record.outcomeId,
    `Blueprint target ${index + 1} outcome ID is invalid.`,
  );
  if (!outcomeIds.has(outcomeId)) {
    blueprintParseFailure(`Blueprint target ${index + 1} references an unknown outcome.`);
  }
  return {
    id: parseBlueprintId(record.id, `Blueprint target ${index + 1} ID is invalid.`),
    outcomeId,
    count: parseBlueprintPositiveInteger(
      record.count,
      `Blueprint target ${index + 1} count must be positive.`,
    ),
    cognitiveDemand: parseCognitiveDemand(record.cognitiveDemand, index),
    difficulty: parseDifficulty(record.difficulty, index),
    questionType: parseQuestionType(record.questionType, index),
  };
}

function parseBlueprintId(value: unknown, message: string): string {
  const id = parseAssessmentBlueprintId(value);
  if (!id) blueprintParseFailure(message);
  return id;
}

function parseCognitiveDemand(value: unknown, index: number): BlueprintCognitiveDemand {
  const demand = BLUEPRINT_COGNITIVE_DEMANDS.find((candidate) => candidate === value);
  if (!demand) {
    blueprintParseFailure(`Blueprint target ${index + 1} cognitive demand is invalid.`);
  }
  return demand;
}

function parseDifficulty(value: unknown, index: number): BlueprintDifficulty {
  const difficulty = BLUEPRINT_DIFFICULTIES.find((candidate) => candidate === value);
  if (!difficulty) {
    blueprintParseFailure(`Blueprint target ${index + 1} difficulty is invalid.`);
  }
  return difficulty;
}

function parseQuestionType(value: unknown, index: number): QuestionTypeId {
  if (!isQuestionTypeId(value)) {
    blueprintParseFailure(`Blueprint target ${index + 1} question type is invalid.`);
  }
  return value;
}

function parseIntegerInRange(
  value: unknown,
  min: number,
  max: number,
  message: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    blueprintParseFailure(message);
  }
  return value;
}

function parseRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) blueprintParseFailure(message);
  // SAFETY: the object shape was established above; concrete fields are parsed before use.
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const allowed = new Set(expected);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  const missing = expected.filter((key) => !Object.hasOwn(record, key));
  if (unknown.length || missing.length) {
    blueprintParseFailure(
      `Invalid ${label}. Missing: ${missing.join(', ') || 'none'}; unknown: ${
        unknown.join(', ') || 'none'
      }.`,
    );
  }
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) blueprintParseFailure(message);
}

function parseBlueprintString(value: unknown, message: string): string {
  if (typeof value !== 'string') blueprintParseFailure(message);
  const parsed = value.trim();
  if (!parsed) blueprintParseFailure(message);
  return parsed;
}

function parseBlueprintPositiveInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    blueprintParseFailure(message);
  }
  return value;
}

function blueprintParseFailure(message: string): never {
  throw new AssessmentBlueprintParseError(message);
}

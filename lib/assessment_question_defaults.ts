/** An opted-in assessment point default; null leaves personal/type defaults in control. */
export type AssessmentQuestionPointDefault = number | null;

/** One compare-and-save command; exact retries never overwrite a different saved policy. */
export type AssessmentQuestionPointDefaultCommand = {
  readonly expected: AssessmentQuestionPointDefault;
  readonly desired: AssessmentQuestionPointDefault;
};

/** Closed request outcome; malformed fields never reach the persistence service. */
export type AssessmentQuestionPointDefaultParseResult =
  | { readonly _tag: 'Parsed'; readonly command: AssessmentQuestionPointDefaultCommand }
  | { readonly _tag: 'Invalid' };

function isPointDefault(value: unknown): value is AssessmentQuestionPointDefault {
  return value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Refine a closed HTTP acknowledgement before it can change confirmed browser state. */
export function parseAssessmentQuestionPointDefaultResponse(
  value: unknown,
  tag: 'Found' | 'Saved',
): { readonly _tag: 'Parsed'; readonly value: AssessmentQuestionPointDefault } | {
  readonly _tag: 'Invalid';
} {
  if (
    typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.keys(value).length !== 2 || !Object.hasOwn(value, '_tag') ||
    !Object.hasOwn(value, 'value') || Reflect.get(value, '_tag') !== tag
  ) return { _tag: 'Invalid' };
  const points: unknown = Reflect.get(value, 'value');
  return isPointDefault(points) ? { _tag: 'Parsed', value: points } : { _tag: 'Invalid' };
}

/** Parse both explicit policy snapshots, preserving zero and rejecting extra or missing fields. */
export function parseAssessmentQuestionPointDefaultCommand(
  value: unknown,
): AssessmentQuestionPointDefaultParseResult {
  if (
    typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.keys(value).length !== 2 || !Object.hasOwn(value, 'expected') ||
    !Object.hasOwn(value, 'desired')
  ) return { _tag: 'Invalid' };
  const expected: unknown = Reflect.get(value, 'expected');
  const desired: unknown = Reflect.get(value, 'desired');
  return isPointDefault(expected) && isPointDefault(desired)
    ? { _tag: 'Parsed', command: { expected, desired } }
    : { _tag: 'Invalid' };
}

/** Refine a database projection; invalid stored scoring policy is a defect, not an implicit reset. */
export function parseStoredAssessmentQuestionPointDefault(
  value: unknown,
): AssessmentQuestionPointDefault {
  if (!isPointDefault(value)) {
    throw new Error('Stored assessment question point default is invalid.');
  }
  return value;
}

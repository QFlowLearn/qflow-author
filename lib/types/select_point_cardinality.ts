/** Normalized authoring policy for select-point response cardinality. */
export type SelectPointCardinalityPolicy = {
  readonly maxChoices: number | undefined;
  readonly pointLimit: number | undefined;
  readonly responseCardinality: 'single' | 'multiple';
};

/**
 * Normalize select-point maximum choices.
 *
 * An omitted or invalid value uses the single-point default. Zero means unlimited.
 */
export function selectPointCardinalityPolicy(
  maxChoices?: number,
): SelectPointCardinalityPolicy {
  if (maxChoices == null || !Number.isFinite(maxChoices) || maxChoices < 0) {
    return {
      maxChoices: undefined,
      pointLimit: 1,
      responseCardinality: 'single',
    };
  }

  const normalized = Math.trunc(maxChoices);
  if (normalized === 0) {
    return {
      maxChoices: 0,
      pointLimit: undefined,
      responseCardinality: 'multiple',
    };
  }

  return {
    maxChoices: normalized,
    pointLimit: normalized,
    responseCardinality: normalized === 1 ? 'single' : 'multiple',
  };
}

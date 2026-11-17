import serializedDemoCompatibility from './demo_compatibility.generated.json' with { type: 'json' };
import { parsePrecomputedQuestionCompatibilityRecord } from './question_bank.ts';

/** Verified compatibility projections for the immutable presidents demo content. */
export const DEMO_COMPATIBILITY = parsePrecomputedQuestionCompatibilityRecord(
  serializedDemoCompatibility,
);

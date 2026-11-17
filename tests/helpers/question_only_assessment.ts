import { expect } from 'vitest';

import type { AssessmentRecord } from '../../lib/services/assessment_records.ts';

/** These fixtures deliberately contain only real questions; unexpected content must fail. */
export function assertQuestionOnlyAssessmentFixture(
  value: AssessmentRecord | null,
): asserts value is Omit<AssessmentRecord, 'parts'> & {
  parts: Array<
    Omit<AssessmentRecord['parts'][number], 'placements'> & {
      placements: Array<
        Extract<AssessmentRecord['parts'][number]['placements'][number], { itemId: string }>
      >;
    }
  >;
} {
  if (!value) expect.unreachable('The saved assessment fixture is missing.');
  for (const part of value.parts) {
    if (!(part.placements.every((placement) => 'itemId' in placement))) {
      expect.unreachable('This fixture requires question-only placements.');
    }
  }
}

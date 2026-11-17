import { expect, test as testCase } from 'vitest';

import { parseDeliveryAssessmentStatus } from '../lib/delivery_status.ts';
testCase('delivery status validates counts and exact published version', () => {
  const valid = { assessmentVersionId: 'v1', active: 2, draft: 1, closed: 0 };
  expect(parseDeliveryAssessmentStatus(valid, 'v1')).toStrictEqual(valid);
  expect(parseDeliveryAssessmentStatus(valid, 'v2')).toStrictEqual(null);
  expect(parseDeliveryAssessmentStatus({ ...valid, active: -1 }, 'v1')).toStrictEqual(null);
  expect(parseDeliveryAssessmentStatus({ ...valid, draft: 0.5 }, 'v1')).toStrictEqual(null);
  expect(parseDeliveryAssessmentStatus({ error: 'unavailable' }, 'v1')).toStrictEqual(null);
});

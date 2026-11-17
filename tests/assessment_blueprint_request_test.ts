import { expect, test as testCase } from 'vitest';

import {
  AssessmentBlueprintUpdateError,
  UNSPECIFIED_ASSESSMENT_BLUEPRINT,
} from '../lib/assessment_blueprint.ts';
import { saveAssessmentBlueprintResponse } from '../lib/http/assessment_blueprint_request.ts';

function request(body: string): Request {
  return new Request('https://qflow.test/api/assessments/assessment-id/blueprint', {
    ...{ duplex: 'half' },
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

testCase(
  'assessment blueprint request rejects invalid JSON and invalid intent separately',
  async () => {
    let saves = 0;
    const save = () => {
      saves += 1;
      return Promise.resolve(UNSPECIFIED_ASSESSMENT_BLUEPRINT);
    };
    const invalidJson = await saveAssessmentBlueprintResponse({
      request: request('{'),
      operation: 'assessment-blueprint-update',
      resourceId: 'assessment-id',
      save,
    });
    expect(invalidJson.status).toStrictEqual(400);
    expect(await invalidJson.json()).toStrictEqual({
      error: 'Assessment blueprint must be valid JSON.',
    });

    const invalidIntent = await saveAssessmentBlueprintResponse({
      request: request(JSON.stringify({ _tag: 'Unspecified', version: 2 })),
      operation: 'assessment-blueprint-update',
      resourceId: 'assessment-id',
      save,
    });
    expect(invalidIntent.status).toStrictEqual(422);
    expect(await invalidIntent.json()).toStrictEqual({
      error: 'Assessment blueprint version must be 1.',
    });
    expect(saves).toStrictEqual(0);
  },
);

testCase('assessment blueprint request translates expected persistence rejections', async () => {
  for (
    const expected of [
      { code: 'not_found', status: 404, message: 'Assessment not found.' },
      { code: 'conflict', status: 409, message: 'Resolve the current blueprint conflict.' },
    ] as const
  ) {
    const response = await saveAssessmentBlueprintResponse({
      request: request(JSON.stringify(UNSPECIFIED_ASSESSMENT_BLUEPRINT)),
      operation: 'assessment-blueprint-update',
      resourceId: 'assessment-id',
      save: () =>
        Promise.reject(new AssessmentBlueprintUpdateError(expected.code, expected.message)),
    });
    expect(response.status).toStrictEqual(expected.status);
    expect(await response.json()).toStrictEqual({ error: expected.message });
  }
});

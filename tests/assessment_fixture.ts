import { expect } from 'vitest';

import {
  createAssessmentDraft as createDraft,
  deleteAssessment as deleteRecord,
  saveAssessment as saveRecord,
} from '../lib/services/assessment_records.ts';

/** Create fixture data through the public command, failing loudly if membership is invalid. */
export async function createAssessmentDraft(...args: Parameters<typeof createDraft>) {
  const result = await createDraft(...args);
  if (result._tag !== 'Saved') expect.unreachable('Expected assessment fixture to be saved.');
  return result;
}

/** Save fixture data through the same persisted authorization seam as application callers. */
export async function saveAssessment(...args: Parameters<typeof saveRecord>) {
  const result = await saveRecord(...args);
  if (result._tag !== 'Saved') expect.unreachable('Expected assessment fixture to be saved.');
  return result;
}

/** Delete an authorized fixture through the public command and assert it existed. */
export async function deleteAssessment(...args: Parameters<typeof deleteRecord>) {
  const result = await deleteRecord(...args);
  expect(result._tag).toStrictEqual('Deleted');
}

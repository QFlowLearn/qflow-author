import { expect, test } from 'vitest';
import { blackboardPool, importBlackboardPool } from './helpers/blackboard_import.ts';
import { expectImportedScore } from './helpers/lms_import.ts';
test('Blackboard POOL essays retain human grading through preview and export', async () => {
  const { imported, analysis } = await importBlackboardPool(
    blackboardPool({ klass: 'QUESTION_ESSAY' }),
  );
  expect(imported.items[0].draft.externalScored).toBe('human');
  expect(analysis.items[0].readiness).toBe('ready');
  expectImportedScore(imported, { RESPONSE: 'My reasoning.' }, null);
});

import { expect, test as testCase } from 'vitest';

import {
  permanentMigrationFailure,
  retryableMigrationFailure,
  unexpectedMigrationFailure,
} from '../lib/import/migration_failures.ts';

testCase('migration failure policy owns permanent and retryable messages', () => {
  expect(permanentMigrationFailure('source_parse_invalid', null)).toStrictEqual({
    _tag: 'Permanent',
    code: 'source_parse_invalid',
    message: 'QFlowLearn could not read this source with the selected format.',
    cause: null,
  });
  expect(retryableMigrationFailure('persistence_unavailable', null)).toStrictEqual({
    _tag: 'Retryable',
    code: 'persistence_unavailable',
    message: 'QFlowLearn could not save or reload the source analysis.',
    cause: null,
  });
});

testCase('migration failure policy classifies a cancelled Workflow step', () => {
  const cause = new DOMException('Workflow step cancelled.', 'AbortError');
  expect(unexpectedMigrationFailure(cause)).toStrictEqual({
    _tag: 'Retryable',
    code: 'processing_cancelled',
    message: 'Source processing stopped before it finished.',
    cause,
  });
});

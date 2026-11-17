import { expect, it } from 'vitest';

import { safeErrorSummary } from '../lib/error_summary.ts';

it('safe error summaries classify causes without exposing messages or values', () => {
  expect(safeErrorSummary(new TypeError('secret message'))).toBe('TypeError');

  const unnamedError = new Error('another secret message');
  unnamedError.name = '';
  expect(safeErrorSummary(unnamedError)).toBe('Error');

  expect(safeErrorSummary({ token: 'secret value' })).toBe('object');
  expect(safeErrorSummary('secret value')).toBe('string');
  expect(safeErrorSummary(null)).toBe('object');
});

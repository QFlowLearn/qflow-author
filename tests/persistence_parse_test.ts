import { expect, test as testCase } from 'vitest';

import {
  parseNonNegativeInteger,
  parsePositiveInteger,
  parseTimestamp,
  parseUuid,
} from '../lib/persistence_parse.ts';

testCase('persistence parsers accept canonical persisted values', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  expect(parseUuid(id, 'bad')).toStrictEqual(id);
  expect(parsePositiveInteger(3, 'bad')).toStrictEqual(3);
  expect(parseNonNegativeInteger(0, 'bad')).toStrictEqual(0);
  const iso = '2026-01-01T00:00:00.000Z';
  expect(parseTimestamp(iso, 'bad')).toStrictEqual(iso);
});

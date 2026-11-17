import { expect, test as testCase } from 'vitest';

import { isCanonicalUuid, parseCanonicalUuid } from '../lib/uuid.ts';

testCase('UUID policy accepts RFC 4122 versions and normalizes case', () => {
  const lowercase = '550e8400-e29b-41d4-a716-446655440000';
  const uppercase = lowercase.toUpperCase();

  expect(isCanonicalUuid(lowercase)).toStrictEqual(true);
  expect(isCanonicalUuid(uppercase)).toStrictEqual(true);
  expect(parseCanonicalUuid(uppercase)).toStrictEqual(lowercase);
  expect(isCanonicalUuid('018f8f70-7b5c-7e3f-8a2b-1234567890ab')).toStrictEqual(false);
});

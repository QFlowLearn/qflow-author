import { expect, test as testCase } from 'vitest';

import type { DriverDraft } from '../lib/types/registry.ts';

testCase('driver draft contracts exclude fields owned by other question types', () => {
  const mediaHasChoiceFields: 'choices' extends keyof DriverDraft<'media'> ? true : false = false;
  const choiceHasMediaFields: 'mediaSources' extends keyof DriverDraft<'single_select'> ? true
    : false = false;

  expect(mediaHasChoiceFields).toStrictEqual(false);
  expect(choiceHasMediaFields).toStrictEqual(false);
});

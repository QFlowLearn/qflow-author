import { expect, test as testCase } from 'vitest';

import { defaultsHottext, listHottextIds, validateHottext } from '../lib/types/hottext.ts';

testCase('hottext draft defaults are valid and include markers', () => {
  const draft = defaultsHottext();
  const errors = validateHottext(draft);
  expect(errors).toStrictEqual([]);
  const markers = listHottextIds(draft.bodyHtml ?? '');
  if (!(markers.length >= 1)) expect.unreachable('Expected markers.length >= 1');
});

testCase('hottext validation errors are human-readable', () => {
  const errors = validateHottext({
    title: '',
    bodyHtml: '',
    hottexts: [],
    correctIds: ['X'],
  } as any);
  if (!(errors.some((e) => e.toLowerCase().includes('title')))) {
    expect.unreachable("Expected errors.some((e) => e.toLowerCase().includes('title'))");
  }
  if (!(errors.some((e) => e.toLowerCase().includes('body')))) {
    expect.unreachable("Expected errors.some((e) => e.toLowerCase().includes('body'))");
  }
  if (!(errors.some((e) => e.toLowerCase().includes('hot text')))) {
    expect.unreachable("Expected errors.some((e) => e.toLowerCase().includes('hot text'))");
  }
});

import { expect, test as testCase } from 'vitest';

import { parseItemLanguage, validateItemLanguage } from '../lib/types/item_language.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';

testCase('item language parser canonicalizes BCP 47 casing', () => {
  expect(parseItemLanguage(' EN_us '.replace('_', '-'))).toStrictEqual('en-US');
});

testCase('item language parser rejects malformed values', () => {
  expect(() => parseItemLanguage('not a language')).toThrowError(Error);
  expect(() => parseItemLanguage(undefined)).toThrowError(Error);
});

testCase('item language editor validation returns stable codes without parser prose', () => {
  expect(validateItemLanguage('')).toStrictEqual({ ok: false, code: 'required' });
  expect(validateItemLanguage('not a language')).toStrictEqual({ ok: false, code: 'invalid' });
  const valid = validateItemLanguage(' FR-ca ');
  expect(valid.ok).toStrictEqual(true);
  if (valid.ok) expect(valid.value).toStrictEqual('fr-CA');
});

testCase('persisted drafts require itemLanguage', () => {
  expect(() =>
    parsePersistedDraft(
      { type: 'single_select', title: 'x', choices: [], correctId: '' },
      'single_select',
    )
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('itemLanguage')
    ),
  );
});

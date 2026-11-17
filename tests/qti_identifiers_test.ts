import { expect, test as testCase } from 'vitest';

import { isValidQtiIdentifier } from '../lib/qti_identifiers.ts';

type Case = { input: string; expected: boolean; why: string };

const CASES: Case[] = [
  { input: 'RESPONSE', expected: true, why: 'Typical response identifier' },
  { input: 'response_1', expected: true, why: 'Starts with letter; underscore allowed' },
  { input: '_RESPONSE', expected: true, why: 'Leading underscore allowed' },
  { input: 'A-1.2_3', expected: true, why: 'Letters/digits plus dash/period/underscore allowed' },

  { input: '', expected: false, why: 'Empty string is not an identifier' },
  { input: '  RESPONSE  ', expected: true, why: 'Whitespace is trimmed before validating' },

  { input: '1RESPONSE', expected: false, why: 'Cannot start with a digit' },
  { input: '-RESPONSE', expected: false, why: 'Cannot start with dash' },
  { input: '.RESPONSE', expected: false, why: 'Cannot start with period' },

  { input: 'RESPONSE VALUE', expected: false, why: 'Spaces are not allowed' },
  { input: 'RESPONSE/VALUE', expected: false, why: 'Slash is not allowed' },
  { input: 'RESPONSE:VALUE', expected: false, why: 'Colon is not allowed' },
  { input: 'RESPONSE#VALUE', expected: false, why: 'Punctuation like # is not allowed' },
  { input: 'réponse', expected: false, why: 'Only ASCII letters/digits and ._- are allowed' },
];

testCase('isValidQtiIdentifier: human-readable examples', () => {
  for (const c of CASES) {
    expect(isValidQtiIdentifier(c.input), `${c.why} (input=${JSON.stringify(c.input)})`)
      .toStrictEqual(c.expected);
  }
});

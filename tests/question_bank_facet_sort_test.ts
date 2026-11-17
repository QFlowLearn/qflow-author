import { expect, test as testCase } from 'vitest';

import { sortQuestionBankFacet } from '../lib/services/question_bank_read.ts';

testCase('question-bank facet sorting uses the request locale', () => {
  const values = [
    { id: 'nu', label: 'nube' },
    { id: 'ñ', label: 'ñandú' },
    { id: 'na', label: 'nación' },
  ];

  expect(sortQuestionBankFacet(values, new Intl.Collator('es-ES')).map((value) => value.id))
    .toStrictEqual(['na', 'nu', 'ñ']);
  expect(sortQuestionBankFacet(values, new Intl.Collator('en-US')).map((value) => value.id))
    .toStrictEqual(['na', 'ñ', 'nu']);
});

testCase('question-bank facet sorting uses stable IDs for equal labels', () => {
  const values = [
    { id: 'z', label: 'Avión' },
    { id: 'b', label: 'Avión' },
    { id: 'a', label: 'Avión' },
  ];

  expect(sortQuestionBankFacet(values, new Intl.Collator('es-ES')).map((value) => value.id))
    .toStrictEqual(['a', 'b', 'z']);
});

testCase('question-bank facet sorting does not mutate the source collection', () => {
  const values = [
    { id: 'b', label: 'Beta' },
    { id: 'a', label: 'Alpha' },
  ];
  const sorted = sortQuestionBankFacet(values, new Intl.Collator('en-US'));

  expect(values.map((value) => value.id)).toStrictEqual(['b', 'a']);
  expect(sorted.map((value) => value.id)).toStrictEqual(['a', 'b']);
});

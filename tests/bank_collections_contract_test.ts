import { expect, test as testCase } from 'vitest';

import { parseBankCollectionCommand } from '../lib/bank_collections.ts';

const collectionId = '10000000-0000-4000-8000-000000000001';
const questionId = '10000000-0000-4000-8000-000000000002';

testCase('collection commands reject malformed, unbounded, and ambiguous inputs', () => {
  const valid = {
    _tag: 'Create',
    collectionId,
    name: ' Genetics ',
    description: '',
    position: 0,
  } as const;
  expect(parseBankCollectionCommand(valid)).toStrictEqual({ ...valid, name: 'Genetics' });
  for (
    const input of [
      null,
      [],
      {},
      { ...valid, unexpected: true },
      { ...valid, collectionId: 'invalid' },
      { ...valid, name: ' ' },
      { ...valid, name: 'x'.repeat(161) },
      { ...valid, description: 'x'.repeat(4001) },
      { ...valid, position: -1 },
      { ...valid, position: 1.5 },
      { ...valid, position: 2147483648 },
      { _tag: 'Delete', collectionId },
      { _tag: 'Archive', collectionId, questionIds: [] },
      { _tag: 'AddItems', collectionId, questionIds: [] },
      { _tag: 'AddItems', collectionId, questionIds: [questionId, questionId] },
      { _tag: 'AddItems', collectionId, questionIds: ['invalid'] },
      { _tag: 'AddItems', collectionId, questionIds: Array(501).fill(questionId) },
    ]
  ) expect(parseBankCollectionCommand(input)).toStrictEqual(null);
  for (const _tag of ['AddItems', 'RemoveItems', 'ReorderItems'] as const) {
    const input = { _tag, collectionId, questionIds: [questionId] };
    expect(parseBankCollectionCommand(input)).toStrictEqual(input);
  }
  for (const _tag of ['Archive', 'Restore'] as const) {
    expect(parseBankCollectionCommand({ _tag, collectionId })).toStrictEqual({
      _tag,
      collectionId,
    });
  }
});

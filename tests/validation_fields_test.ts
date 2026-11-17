import { expect, test as testCase } from 'vitest';

import { parseFieldIssues, parseFieldKey } from '../lib/validation_fields.ts';

testCase('editor field parser accepts only the closed field vocabulary', () => {
  expect(parseFieldKey('correct')).toStrictEqual('correct');
  expect(parseFieldKey('general')).toStrictEqual('general');
  expect(parseFieldKey('itemId')).toStrictEqual(null);
  expect(parseFieldKey('preserveSourceXml')).toStrictEqual(null);
  expect(parseFieldKey(null)).toStrictEqual(null);
});

testCase('publish issue parser keeps messages and maps unknown fields to general', () => {
  expect(parseFieldIssues([
    { field: 'correct', message: 'Choose an answer.' },
    { field: 'itemId', message: 'Reload the item.' },
    { field: 'preserveSourceXml', message: 'Source XML is unavailable.' },
    { field: 'title' },
    null,
  ])).toStrictEqual([
    { field: 'correct', message: 'Choose an answer.' },
    { field: 'general', message: 'Reload the item.' },
    { field: 'general', message: 'Source XML is unavailable.' },
  ]);
});

import { expect, test as testCase } from 'vitest';

import { requireQaDatabaseUrl } from './helpers/qa_database.ts';

testCase(
  'browser QA accepts explicit local and CI database names without selecting a destination',
  () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      for (const database of ['qflow_test', 'qflow_ci_test']) {
        const configured = `postgresql://qa:secret@${host}:5432/${database}`;
        expect(requireQaDatabaseUrl(configured)).toStrictEqual(configured);
      }
    }
  },
);

testCase(
  'browser QA rejects missing, invalid, remote and ordinary application database configuration',
  () => {
    for (
      const value of [
        undefined,
        'not a URL',
        'https://127.0.0.1/qflow_test',
        'postgres://qa:secret@db.example.com/qflow_test',
        'postgres://qa:secret@127.0.0.1/qflow_dev',
        'postgres://qa:secret@127.0.0.1/production',
        'postgres://qa:secret@127.0.0.1/another_test',
      ]
    ) expect(() => requireQaDatabaseUrl(value)).toThrowError(Error);
  },
);

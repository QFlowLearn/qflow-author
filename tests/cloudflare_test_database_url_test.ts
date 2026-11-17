import { expect, test as testCase } from 'vitest';

import { requirePostgresDatabaseUrl } from '../tools/test_database_url.ts';

testCase('integration tests accept configured PostgreSQL databases', () => {
  const validUrls = [
    'postgres://qflow:qflow@127.0.0.1:5432/qflow_test',
    'postgresql://qflow:qflow@localhost:5432/qflow-ci',
    'postgres://qflow:qflow@[::1]:5432/test',
    'postgres://qflow:qflow@db.example.com:5432/production_like_name',
    'postgresql://qflow:qflow@10.20.30.40:5432/assessor',
  ];

  for (const url of validUrls) {
    expect(requirePostgresDatabaseUrl(url)).toStrictEqual(url);
  }
});

testCase('integration tests reject missing, malformed, and non-PostgreSQL URLs', () => {
  const invalidUrls = [
    undefined,
    'https://127.0.0.1/qflow_test',
    'not-a-url',
  ];

  for (const url of invalidUrls) {
    expect(() => requirePostgresDatabaseUrl(url)).toThrowError(Error);
  }
});

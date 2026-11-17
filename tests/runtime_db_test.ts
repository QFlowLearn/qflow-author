import { expect, test as testCase } from 'vitest';

import { getDb, shutdownDb, withHyperdriveDatabase } from '../lib/db.ts';

testCase('getDb caches clients by database URL instead of request state', async () => {
  const runtime = {
    state: {},
    bindings: { DATABASE_URL: 'postgres://qflow:qflow@127.0.0.1:5432/qflow_runtime_test' },
  };

  const first = getDb(runtime);
  const second = getDb(runtime);

  expect(second).toBe(first);
  expect((runtime.state as { db?: unknown }).db).toStrictEqual(undefined);
  expect((runtime.state as { dbClient?: unknown }).dbClient).toStrictEqual(undefined);

  await shutdownDb(runtime);
});

testCase('getDb does not cache Hyperdrive clients at module scope', () => {
  const runtime = {
    state: {},
    bindings: {
      QFLOW_DB: { connectionString: 'postgres://qflow:qflow@127.0.0.1:5432/qflow_runtime_test' },
    },
  };

  const first = getDb(runtime);
  const second = getDb(runtime);

  expect(second).not.toBe(first);
  expect((runtime.state as { db?: unknown }).db).toStrictEqual(undefined);
  expect((runtime.state as { dbClient?: unknown }).dbClient).toStrictEqual(undefined);
});

testCase(
  'step-owned databases require a complete Hyperdrive binding and never use a direct URL instead',
  async () => {
    for (
      const QFLOW_DB of [
        undefined,
        null,
        {},
        { connectionString: '' },
        { connectionString: 'https://db.example/qflow' },
      ]
    ) {
      await expect(
        Promise.resolve().then(() =>
          withHyperdriveDatabase(
            { bindings: { QFLOW_DB, DATABASE_URL: 'postgres://other/qflow' } },
            () => Promise.resolve(),
          )
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof Error &&
        caught.message.includes(QFLOW_DB === undefined ? 'requires the QFLOW_DB' : 'QFLOW_DB')
      );
    }
  },
);
testCase(
  'Hyperdrive transport rejects origin TLS configuration instead of silently disabling it',
  () => {
    for (const query of ['sslmode=require', 'sslmode=verify-full', 'ssl=true']) {
      expect(() =>
        getDb({
          bindings: { QFLOW_DB: { connectionString: 'postgres://origin/qflow?' + query } },
        })
      ).toThrowError(
        expect.toSatisfy((caught: unknown) =>
          caught instanceof Error && caught.message.includes('internal connection string')
        ),
      );
    }
  },
);

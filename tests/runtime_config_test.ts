import { expect, test as testCase } from 'vitest';

import { getDatabaseConfiguration, getDatabaseUrl, getEnv, requireEnv } from '../lib/config.ts';
import { getDb } from '../lib/db.ts';
import {
  getRuntimeBinding,
  getRuntimeState,
  getRuntimeStringBinding,
  installRuntime,
  normalizeRuntime,
  type QflowRuntime,
  type QflowRuntimeState,
} from '../lib/runtime.ts';
import { runWithRequestRuntime } from '../lib/server/request_runtime_context.ts';
import { runnerPskIsValid } from '../lib/http/middleware/auth_context.ts';

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

testCase('runtime bindings override process env without breaking Deno fallback', () => {
  const previous = process.env['QFLOW_RUNTIME_TEST'];
  try {
    process.env['QFLOW_RUNTIME_TEST'] = 'deno-value';

    expect(getEnv('QFLOW_RUNTIME_TEST')).toStrictEqual('deno-value');
    expect(getEnv('QFLOW_RUNTIME_TEST', { bindings: { QFLOW_RUNTIME_TEST: 'runtime-value' } }))
      .toStrictEqual('runtime-value');
  } finally {
    restoreEnv('QFLOW_RUNTIME_TEST', previous);
  }
});

testCase('runtime config helpers require injected or process env values', () => {
  const previous = process.env['DATABASE_URL'];
  try {
    delete process.env['DATABASE_URL'];

    expect(getDatabaseUrl({ bindings: { DATABASE_URL: 'postgres://runtime.example/qflow' } }))
      .toStrictEqual('postgres://runtime.example/qflow');
    expect(requireEnv('DATABASE_URL', {
      bindings: { DATABASE_URL: 'postgres://bindings.example/qflow' },
    })).toStrictEqual('postgres://bindings.example/qflow');
    expect(() => getDatabaseUrl()).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('Missing required database connection')
      ),
    );
  } finally {
    restoreEnv('DATABASE_URL', previous);
  }
});

testCase('database URL can come from Cloudflare Hyperdrive binding', () => {
  const previous = process.env['DATABASE_URL'];
  try {
    process.env['DATABASE_URL'] = 'postgres://deno.example/qflow';

    expect(getDatabaseUrl({
      bindings: {
        DATABASE_URL: 'postgres://runtime.example/qflow',
        QFLOW_DB: { connectionString: 'postgres://hyperdrive.example/qflow' },
      },
    })).toStrictEqual('postgres://hyperdrive.example/qflow');
  } finally {
    restoreEnv('DATABASE_URL', previous);
  }
});

testCase('runtime helpers normalize Fresh contexts with canonical bindings', () => {
  const state: QflowRuntimeState = {};
  const binding = { queue: true };
  const runtime = normalizeRuntime({
    state,
    bindings: { QFLOW_QUEUE: binding, QFLOW_ROOT_DOMAIN: 'bindings.example' },
  });

  expect(getRuntimeState(runtime)).toStrictEqual(state);
  expect(getRuntimeBinding(runtime, 'QFLOW_QUEUE')).toStrictEqual(binding);
  expect(getRuntimeStringBinding(runtime, 'QFLOW_ROOT_DOMAIN')).toStrictEqual('bindings.example');
});

testCase('installRuntime stores request runtime on state for downstream lookups', () => {
  const state: QflowRuntimeState = {};
  const ctx: QflowRuntime = {
    state,
    bindings: {
      QFLOW_ROOT_DOMAIN: 'request.example',
      QFLOW_UPLOADS: { bucket: true },
    },
  };

  const runtime = installRuntime(ctx);

  expect(state.runtime).toStrictEqual(runtime);
  expect(getEnv('QFLOW_ROOT_DOMAIN', ctx)).toStrictEqual('request.example');
  expect(getRuntimeBinding(state, 'QFLOW_UPLOADS')).toStrictEqual({ bucket: true });
});

testCase('installRuntime recovers Cloudflare bindings from the canonical request scope', () => {
  const qflowDb = { connectionString: 'postgres://hyperdrive.example/qflow' };
  const qflowUploads = { bucket: true };
  const state: QflowRuntimeState = {};
  const ctx: QflowRuntime = { state };

  runWithRequestRuntime({
    bindings: {
      QFLOW_DB: qflowDb,
      QFLOW_UPLOADS: qflowUploads,
    },
  }, () => {
    installRuntime(ctx);

    expect(getRuntimeBinding(ctx, 'QFLOW_DB')).toStrictEqual(qflowDb);
    expect(getRuntimeBinding(state, 'QFLOW_UPLOADS')).toStrictEqual(qflowUploads);
    expect(getDatabaseUrl(ctx)).toStrictEqual('postgres://hyperdrive.example/qflow');
  });
});

testCase('request runtimes remain isolated when requests overlap', async () => {
  expect(getRuntimeBinding(undefined, 'QFLOW_ROOT_DOMAIN')).toStrictEqual(undefined);

  const observed = await Promise.all([
    runWithRequestRuntime(
      { bindings: { QFLOW_ROOT_DOMAIN: 'first.example' } },
      async () => {
        await Promise.resolve();
        return getRuntimeBinding(undefined, 'QFLOW_ROOT_DOMAIN');
      },
    ),
    runWithRequestRuntime(
      { bindings: { QFLOW_ROOT_DOMAIN: 'second.example' } },
      async () => {
        await Promise.resolve();
        return getRuntimeBinding(undefined, 'QFLOW_ROOT_DOMAIN');
      },
    ),
  ]);
  expect(observed).toStrictEqual(['first.example', 'second.example']);
  expect(getRuntimeBinding(undefined, 'QFLOW_ROOT_DOMAIN')).toStrictEqual(undefined);
});

testCase('Hyperdrive database clients are owned once per request scope', () => {
  const binding = { connectionString: 'postgres://hyperdrive.example/qflow' };

  runWithRequestRuntime({ bindings: { QFLOW_DB: binding } }, () => {
    expect(getDb()).toStrictEqual(getDb());
  });
});

testCase('Hyperdrive database clients are never shared across request scopes', () => {
  const binding = { connectionString: 'postgres://hyperdrive.example/qflow' };
  const first = runWithRequestRuntime({ bindings: { QFLOW_DB: binding } }, () => getDb());
  const second = runWithRequestRuntime({ bindings: { QFLOW_DB: binding } }, () => getDb());

  expect(first).not.toStrictEqual(second);
});

testCase('one request cannot silently switch Hyperdrive bindings', () => {
  const first = { connectionString: 'postgres://first-hyperdrive.example/qflow' };
  const second = { connectionString: 'postgres://second-hyperdrive.example/qflow' };

  runWithRequestRuntime({ bindings: { QFLOW_DB: first } }, () => {
    getDb();
    expect(() => getDb({ bindings: { QFLOW_DB: second } })).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error &&
        caught.message.includes('Hyperdrive binding changed within one request')
      ),
    );
  });
});

testCase('runner PSK can be read from request runtime bindings', () => {
  const req = new Request('https://qflow.example/api/assessments/a1/package', {
    headers: { 'x-runner-key': 'secret' },
  });

  expect(runnerPskIsValid(req, 'a1', { bindings: { QFLOW_RUNNER_KEY: 'secret' } })).toStrictEqual(
    true,
  );
  expect(runnerPskIsValid(req, 'a1', { bindings: { QFLOW_RUNNER_KEY: 'other' } })).toStrictEqual(
    false,
  );
});

testCase('present-invalid Hyperdrive never selects the configured direct database', () => {
  for (
    const binding of [
      null,
      false,
      '',
      {},
      { connectionString: '' },
      { connectionString: 3 },
      { connectionString: 'not-a-url' },
      { connectionString: 'https://db.example/qflow' },
      { connectionString: 'postgres://db.example' },
      { connectionString: 'postgres://db.example/' },
    ]
  ) {
    const runtime = {
      bindings: { QFLOW_DB: binding, DATABASE_URL: 'postgres://direct.example/qflow' },
    };
    expect(() => getDatabaseUrl(runtime)).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('QFLOW_DB')
      ),
    );
    expect(() => getDb(runtime)).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('QFLOW_DB')
      ),
    );
  }
});

testCase('database mode validates direct configuration and preserves binding identity', () => {
  expect(
    getDatabaseConfiguration({ bindings: { DATABASE_URL: 'postgresql://direct.example/qflow' } }),
  ).toStrictEqual({ _tag: 'Direct', url: 'postgresql://direct.example/qflow' });
  for (const value of ['', 'not-a-url', 'https://db.example/qflow', 'postgres://db.example']) {
    expect(() => getDatabaseConfiguration({ bindings: { DATABASE_URL: value } })).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('DATABASE_URL')
      ),
    );
  }
  const binding = { connectionString: 'postgres://hyperdrive.example/qflow' };
  const configuration = getDatabaseConfiguration({ bindings: { QFLOW_DB: binding } });
  expect(configuration._tag).toStrictEqual('Hyperdrive');
  if (configuration._tag === 'Hyperdrive') expect(configuration.binding).toStrictEqual(binding);
});

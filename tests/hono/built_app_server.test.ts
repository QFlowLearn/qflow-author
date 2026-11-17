import { expect, it } from 'vitest';
import { builtWorkerBrowserEnvironment } from '../helpers/built_worker_environment.ts';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertAvailablePort } from '../../tools/built_app_server.ts';
import { createServer } from 'node:net';
import { startBuiltAppServer } from '../../tools/built_app_server.ts';

function workerSource(status = 200): string {
  return `const worker = { fetch() { return new Response('ready', { status: ${status} }); } };
export default worker;
export function createLocalWorker() { return worker; }`;
}

async function fixture(source: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'qflow-built-server-test-'));
  await mkdir(`${cwd}/build/ssr`, { recursive: true });
  await mkdir(`${cwd}/build/print_renderer`, { recursive: true });
  await mkdir(`${cwd}/build/client/.vite`, { recursive: true });
  await writeFile(`${cwd}/package.json`, '{"type":"module"}');
  await writeFile(`${cwd}/build/ssr/index.js`, source);
  await writeFile(`${cwd}/build/client/.vite/manifest.json`, '{}');
  const config = {
    name: 'owned-worker-fixture',
    main: 'index.js',
    compatibility_date: '2026-06-03',
    compatibility_flags: ['nodejs_compat'],
    rules: [{ type: 'ESModule', globs: ['**/*.js'] }],
    userConfigPath: `${cwd}/wrangler.jsonc`,
  };
  await writeFile(`${cwd}/build/print_renderer/index.js`, workerSource());
  await writeFile(
    `${cwd}/build/print_renderer/wrangler.json`,
    JSON.stringify({
      name: 'owned-print-renderer-fixture',
      main: 'index.js',
      compatibility_date: config.compatibility_date,
      compatibility_flags: config.compatibility_flags,
      rules: config.rules,
    }),
  );
  await writeFile(`${cwd}/build/ssr/wrangler.json`, JSON.stringify(config));
  await writeFile(`${cwd}/wrangler.jsonc`, '{}');
  return cwd;
}

it('built app owns a ready real subprocess and releases its configured port on close', async () => {
  const cwd = await fixture(workerSource());
  try {
    const app = await startBuiltAppServer({
      mode: 'qa',
      cwd,
      port: 55891,
      environment: {
        ...builtWorkerBrowserEnvironment,
        QFLOW_WRANGLER_CONFIG: 'wrangler.jsonc',
        DATABASE_URL: 'postgres://qa:fixture@127.0.0.1:5432/qflow_test',
      },
    });
    expect(await (await fetch(`${app.baseUrl}/health`)).text()).toBe('ready');
    await app.close();
    await app.close();
    expect(Number.isInteger((await app.exited).code)).toBe(true);
    await assertAvailablePort(55891);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 15000);

it('built startup rejects process exit, missing assets and occupied explicit ports', async () => {
  const cwd = await fixture(
    "export function createLocalWorker() { throw new Error('fixture startup rejection'); } export default {};",
  );
  try {
    await expect((() =>
      startBuiltAppServer({
        mode: 'qa',
        cwd,
        port: 55892,
        environment: {
          ...builtWorkerBrowserEnvironment,
          QFLOW_WRANGLER_CONFIG: 'wrangler.jsonc',
          DATABASE_URL: 'postgres://qa:fixture@127.0.0.1:5432/qflow_test',
        },
      }))()).rejects.toBeInstanceOf(Error);
    const listener = createServer();
    await new Promise<void>((done) => listener.listen(55892, '127.0.0.1', done));
    try {
      await expect((() =>
        startBuiltAppServer({
          mode: 'qa',
          cwd,
          port: 55892,
          environment: {
            ...builtWorkerBrowserEnvironment,
            QFLOW_WRANGLER_CONFIG: 'wrangler.jsonc',
            DATABASE_URL: 'postgres://qa:fixture@127.0.0.1:5432/qflow_test',
          },
        }))()).rejects.toBeInstanceOf(Error);
    } finally {
      await new Promise<void>((done, reject) =>
        listener.close((cause) => cause ? reject(cause) : done())
      );
    }
    await rm(`${cwd}/build/ssr/index.js`);
    await expect((() =>
      startBuiltAppServer({
        mode: 'qa',
        cwd,
        port: 55892,
        environment: {
          ...builtWorkerBrowserEnvironment,
          QFLOW_WRANGLER_CONFIG: 'wrangler.jsonc',
          DATABASE_URL: 'postgres://qa:fixture@127.0.0.1:5432/qflow_test',
        },
      }))()).rejects.toBeInstanceOf(Error);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 15000);

it(
  'built app cancellation during readiness closes the real server and releases its port',
  async () => {
    const cwd = await fixture(
      workerSource(503),
    );
    const controller = new AbortController();
    const opened = startBuiltAppServer({
      mode: 'qa',
      cwd,
      port: 55894,
      environment: {
        ...builtWorkerBrowserEnvironment,
        QFLOW_WRANGLER_CONFIG: 'wrangler.jsonc',
        DATABASE_URL: 'postgres://qa:fixture@127.0.0.1:5432/qflow_test',
      },
      signal: controller.signal,
    });
    // Attach rejection ownership immediately while the real server starts.
    const rejected = expect(opened).rejects.toThrowError(/Built app startup failed/);
    const timer = setTimeout(() => controller.abort(), 200);
    try {
      await rejected;
      await assertAvailablePort(55894);
    } finally {
      clearTimeout(timer);
      controller.abort();
      await rm(cwd, { recursive: true, force: true });
    }
  },
  15000,
);

it(
  'built app startup observes cancellation during asset reads before signal registration',
  async () => {
    const cwd = await fixture(workerSource());
    const controller = new AbortController();
    try {
      const pending = startBuiltAppServer({
        mode: 'qa',
        cwd,
        port: 55895,
        environment: {
          ...builtWorkerBrowserEnvironment,
          QFLOW_WRANGLER_CONFIG: 'wrangler.jsonc',
          DATABASE_URL: 'postgres://qa:fixture@127.0.0.1:5432/qflow_test',
        },
        signal: controller.signal,
      });
      controller.abort();
      await expect(pending).rejects.toThrowError(/Built app startup failed/);
      await assertAvailablePort(55895);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
  15000,
);

import {
  getWorkerBundleDir,
  writeRootConfig,
  writeWorkerConfig,
} from '@cloudflare/build-output-utils';
import { WorkerConfigSchema } from '@cloudflare/config';
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
  await mkdir(`${cwd}/.cloudflare/output/v1/workers/default/assets/.vite`, { recursive: true });
  await writeFile(`${cwd}/.cloudflare/output/v1/workers/default/assets/.vite/manifest.json`, '{}');
  await writeFile(`${cwd}/package.json`, '{"type":"module"}');
  await writeRootConfig({ root: cwd, buildContext: { mode: 'production', isPreview: false } });
  for (
    const [directoryName, name, contents] of [['default', 'owned-worker-fixture', source], [
      'renderer',
      'owned-print-renderer-fixture',
      workerSource(),
    ]]
  ) {
    const bundle = getWorkerBundleDir(cwd, directoryName);
    await mkdir(bundle, { recursive: true });
    await writeFile(join(bundle, 'index.js'), contents);
    await writeWorkerConfig({
      root: cwd,
      directoryName,
      config: WorkerConfigSchema.parse({
        name,
        compatibilityDate: '2026-06-03',
        compatibilityFlags: ['nodejs_compat'],
        env: directoryName === 'default'
          ? { QFLOW_PRINT_RENDERER: { type: 'worker', worker: 'owned-print-renderer-fixture' } }
          : {},
      }),
      manifest: { type: 'partial', mainModule: 'index.js', modules: {} },
    });
  }
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
            DATABASE_URL: 'postgres://qa:fixture@127.0.0.1:5432/qflow_test',
          },
        }))()).rejects.toBeInstanceOf(Error);
    } finally {
      await new Promise<void>((done, reject) =>
        listener.close((cause) => cause ? reject(cause) : done())
      );
    }
    await rm(join(getWorkerBundleDir(cwd), 'index.js'));
    await expect((() =>
      startBuiltAppServer({
        mode: 'qa',
        cwd,
        port: 55892,
        environment: {
          ...builtWorkerBrowserEnvironment,
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

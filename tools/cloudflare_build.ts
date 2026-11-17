import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type BuildOutputWorker, readBuildOutput } from '@cloudflare/build-output-utils';
import { resolveLocalBindings, type WorkerOptions, WorkerOptionsSchema } from 'miniflare';

/** Read the versioned output through Cloudflare's validator; no legacy build paths. */
export async function readAuthorBuild(cwd = process.cwd()) {
  const output = await readBuildOutput(cwd);
  const app = output.workers.default;
  const target = app.config.env?.QFLOW_PRINT_RENDERER;
  if (target?.type !== 'worker') throw Error('Built print renderer service is required.');
  const renderer = Object.values(output.workers).find((worker) =>
    worker.config.name === target.worker
  );
  if (!renderer) throw Error('Build the separate print renderer before starting Author.');
  return { output, app, renderer };
}

/** Resolve declared module bytes and local capabilities for the native Miniflare configuration. */
export async function builtWorkerOptions(
  worker: BuildOutputWorker,
  localEnv: Record<string, string>,
): Promise<WorkerOptions> {
  const { manifest, ...config } = worker.config;
  if (!manifest || !worker.bundleDir) throw Error('Built Worker modules are required.');
  const modules: NonNullable<WorkerOptions['config']['manifest']>['modules'] = {};
  for (const [name, descriptor] of Object.entries(manifest.modules)) {
    modules[name] = {
      type: descriptor.type,
      contents: Uint8Array.from(await readFile(resolve(worker.bundleDir, name))),
    };
  }
  return WorkerOptionsSchema.parse({
    config: {
      ...config,
      manifest: { mainModule: manifest.mainModule, modulesRoot: worker.bundleDir, modules },
      env: resolveLocalBindings(config.env, {
        workerName: config.name,
        localEnv,
        mode: 'development',
        remoteBindings: false,
        logger: console,
      }),
      assets: worker.assetsDir
        ? { ...config.assets, directory: worker.assetsDir, hasUserWorker: true }
        : undefined,
    },
  });
}

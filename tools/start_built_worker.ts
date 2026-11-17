import { resolve } from 'node:path';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { Miniflare, type WorkerOptions } from 'miniflare';
import { unstable_getMiniflareWorkerOptions, unstable_readConfig } from 'wrangler';
import { requireQaDatabaseUrl } from '../tests/helpers/qa_database.ts';
import { localDatabaseUrl, parseLocalConfig } from './local_config.ts';

/** Start the built application with declared capabilities and an explicit QA or development database. */
export async function startBuiltWorker(options: {
  readonly databaseUrl: string | null;
  readonly mode: 'qa' | 'development';
  readonly port?: number;
  readonly bindings?: Readonly<Record<string, string>>;
  /** Diagnostic Workers may replace the entry and outbound service, keeping configuration ownership here. */
  readonly workerOverrides?: Pick<
    Extract<WorkerOptions, { script: string }>,
    'script' | 'scriptPath' | 'outboundService' | 'workflows'
  >;
}): Promise<Miniflare> {
  const databaseUrl = options.databaseUrl === null
    ? null
    : options.mode === 'qa'
    ? requireQaDatabaseUrl(options.databaseUrl)
    : localDatabaseUrl(options.databaseUrl);
  const local = options.mode === 'development' ? parseLocalConfig(process.env) : undefined;
  const selected = process.env.QFLOW_WRANGLER_CONFIG;
  if (!selected) throw new Error('QFLOW_WRANGLER_CONFIG is required.');
  const generated: unknown = JSON.parse(await readFile('build/ssr/wrangler.json', 'utf8'));
  const origin: unknown = generated && typeof generated === 'object'
    ? Reflect.get(generated, 'userConfigPath')
    : undefined;
  if (
    typeof origin !== 'string' ||
    await realpath(origin) !== await realpath(resolve(selected))
  ) {
    throw new Error('Built Worker does not match the selected Wrangler configuration.');
  }
  const config = unstable_readConfig({ config: resolve('build/ssr/wrangler.json') });
  // Do not let private local connection strings or ambient Hyperdrive overrides select a database.
  config.hyperdrive = [];
  const { workerOptions, main, externalWorkers } = unstable_getMiniflareWorkerOptions(
    config,
    undefined,
    { overrides: { enableContainers: false } },
  );
  if (!main) throw new Error('Built Worker entry is required.');
  const rendererConfig = unstable_readConfig({
    config: resolve('build/print_renderer/wrangler.json'),
  });
  const renderer = unstable_getMiniflareWorkerOptions(rendererConfig, undefined, {
    overrides: { enableContainers: false },
  });
  if (!renderer.main) throw new Error('Built print renderer entry is required.');
  // Miniflare's cf:false still supplies synthetic metadata. Select local provenance in code,
  // rather than relying on metadata shape or an HTTP/binding override to attest ingress.
  const localEntry = resolve('build/ssr/local-preview.mjs');
  await writeFile(
    localEntry,
    `import { createLocalWorker } from './index.js';
export * from './index.js';
export default createLocalWorker(${JSON.stringify(local?.origin.origin)});\n`,
  );
  const runtime = new Miniflare({
    host: '127.0.0.1',
    port: options.port ?? 0,
    ...(local?.tls
      ? { httpsCertPath: local.tls.certificatePath, httpsKeyPath: local.tls.keyPath }
      : {}),
    cf: false,
    workers: [
      {
        ...workerOptions,
        name: config.name,
        modules: true,
        scriptPath: localEntry,
        assets: workerOptions.assets && {
          ...workerOptions.assets,
          routerConfig: {
            ...workerOptions.assets.routerConfig,
            has_user_worker: true,
          },
        },
        bindings: {
          // QA owns its fixture values. Vite's generated .dev.vars belongs only to developer preview.
          ...(options.mode === 'qa' ? config.vars : workerOptions.bindings),
          ...options.bindings,
          ...(databaseUrl === null ? { QFLOW_DB: null } : {}),
        },
        hyperdrives: databaseUrl === null ? {} : { QFLOW_DB: databaseUrl },
        ...options.workerOverrides,
      },
      {
        ...renderer.workerOptions,
        name: rendererConfig.name,
        modules: true,
        scriptPath: renderer.main,
      },
      ...externalWorkers,
      ...renderer.externalWorkers,
    ],
  });
  try {
    await runtime.ready;
    return runtime;
  } catch (cause: unknown) {
    await runtime.dispose();
    throw cause;
  }
}

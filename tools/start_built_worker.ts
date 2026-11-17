import { readFile } from 'node:fs/promises';
import { Miniflare, type WorkerOptions } from 'miniflare';
import { requireQaDatabaseUrl } from '../tests/helpers/qa_database.ts';
import { localDatabaseUrl, parseLocalConfig } from './local_config.ts';
import { builtWorkerOptions, readAuthorBuild } from './cloudflare_build.ts';

/** Start the built application with an explicitly owned QA or development database. */
export async function startBuiltWorker(options: {
  readonly databaseUrl: string | null;
  readonly mode: 'qa' | 'development';
  readonly port?: number;
  readonly bindings?: Readonly<Record<string, string>>;
  readonly workerOverrides?: {
    readonly script?: string;
    readonly workflows?: Record<string, never>;
    readonly outboundService?: NonNullable<WorkerOptions['dev']>['outboundService'];
  };
}): Promise<Miniflare> {
  const databaseUrl = options.databaseUrl === null
    ? null
    : options.mode === 'qa'
    ? requireQaDatabaseUrl(options.databaseUrl)
    : localDatabaseUrl(options.databaseUrl);
  const local = options.mode === 'development' ? parseLocalConfig(process.env) : undefined;
  const { app, renderer } = await readAuthorBuild();
  const localEnv = options.mode === 'development'
    ? Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] =>
        entry[1] !== undefined
      ),
    )
    : {};
  // Database selection belongs to this boundary, never to ambient Hyperdrive settings.
  delete localEnv.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_QFLOW_DB;
  const appConfig = { ...app.config, env: { ...app.config.env } };
  delete appConfig.env.QFLOW_DB;
  const worker = await builtWorkerOptions({ ...app, config: appConfig }, localEnv);
  const compiler = await builtWorkerOptions(renderer, {});
  const manifest = worker.config.manifest;
  if (!manifest) throw Error('Built Worker entry is required.');
  const overrides = options.workerOverrides;
  const main = '__qflow_local_preview.mjs';
  const wrapper = overrides?.script ?? `import {createLocalWorker} from './${manifest.mainModule}';
export * from './${manifest.mainModule}';
export default createLocalWorker(${JSON.stringify(local?.origin.origin)});`;
  const env: NonNullable<WorkerOptions['config']['env']> = { ...worker.config.env };
  for (const [name, value] of Object.entries({ ...localEnv, ...options.bindings })) {
    if (
      name.startsWith('QFLOW_') || name === 'OPENROUTER_API_KEY' ||
      Object.hasOwn(options.bindings ?? {}, name)
    ) {
      env[name] = { type: 'text', value };
    }
  }
  if (databaseUrl === null) env.QFLOW_DB = { type: 'json', value: null };
  else {
    env.QFLOW_DB = {
      type: 'hyperdrive',
      id: '00000000000000000000000000000000',
      dev: { connectionString: databaseUrl },
    };
  }
  if (overrides?.workflows) {
    for (const [name, binding] of Object.entries(env)) {
      if (binding.type === 'workflow') delete env[name];
    }
  }
  const runtime = new Miniflare({
    host: '127.0.0.1',
    port: options.port ?? 0,
    cf: false,
    ...(local?.tls
      ? {
        https: true,
        httpsCert: await readFile(local.tls.certificatePath, 'utf8'),
        httpsKey: await readFile(local.tls.keyPath, 'utf8'),
      }
      : {}),
    workers: [{
      ...worker,
      config: {
        ...worker.config,
        env,
        exports: overrides?.workflows ? {} : worker.config.exports,
        manifest: {
          ...manifest,
          mainModule: main,
          modules: { ...manifest.modules, [main]: { type: 'esm', contents: wrapper } },
        },
      },
      dev: { ...worker.dev, outboundService: overrides?.outboundService },
    }, compiler],
  });
  try {
    await runtime.ready;
    return runtime;
  } catch (cause: unknown) {
    await runtime.dispose();
    throw cause;
  }
}

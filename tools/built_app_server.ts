import { readFile, realpath, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { requireQaDatabaseUrl } from '../tests/helpers/qa_database.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { localCa, localTls, parseLocalConfig } from './local_config.ts';

/** Owned production runtime process, observed until it exits and awaited during cleanup. */
export type BuiltAppServer = {
  readonly baseUrl: string;
  readonly exited: Promise<{ readonly code: number; readonly success: boolean }>;
  close(): Promise<void>;
};

/** Start the selected built application under workerd with explicit QA or development ownership. */
export async function startBuiltAppServer(input: {
  readonly cwd: string;
  readonly port: number;
  readonly environment: Readonly<Record<string, string>>;
  readonly mode: 'qa' | 'development';
  readonly signal?: AbortSignal;
}): Promise<BuiltAppServer> {
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error('Built app port must be an integer from 1 through 65535.');
  }
  const environment = { ...process.env, ...input.environment };
  const configured = environment.QFLOW_WRANGLER_CONFIG;
  if (!configured) throw new Error('QFLOW_WRANGLER_CONFIG is required for built browser runs.');
  const local = input.mode === 'development' ? parseLocalConfig(environment, input.cwd) : undefined;
  if (local) {
    localTls(local);
    if (input.port !== Number(local.listenOrigin.port)) {
      throw Error(
        'Preview must use the configured local origin port. Stop pnpm dev before previewing.',
      );
    }
  } else requireQaDatabaseUrl(environment.DATABASE_URL);
  try {
    input.signal?.throwIfAborted();
    const configPath = resolve(input.cwd, 'build/ssr/wrangler.json');
    const config: unknown = JSON.parse(await readFile(configPath, 'utf8'));
    const origin: unknown = config && typeof config === 'object'
      ? Reflect.get(config, 'userConfigPath')
      : undefined;
    if (
      typeof origin !== 'string' ||
      await realpath(origin) !== await realpath(resolve(input.cwd, configured))
    ) {
      throw new Error('Built Worker does not match the selected Wrangler configuration.');
    }
    for (
      const path of ['build/ssr/index.js', 'build/client/.vite/manifest.json']
    ) {
      const asset = await stat(resolve(input.cwd, path));
      if (!asset.isFile() || asset.size === 0) {
        throw new Error('Required built Worker assets are missing.');
      }
    }
    input.signal?.throwIfAborted();
    // Occupied explicit ports fail. The owner chooses a range before starting this resource.
    await assertAvailablePort(input.port);
    input.signal?.throwIfAborted();
  } catch (cause: unknown) {
    throw new Error(`Built app startup failed: ${safeErrorSummary(cause)}`, { cause });
  }
  const child = spawn(process.execPath, [
    '--import',
    import.meta.resolve('tsx'),
    fileURLToPath(new URL('./built_app_worker.ts', import.meta.url)),
    String(input.port),
    input.mode,
  ], { cwd: input.cwd, env: environment, stdio: ['ignore', 'inherit', 'inherit'] });
  const exited = new Promise<{ code: number; success: boolean }>((done, reject) => {
    child.once('error', reject);
    child.once('close', (code) => done({ code: code ?? 1, success: code === 0 }));
  });
  const baseUrl = local ? local.listenOrigin.origin : `http://127.0.0.1:${input.port}`;
  let closing: Promise<void> | undefined;
  const close = () =>
    closing ??= (async () => {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    })();
  const startup = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, startup.signal]) : startup.signal;
  try {
    await Promise.race([
      waitForBuiltApp(baseUrl, signal, local ? localCa(local) : undefined),
      exited.then(() => {
        throw new Error('Built app exited before readiness.');
      }),
    ]);
    input.signal?.throwIfAborted();
    return { baseUrl, exited, close };
  } catch (cause: unknown) {
    await close();
    throw new Error(`Built app startup failed: ${safeErrorSummary(cause)}`, { cause });
  } finally {
    startup.abort();
  }
}

/** Check an explicit loopback port without changing it or leaving a listener running. */
export function assertAvailablePort(port: number): Promise<void> {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close((cause) => cause ? reject(cause) : done()));
  });
}

async function waitForBuiltApp(
  baseUrl: string,
  signal: AbortSignal,
  ca: Buffer | undefined,
): Promise<void> {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const ready = await new Promise<boolean>((done, reject) => {
        const get = ca ? httpsGet : httpGet;
        const request = get(`${baseUrl}/health`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
          ...(ca ? { ca } : {}),
        }, (response) => {
          response.resume();
          response.once('error', reject);
          response.once('end', () => done(response.statusCode === 200));
        });
        request.once('error', reject);
      });
      if (ready) return;
    } catch (cause: unknown) {
      signal.throwIfAborted();
      const code: unknown = cause && typeof cause === 'object'
        ? Reflect.get(cause, 'code')
        : undefined;
      if (typeof code !== 'string' || !['ECONNREFUSED', 'ECONNRESET', 'ABORT_ERR'].includes(code)) {
        throw cause;
      }
    }
    await delay(100, undefined, { signal });
  }
  throw new Error('Built app did not become healthy within 45 seconds.');
}

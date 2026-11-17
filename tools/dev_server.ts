import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { engines } from '../package.json' with { type: 'json' };
import {
  assertSingleLocalEnvironment,
  LocalConfigurationError,
  localTls,
  parseLocalConfig,
} from './local_config.ts';
import { localDatabaseStatus } from './local_database.ts';

/** Own the stylesheet watcher and the single Vite application process until both have closed. */
export async function runDevelopment(args: readonly string[]): Promise<void> {
  if (args.length) {
    throw new LocalConfigurationError(
      'Use pnpm dev without arguments. The local origin is configured by pnpm setup:local.',
    );
  }
  if (process.versions.node !== engines.node) {
    throw new LocalConfigurationError(`Use Node ${engines.node}; see .node-version.`);
  }
  assertSingleLocalEnvironment();
  const config = parseLocalConfig(process.env);
  localTls(config);
  const database = await localDatabaseStatus(config.databaseUrl);
  if (!database.ok) throw new LocalConfigurationError(database.message);
  console.log(`QFlow browser URL: ${config.origin.origin}`);
  const children: ChildProcess[] = [];
  let stopping = false;
  let cancelled = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    deadline = setTimeout(() => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    }, 5000);
  };
  const start = (entry: string, commandArgs: readonly string[]) => {
    const child = spawn(process.execPath, [entry, ...commandArgs], { stdio: 'inherit' });
    children.push(child);
    return new Promise<number>((resolve, reject) => {
      let failure: unknown;
      child.once('error', (cause: unknown) => {
        failure = cause;
        stop();
      });
      child.once('close', (code) => {
        stop();
        if (failure) reject(failure);
        else resolve(code ?? 1);
      });
    });
  };
  const cancel = () => {
    cancelled = true;
    stop();
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const statuses = await Promise.allSettled([
      start(
        fileURLToPath(
          new URL('./dist/index.mjs', import.meta.resolve('@tailwindcss/cli/package.json')),
        ),
        [
          '-i',
          'static/tailwind.css',
          '-o',
          'static/tw.css',
          '--watch=always',
        ],
      ),
      start(fileURLToPath(new URL('./bin/vite.js', import.meta.resolve('vite/package.json'))), [
        ...args,
      ]),
    ]);
    if (
      statuses.some((status) => status.status === 'rejected' || (!cancelled && status.value !== 0))
    ) {
      throw new Error('Development process failed.');
    }
  } finally {
    stop();
    clearTimeout(deadline);
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}
if (import.meta.main) {
  try {
    await runDevelopment(process.argv.slice(2));
  } catch (cause: unknown) {
    console.error(
      cause instanceof LocalConfigurationError
        ? cause.message
        : `Development startup failed: ${safeErrorSummary(cause)}. Run pnpm run doctor.`,
    );
    process.exitCode = 1;
  }
}

import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runCommand, vitestCli } from '../process_command.ts';
import { optional, testLane } from './lanes.ts';
import { qaDatabase } from './database.ts';
import { testEnvironment } from './environment.ts';
import { parseTestCommand, TestCommandError, testCommandHelp } from './command.ts';
import { safeErrorSummary } from '../../lib/error_summary.ts';
/** Run registered suites; one-shot verification rejects skips outside documented optional lanes. */
export async function runLane(
  lane: 'ordinary' | 'browser',
  environment: NodeJS.ProcessEnv,
  options: {
    readonly files?: readonly string[];
    readonly watch?: boolean;
    readonly signal?: AbortSignal;
  } = {},
): Promise<number> {
  const selected = options.files ?? testLane(lane);
  if (!selected.length) throw new TestCommandError('Select at least one registered test file.');
  await mkdir('output/ci', { recursive: true });
  // Simultaneous focused commands must not overwrite each other's verification receipt.
  const report = options.watch
    ? undefined
    : resolve(await mkdtemp(resolve(`output/ci/${lane}-`)), 'results.json');
  const result = await runCommand(process.execPath, [
    vitestCli,
    options.watch ? 'watch' : 'run',
    '--config',
    'vitest.config.ts',
    '--reporter=default',
    ...(report ? ['--reporter=json', `--outputFile.json=${report}`] : []),
    ...selected,
  ], {
    output: 'inherit',
    stdin: options.watch ? 'inherit' : 'ignore',
    signal: options.signal,
    env: {
      ...testEnvironment(environment),
      ...(lane === 'browser' ? { QFLOW_BROWSER_TESTS: '1' } : {}),
    },
  });
  options.signal?.throwIfAborted();
  // Watch owns its interactive cancellation/failure status; do not turn a normal exit into a defect.
  if (options.watch) return result.code;
  if (!result.success) throw Error(`${lane} tests failed.`);
  if (!report) throw Error('One-shot runs require a verification report.');
  const decoded: unknown = JSON.parse(await readFile(report, 'utf8'));
  if (!decoded || typeof decoded !== 'object') throw Error('Missing runner report.');
  const files: unknown = Reflect.get(decoded, 'testResults');
  if (!Array.isArray(files)) throw Error('Missing runner files.');
  const remaining = new Set(selected.map((file) => resolve(file)));
  for (const file of files) {
    if (!file || typeof file !== 'object') throw Error('Invalid runner file.');
    const name: unknown = Reflect.get(file, 'name'),
      tests: unknown = Reflect.get(file, 'assertionResults');
    if (typeof name !== 'string' || !Array.isArray(tests)) {
      throw Error('Missing runner assertions.');
    }
    if (!remaining.delete(resolve(name))) {
      throw Error('Runner report contains an unselected test file.');
    }
    for (const test of tests) {
      if (!test || typeof test !== 'object') throw Error('Invalid runner assertion.');
      if (
        Reflect.get(test, 'status') !== 'passed' &&
        !Object.entries(optional).some(([path, lane]) =>
          resolve(path) === name &&
          (lane.flag === 'QFLOW_ARC_PACKAGE'
            ? !environment[lane.flag]
            : environment[lane.flag] !== '1')
        )
      ) throw Error('Required test did not pass: ' + name);
    }
  }
  if (remaining.size) throw Error('Runner report omitted selected test files.');
  return 0;
}

/** Both Worker projects share one guarded database and one pinned Vitest executable. */
export async function runWorkerTests(
  environment: NodeJS.ProcessEnv,
  options: { readonly signal?: AbortSignal } = {},
): Promise<void> {
  for (const config of ['vitest.cloudflare.config.mts', 'vitest.cloudflare-web.config.mts']) {
    const result = await runCommand(process.execPath, [vitestCli, 'run', '--config', config], {
      env: testEnvironment(environment),
      signal: options.signal,
      output: 'inherit',
    });
    if (!result.success) throw Error('Worker tests failed.');
  }
}

/** Own a conventional test invocation while keeping the same database and environment guards. */
export async function runTests(
  args: readonly string[],
  options: { readonly signal?: AbortSignal } = {},
): Promise<number> {
  const command = parseTestCommand(args);
  if (command.kind === 'help') {
    console.log(testCommandHelp);
    return 0;
  }
  options.signal?.throwIfAborted();
  // The PostgreSQL preflight has no AbortSignal API; check cancellation on both sides.
  const databaseUrl = await qaDatabase(command.database);
  options.signal?.throwIfAborted();
  const environment = { ...process.env, DATABASE_URL: databaseUrl };
  if (command.kind === 'suite') {
    return runLane(command.lane, environment, {
      files: command.files,
      watch: command.watch,
      signal: options.signal,
    });
  }
  if (command.kind === 'worker') {
    await runWorkerTests(environment, options);
    return 0;
  }
  const result = await runCommand(process.execPath, [
    '--import',
    'tsx',
    'tools/ci_browser.ts',
    'a11y',
  ], {
    output: 'inherit',
    signal: options.signal,
    env: { ...testEnvironment(environment), QFLOW_CI_BROWSER_PORT: '55880' },
  });
  if (!result.success) throw Error('Accessibility tests failed.');
  return 0;
}

if (import.meta.main) {
  const cancellation = new AbortController();
  const stop = () => cancellation.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    process.exitCode = await runTests(process.argv.slice(2), { signal: cancellation.signal });
  } catch (cause: unknown) {
    if (cancellation.signal.aborted) process.exitCode = 130;
    else {
      console.error(
        cause instanceof TestCommandError
          ? cause.message
          : `Test command failed: ${
            safeErrorSummary(cause)
          }. Use pnpm test -- --help for supported arguments.`,
      );
      process.exitCode = 1;
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

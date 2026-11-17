import { vitestCli } from './process_command.ts';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _url from 'node:url';
import { builtWorkerBrowserEnvironment } from '../tests/helpers/built_worker_environment.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { organizationBrowserEnvironment } from '../tests/helpers/organization_browser_environment.ts';
import { startBuiltAppServer } from './built_app_server.ts';
import { runBrowserChecks } from './ci_browser_process.ts';
import {
  allBrowserSuites,
  checkBrowserInventory,
  selectBrowserShard,
} from './ci_browser_partition.ts';

async function run(signal: AbortSignal): Promise<number> {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'check' && args.length === 0) {
    await checkBrowserInventory();
    return 0;
  }
  if ((mode === 'local' || mode === 'files') && args.length === 0) {
    return await runBrowserChecks({
      args: [
        vitestCli,
        'run',
        '--config',
        'vitest.config.ts',
        ...allBrowserSuites().map((suite) => suite.file),
      ],
      environment: { QFLOW_BROWSER_TESTS: '1' },
      signal,
    });
  }
  if (mode !== 'shard' && mode !== 'a11y' && mode !== 'files') {
    throw new Error('Expected check, local, shard <0..3>, files <test files...>, or a11y.');
  }
  const files = mode === 'shard'
    ? args.length === 1 ? selectBrowserShard(args[0]).map((suite) => suite.file) : (() => {
      throw new Error('Exactly one shard index is required.');
    })()
    : mode === 'files'
    ? validateFiles(args)
    : [];
  if (mode === 'a11y' && args.length !== 0) throw new Error('a11y takes no arguments.');
  const databaseUrl = process.env['DATABASE_URL'];
  const rawPort = process.env['QFLOW_CI_BROWSER_PORT'];
  if (!databaseUrl || !rawPort || !/^[0-9]+$/.test(rawPort)) {
    throw new Error('DATABASE_URL and QFLOW_CI_BROWSER_PORT are required for built browser runs.');
  }
  const environment = {
    ...({ ...process.env }),
    ...organizationBrowserEnvironment,
    ...builtWorkerBrowserEnvironment,
    DATABASE_URL: databaseUrl,
    QFLOW_DELIVERY_PUBLISH_URL: '',
    QFLOW_DELIVERY_SIGNING_SECRET: '',
    QFLOW_DELIVERY_CAPABILITY_URL: '',
    QFLOW_DELIVERY_STATE_URL: '',
    ...(mode === 'a11y' ? { QFLOW_A11Y: '1' } : {}),
  };
  const app = await startBuiltAppServer({
    mode: 'qa',
    cwd: process.cwd(),
    port: Number(rawPort),
    environment,
    signal,
  });
  const started = performance.now();
  let exitCode = 1;
  const label = mode === 'shard' ? `shard-${args[0]}` : mode;
  try {
    await _fs.mkdir('output/ci', { recursive: true });
    exitCode = await runBrowserChecks({
      args: mode === 'a11y' ? ['--import', 'tsx', 'tools/a11y_check.ts'] : [
        vitestCli,
        'run',
        '--config',
        'vitest.config.ts',
        '--reporter=default',
        '--reporter=junit',
        `--outputFile.junit=output/ci/${label}.xml`,
        ...files,
      ],
      environment: {
        ...environment,
        QFLOW_BROWSER_TESTS: '1',
        QFLOW_BROWSER_APP_MODE: 'shared-built',
        QFLOW_BROWSER_APP_URL: app.baseUrl,
        QFLOW_BROWSER_APP_ENV: JSON.stringify(environment),
        ...(mode === 'a11y' ? { QFLOW_A11Y_BASE_URL: app.baseUrl } : {}),
      },
      serverExited: app.exited,
      signal,
    });
    return exitCode;
  } finally {
    await app.close();
    const elapsedSeconds = Math.round((performance.now() - started) / 1000);
    const summary = { mode, files, exitCode, elapsedSeconds };
    await _fs.mkdir('output/ci', { recursive: true });
    await _fs.writeFile(`output/ci/${label}.json`, JSON.stringify(summary, null, 2) + '\n', 'utf8');
    const markdown =
      `Browser ${label}: ${files.length} files, ${elapsedSeconds}s, exit ${exitCode}\n`;
    console.log(markdown);
    const githubSummary = process.env['GITHUB_STEP_SUMMARY'];
    if (githubSummary) await _fs.appendFile(githubSummary, markdown, 'utf8');
  }
}

function validateFiles(files: readonly string[]): readonly string[] {
  if (files.length === 0) throw new Error('files requires at least one inventoried browser file.');
  const inventory = new Set(allBrowserSuites().map((suite) => suite.file));
  if (new Set(files).size !== files.length || files.some((file) => !inventory.has(file))) {
    throw new Error('files requires unique inventoried browser files.');
  }
  return files;
}

if ((process.argv[1] && _path.resolve(process.argv[1]) === _url.fileURLToPath(import.meta.url))) {
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    process.exitCode = await run(cancellation.signal);
  } catch (cause: unknown) {
    console.error(`CI browser runner failed: ${safeErrorSummary(cause)}`);
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}

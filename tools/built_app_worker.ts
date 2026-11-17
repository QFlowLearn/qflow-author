import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBuiltWorker } from './start_built_worker.ts';
import { requireQaDatabaseUrl } from '../tests/helpers/qa_database.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { localDatabaseUrl } from './local_config.ts';

const storageConfigurationKeys = new Set([
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_FORCE_PATH_STYLE',
]);

/** Owned subprocess for QA and developer previews of the production Worker bundle. */
async function run(): Promise<void> {
  const mode = process.argv[3];
  if (mode !== 'qa' && mode !== 'development') {
    throw Error('Select the local Worker purpose explicitly.');
  }
  const databaseUrl = mode === 'qa'
    ? requireQaDatabaseUrl(process.env.DATABASE_URL)
    : localDatabaseUrl(process.env.DATABASE_URL);
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid built Worker port.');
  }
  const bindings: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if ((key.startsWith('QFLOW_') || storageConfigurationKeys.has(key)) && value !== undefined) {
      bindings[key] = value;
    }
  }
  const runtime = await startBuiltWorker({ databaseUrl, port, bindings, mode });
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= runtime.dispose();
  const cancel = () => {
    void stop().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run();
  } catch (cause: unknown) {
    console.error(`Built Worker failed: ${safeErrorSummary(cause)}`);
    process.exitCode = 1;
  }
}

import { runCommand } from '../process_command.ts';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qaDatabase } from './database.ts';
import { testEnvironment } from './environment.ts';
import { safeErrorSummary } from '../../lib/error_summary.ts';

/** Run a selected Node batch only after checking the explicitly named local QA database. */
export async function runQaBatch(args: readonly string[]): Promise<number> {
  const [selection, ...files] = args;
  if (selection !== '--database=qflow_test' && selection !== '--database=qflow_ci_test') {
    throw new Error('Explicitly select --database=qflow_test or --database=qflow_ci_test.');
  }
  if (!files.length) throw new Error('Select QA test files explicitly.');
  const databaseUrl = await qaDatabase(selection.slice('--database='.length));
  return (await runCommand(process.execPath, [
    '--import',
    'tsx',
    fileURLToPath(new URL('./batch.ts', import.meta.url)),
    ...files,
  ], { output: 'inherit', env: { ...testEnvironment(process.env), DATABASE_URL: databaseUrl } }))
    .code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2);
    process.exitCode = await runQaBatch(args);
  } catch (cause: unknown) {
    console.error(`QA batch failed: ${safeErrorSummary(cause)}`);
    process.exitCode = 1;
  }
}

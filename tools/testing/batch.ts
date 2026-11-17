import { runCommand, vitestCli } from '../process_command.ts';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { testFiles } from './files.ts';

/** Run only explicitly selected registered tests; empty selection and unknown files are errors. */
export async function runTestBatch(files: readonly string[]): Promise<number> {
  if (!files.length || new Set(files).size !== files.length) {
    throw new Error('Select unique registered test files explicitly.');
  }
  for (const file of files) {
    if (!testFiles.includes(file)) {
      throw new Error('Selected file has no registered test lane.');
    }
    if (!(await stat(file)).isFile()) throw new Error('Selected test file does not exist.');
  }
  return (await runCommand(process.execPath, [
    vitestCli,
    'run',
    '--config',
    'vitest.config.ts',
    ...files,
  ], { output: 'inherit' })).code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runTestBatch(
    process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2),
  );
}

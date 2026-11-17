import { sourceFiles } from './source_files.ts';
import { runCommand } from './process_command.ts';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** The pinned dprint plugins use the exact versions and preset of the previous formatter. */
export async function format(write: boolean): Promise<void> {
  const paths = (await sourceFiles()).filter((path) =>
    /\.(?:[cm]?[jt]s|[jt]sx|jsonc?|md)$/.test(path) && !path.startsWith('tests/fixtures/')
  );
  const result = await runCommand(process.execPath, [
    fileURLToPath(import.meta.resolve('dprint/bin.js')),
    write ? 'fmt' : 'check',
    '--config',
    'dprint.json',
    '--includes-override',
    // dprint takes glob patterns, so metacharacters in literal filenames need escaping.
    ...paths.map((path) => './' + path.replace(/[\[\]{}*?]/g, (character) => `[${character}]`)),
  ], {
    output: 'inherit',
    env: { ...process.env, DPRINT_CACHE_DIR: resolve('.artifacts/dprint-cache') },
  });
  if (!result.success) throw Error('Source formatting check failed.');
}
if (import.meta.main) await format(process.argv.includes('--write'));

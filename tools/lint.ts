import { fileURLToPath } from 'node:url';
import { runCommand } from './process_command.ts';
import { sourceFiles } from './source_files.ts';

/** Lint Git-visible JavaScript and TypeScript sources with the configured Oxlint rules. */
export async function lint(): Promise<void> {
  const paths = (await sourceFiles()).filter((path) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path));
  const result = await runCommand(process.execPath, [
    fileURLToPath(new URL('./bin/oxlint', import.meta.resolve('oxlint/package.json'))),
    '--config',
    '.oxlintrc.json',
    '--max-warnings',
    '0',
    ...paths,
  ], { output: 'inherit' });
  if (!result.success) throw Error('Source lint failed.');
}
if (import.meta.main) await lint();

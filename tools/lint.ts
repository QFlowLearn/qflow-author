import { ESLint } from 'eslint';
import { sourceFiles } from './source_files.ts';
/** Check only Git-visible source, preserving the previous tool's ignored-file boundary. */
export async function lint(): Promise<void> {
  const eslint = new ESLint({ warnIgnored: false });
  const paths = (await sourceFiles()).filter((path) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path));
  const results = await eslint.lintFiles(paths);
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) console.log(output);
  if (results.some((result) => result.errorCount > 0)) throw Error('Source lint failed.');
}
if (import.meta.main) await lint();

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
const exec = promisify(execFile);
/** The same Git-visible source boundary used by developer tooling; removed paths are excluded. */
export async function sourceFiles(): Promise<readonly string[]> {
  const { stdout } = await exec('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  const paths = [...new Set(stdout.split('\0').filter(Boolean))];
  const present = await Promise.all(paths.map(async (path) => {
    try {
      await access(path);
      return path;
    } catch (cause: unknown) {
      if (cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'ENOENT') {
        return null;
      }
      throw cause;
    }
  }));
  return present.filter((path) => path !== null).sort();
}

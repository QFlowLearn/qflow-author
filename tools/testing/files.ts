import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Vitest suite filenames; helpers and compile-time fixtures are outside this convention. */
export async function discoverTestFiles(root: string): Promise<readonly string[]> {
  return (await readdir(resolve(root, 'tests'), { recursive: true }))
    .filter((path) => /(?:_test|\.test)\.tsx?$/.test(path))
    .map((path) => `tests/${path}`).sort();
}

export const testFiles = await discoverTestFiles(resolve(import.meta.dirname, '../..'));

import * as _fs from 'node:fs/promises';
import { discoverTestFiles } from './testing/files.ts';
import { resolve } from 'node:path';
import inventory from './ci_browser_inventory.json' with { type: 'json' };

/** Duration measurements from successful hosted run 37678579695, before optimization. */
export type BrowserSuite = { readonly file: string; readonly baselineSeconds: number };
/** Four independent, serial shards with deterministic longest-suite-first balancing. */
export const BROWSER_SHARD_COUNT = 4;

/** Returns a validated balanced partition; duplicate suites and empty shards are defects. */
export function partitionBrowserSuites(
  suites: readonly BrowserSuite[] = inventory,
): readonly (readonly BrowserSuite[])[] {
  if (suites.length < BROWSER_SHARD_COUNT) {
    throw new Error('Browser inventory cannot fill four shards.');
  }
  const seen = new Set<string>();
  const shards: BrowserSuite[][] = Array.from({ length: BROWSER_SHARD_COUNT }, () => []);
  const totals = Array.from({ length: BROWSER_SHARD_COUNT }, () => 0);
  for (const suite of suites) {
    if (!/^tests\/(?:hono\/)?[a-z0-9_]+(?:\.test)?\.(ts|tsx)$/.test(suite.file)) {
      throw new Error('Browser inventory contains an invalid file.');
    }
    if (seen.has(suite.file)) throw new Error(`Duplicate browser suite: ${suite.file}`);
    if (!Number.isFinite(suite.baselineSeconds) || suite.baselineSeconds <= 0) {
      throw new Error(`Invalid duration for browser suite: ${suite.file}`);
    }
    seen.add(suite.file);
  }
  const sorted = [...suites].sort((a, b) =>
    b.baselineSeconds - a.baselineSeconds || a.file.localeCompare(b.file)
  );
  for (const suite of sorted) {
    const index = totals.indexOf(Math.min(...totals));
    shards[index].push(suite);
    totals[index] += suite.baselineSeconds;
  }
  if (shards.some((shard) => shard.length === 0)) throw new Error('Browser shard is empty.');
  return shards;
}

/** Selects one shard by its zero-based decimal CLI index, rejecting malformed/out-of-range input. */
export function selectBrowserShard(raw: string): readonly BrowserSuite[] {
  if (!/^[0-3]$/.test(raw)) throw new Error('Browser shard index must be 0, 1, 2 or 3.');
  return partitionBrowserSuites()[Number(raw)];
}

/** Lists every inventoried file exactly once for the complete local browser command. */
export function allBrowserSuites(): readonly BrowserSuite[] {
  return partitionBrowserSuites().flat();
}

/** Checks the browser shard inventory against discovered suite files and their opt-in coverage. */
export async function checkBrowserInventory(root = process.cwd()): Promise<void> {
  const testFiles = await discoverTestFiles(root);
  const inventoried = new Set(allBrowserSuites().map((suite) => suite.file));
  for (const suite of allBrowserSuites()) {
    if (!testFiles.includes(suite.file)) {
      throw Error('Browser inventory has no matching suite file: ' + suite.file);
    }
    await _fs.access(resolve(root, suite.file));
  }
  for (const file of testFiles) {
    const source = await _fs.readFile(resolve(root, file), 'utf8');
    if (
      (file.includes('_browser_test.') || file.startsWith('tests/hono/') ||
        source.includes("process.env['QFLOW_BROWSER_TESTS']")) && !inventoried.has(file)
    ) throw Error('Browser suite omitted from CI inventory: ' + file);
  }
  for (const [index, shard] of partitionBrowserSuites().entries()) {
    console.log(`Shard ${index}: ${shard.length} files; baseline ${
      Math.round(shard.reduce(
        (total, suite) => total + suite.baselineSeconds,
        0,
      ))
    } seconds`);
  }
}

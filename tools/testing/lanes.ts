import { testFiles } from './files.ts';
import browser from '../ci_browser_inventory.json' with { type: 'json' };
import optional from './optional.json' with { type: 'json' };
const browserFiles = new Set(browser.map((suite) => suite.file));
/** Explicit browser ownership keeps every previously omitted flow in normal verification and CI. */
export function testLane(lane: 'ordinary' | 'browser'): readonly string[] {
  return testFiles.filter((file) => browserFiles.has(file) === (lane === 'browser'));
}
export { optional };

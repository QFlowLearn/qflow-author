import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import type { Page } from 'playwright';
import { join } from 'node:path';
import { safeErrorSummary } from '../../lib/error_summary.ts';

/** Test-owned portable output directory, independent of the application's configured storage. */
export type BrowserEvidenceDirectory = { readonly path: (name: string) => string };

/** Keep one real browser run's artifacts together on the host's actual temporary filesystem. */
export async function createBrowserEvidenceDirectory(): Promise<BrowserEvidenceDirectory> {
  const directory = await _fs.mkdtemp(_path.join(_os.tmpdir(), 'qflow-browser-'));
  console.log(`Browser evidence directory: ${directory}`);
  return { path: (name) => join(directory, name) };
}

/** Diagnostic capture cannot replace the original test failure, including after a page crash. */
export async function captureBrowserFailure(
  page: Page,
  directory: BrowserEvidenceDirectory,
  prefix: string,
): Promise<void> {
  const results = await Promise.allSettled([
    page.screenshot({ path: directory.path(`${prefix}-failure.png`), fullPage: true }),
    page.locator('body').innerText().then((text) =>
      _fs.writeFile(directory.path(`${prefix}-failure.txt`), text, 'utf8')
    ),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(JSON.stringify({
        event: 'browser_failure_evidence_unavailable',
        cause: safeErrorSummary(result.reason),
      }));
    }
  }
}

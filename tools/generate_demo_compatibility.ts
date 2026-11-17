import * as _fs from 'node:fs/promises';
import { projectDemoCompatibilityFixture } from '../lib/demo_presidents_catalog.ts';

export async function main(): Promise<void> {
  const outputUrl = new URL('../lib/demo_compatibility.generated.json', import.meta.url);
  const fixture = await projectDemoCompatibilityFixture();
  const generated = `${JSON.stringify(fixture, null, 2)}\n`;

  if (process.argv.slice(2).includes('--check')) {
    const current = await _fs.readFile(outputUrl, 'utf8');
    if (current !== generated) {
      throw new Error(
        'Demo compatibility fixture is stale. Run `pnpm run demo:compatibility`.',
      );
    }
  } else {
    await _fs.writeFile(outputUrl, generated, 'utf8');
  }
}
if (import.meta.main) await main();

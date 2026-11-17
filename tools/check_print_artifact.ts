import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import manifest from '../vendor/typst/manifest.json' with { type: 'json' };

/** Ordinary local verification attests vendored bytes and recorded template identity without Rust. */
export async function checkPrintArtifact(): Promise<void> {
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(`../vendor/typst/${file.name}`, import.meta.url));
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) {
      throw Error(`Pinned print artifact differs: ${file.name}`);
    }
    if (
      file.name.endsWith('.wasm') &&
      (bytes.includes(Buffer.from('/Users/')) || bytes.includes(Buffer.from('planning/evidence/')))
    ) throw Error('Print artifact contains a private build path.');
  }
  const template = await readFile(new URL('../lib/print/print_template.txt', import.meta.url));
  const source = await readFile(new URL('../lib/print/print_snapshot.ts', import.meta.url), 'utf8');
  if (!source.includes(`qflow-paper-v1-sha256-${digest(template)}`)) {
    throw Error('Paper template version does not match its bytes.');
  }
  const files = manifest.files.map((file) => [file.name, file.sha256]).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  if (!source.includes(`typst-ts-404730f-artifact-${digest(Buffer.from(JSON.stringify(files)))}`)) {
    throw Error('Paper compiler identity does not match its manifest.');
  }
  console.log('Pinned print compiler, fonts and template identities verified.');
}
function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
if (import.meta.main) await checkPrintArtifact();

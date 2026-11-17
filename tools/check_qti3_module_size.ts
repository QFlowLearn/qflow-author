import * as _fs from 'node:fs/promises';

export async function main(): Promise<void> {
  const QTI_IMPORT_ROOTS = [
    new URL('../lib/import/adapters/qti3/', import.meta.url),
  ];
  const QTI_IMPORT_FILES = [
    new URL('../lib/import/adapters/qti12.ts', import.meta.url),
    new URL('../lib/import/adapters/qti21.ts', import.meta.url),
    new URL('../lib/import/adapters/qti_migrator.ts', import.meta.url),
  ];
  const MAX_LINES = 500;

  const violations: string[] = [];

  for (const root of QTI_IMPORT_ROOTS) {
    await checkDirectory(root);
  }
  for (const file of QTI_IMPORT_FILES) {
    await checkFile(file.pathname);
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`ERROR: ${violation}`);
    }
    process.exit(1);
  }

  console.log(`qti import modules are at or below ${MAX_LINES} lines.`);

  function entryNameFrom(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] ?? path;
  }

  async function checkDirectory(root: URL, relativeDir = ''): Promise<void> {
    for await (const entry of await _fs.opendir(new URL(relativeDir, root))) {
      const relativePath = `${relativeDir}${entry.name}`;
      if (entry.isDirectory()) {
        await checkDirectory(root, `${relativePath}/`);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      await checkFile(new URL(relativePath, root).pathname);
    }
  }

  async function checkFile(path: string): Promise<void> {
    const text = await _fs.readFile(path, 'utf8');
    const lines = text.split('\n').length;
    if (lines > MAX_LINES) {
      const marker = '/lib/import/adapters/';
      const markerIndex = path.indexOf(marker);
      const relative = markerIndex >= 0
        ? `lib/import/adapters/${path.slice(markerIndex + marker.length)}`
        : entryNameFrom(path);
      violations.push(
        `${relative} has ${lines} lines; qti import modules must stay at or below ${MAX_LINES}.`,
      );
    }
  }
}
if (import.meta.main) await main();

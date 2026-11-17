import * as _fs from 'node:fs/promises';

export async function main(): Promise<void> {
  type Finding = {
    level: 'error' | 'warning';
    message: string;
  };

  type MaintainabilityBaseline = {
    explicitAnyCount: number;
    asNeverCount: number;
    maxFileLines: number;
    largeFileWarningLines: number;
    grandfatheredLargeFiles: Record<string, number>;
  };

  const BASELINE_PATH = new URL('../.maintainability-baseline.json', import.meta.url);
  const TEXT_EXTENSIONS = new Set(['.ts', '.tsx']);
  const SKIP_DIRS = new Set([
    '.git',
    'build',
    '.artifacts',
    '.migration-build',
    '.migration-inventory',
    'output',
    'node_modules',
    'vendor',
    'history',
  ]);

  const anyPattern = /\b(as any|: any\b|<any>|Record<string, any>|Array<[^>\n]*any)/g;
  const asNeverPattern = /\bas never\b/g;
  const routeDbImportPattern =
    /from\s+['"](?:\.\.\/)+(?:lib\/)?db(?:\/schema)?(?:\.ts)?['"]|from\s+['"]drizzle-orm(?:\/[^'"]+)?['"]/;

  function routeImportsPersistence(source: string): boolean {
    return routeDbImportPattern.test(source);
  }

  const writeBaseline = process.argv.slice(2).includes('--write-baseline');
  const baseline = await loadBaseline();

  let explicitAnyCount = 0;
  let asNeverCount = 0;
  const fileLineCounts = new Map<string, number>();
  const findings: Finding[] = [];

  for await (const path of walkSourceFiles('.')) {
    const text = await _fs.readFile(path, 'utf8');
    const lines = text.split('\n').length;
    fileLineCounts.set(path, lines);
    explicitAnyCount += text.match(anyPattern)?.length ?? 0;
    asNeverCount += text.match(asNeverPattern)?.length ?? 0;

    const grandfatheredLines = baseline.grandfatheredLargeFiles[path];
    if (grandfatheredLines !== undefined) {
      if (lines > grandfatheredLines) {
        findings.push({
          level: 'error',
          message:
            `${path} grew from ${grandfatheredLines} to ${lines} lines; split it before adding more.`,
        });
      }
      continue;
    }

    if (lines > baseline.maxFileLines) {
      findings.push({
        level: 'error',
        message:
          `${path} has ${lines} lines; keep first-party modules at or below ${baseline.maxFileLines}.`,
      });
    } else if (lines > baseline.largeFileWarningLines) {
      findings.push({
        level: 'warning',
        message: `${path} has ${lines} lines; consider splitting by responsibility.`,
      });
    }
  }

  if (writeBaseline) {
    const grandfatheredLargeFiles = Object.fromEntries(
      [...fileLineCounts.entries()]
        .filter(([, lines]) => lines > baseline.maxFileLines)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
    const nextBaseline: MaintainabilityBaseline = {
      explicitAnyCount,
      asNeverCount,
      maxFileLines: baseline.maxFileLines,
      largeFileWarningLines: baseline.largeFileWarningLines,
      grandfatheredLargeFiles,
    };
    await _fs.writeFile(BASELINE_PATH, `${JSON.stringify(nextBaseline, null, 2)}\n`, 'utf8');
    console.log(`wrote ${BASELINE_PATH.pathname}`);
    process.exit(0);
  }

  if (explicitAnyCount > baseline.explicitAnyCount) {
    findings.push({
      level: 'error',
      message:
        `explicit any count increased to ${explicitAnyCount}; baseline is ${baseline.explicitAnyCount}.`,
    });
  }

  if (asNeverCount > baseline.asNeverCount) {
    findings.push({
      level: 'error',
      message:
        `as-never cast count increased to ${asNeverCount}; baseline is ${baseline.asNeverCount}.`,
    });
  }

  for (const path of await listRouteFiles('lib/http/routes')) {
    const text = await _fs.readFile(path, 'utf8');
    if (routeImportsPersistence(text)) {
      findings.push({
        level: 'error',
        message:
          `${path} imports persistence directly; route handlers must call lib/services/* instead.`,
      });
    }
  }

  for (const finding of findings) {
    const prefix = finding.level === 'error' ? 'ERROR' : 'WARN';
    console.error(`${prefix}: ${finding.message}`);
  }

  console.log(
    `explicit any count: ${explicitAnyCount}/${baseline.explicitAnyCount}`,
  );
  console.log(`as-never cast count: ${asNeverCount}/${baseline.asNeverCount}`);

  if (findings.some((finding) => finding.level === 'error')) {
    process.exit(1);
  }

  async function loadBaseline(): Promise<MaintainabilityBaseline> {
    const text = await _fs.readFile(BASELINE_PATH, 'utf8');
    return JSON.parse(text) as MaintainabilityBaseline;
  }

  async function* walkSourceFiles(root: string): AsyncGenerator<string> {
    for await (const entry of await _fs.opendir(root)) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = root === '.' ? entry.name : `${root}/${entry.name}`;
      if (entry.isDirectory()) {
        yield* walkSourceFiles(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (TEXT_EXTENSIONS.has(extensionOf(entry.name))) yield path;
    }
  }

  function extensionOf(path: string): string {
    const dot = path.lastIndexOf('.');
    return dot === -1 ? '' : path.slice(dot);
  }

  async function listRouteFiles(root: string): Promise<string[]> {
    const paths: string[] = [];
    for await (const entry of await _fs.opendir(root)) {
      if (entry.isDirectory()) {
        paths.push(...await listRouteFiles(`${root}/${entry.name}`));
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extensionOf(entry.name);
      if (ext === '.ts' || ext === '.tsx') paths.push(`${root}/${entry.name}`);
    }
    return paths;
  }
}
if (import.meta.main) await main();

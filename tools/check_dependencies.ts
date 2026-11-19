import { checkPrintArtifact } from './check_print_artifact.ts';
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { API } from 'typescript/unstable/sync';
import * as ts from 'typescript/unstable/ast';
import { runCommand } from './process_command.ts';
function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw Error('Invalid dependency metadata.');
  return value;
}
/** Check pinned tools, one Preact runtime and Deno/Fresh/JSR-free emitted module dependencies. */
export async function checkDependencies(): Promise<void> {
  const config = object(JSON.parse(await readFile('package.json', 'utf8')));
  if (process.versions.node !== '26.13.1' || config.packageManager !== 'pnpm@12.21.0') {
    throw Error('Pinned runtime tools differ.');
  }
  for (const kind of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(object(config[kind]))) {
      if (
        typeof version !== 'string' ||
        !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?$/.test(version) ||
        /fresh|^@jsr\//.test(name)
      ) {
        throw Error('Unexpected runtime dependency pin: ' + name);
      }
    }
  }
  const version = await runCommand('pnpm', ['--version']);
  if (!version.success || new TextDecoder().decode(version.stdout).trim() !== '12.21.0') {
    throw Error('Use pnpm 12.21.0.');
  }
  const result = await runCommand('pnpm', ['list', 'preact', '--depth', 'Infinity', '--json']);
  if (!result.success) throw Error('Cannot inspect dependency graph.');
  const decoded: unknown = JSON.parse(new TextDecoder().decode(result.stdout));
  const versions = new Set<string>();
  function visit(value: unknown, key?: string) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const fields = object(value);
    if (key === 'preact') {
      if (typeof fields.version !== 'string') throw Error('Missing Preact version.');
      versions.add(fields.version);
    }
    for (const [name, item] of Object.entries(fields)) visit(item, name);
  }
  visit(decoded);
  if (versions.size !== 1 || !versions.has('10.29.1')) {
    throw Error('Expected exactly one Preact 10.29.1 runtime.');
  }
  const paths: string[] = [];
  async function collect(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (/\.js$/.test(path)) paths.push(path);
    }
  }
  await collect('.cloudflare/output/v1/workers');
  const api = new API();
  try {
    const snapshot = api.updateSnapshot({ openFiles: paths });
    try {
      for (const path of paths) {
        const file = snapshot.getDefaultProjectForFile(path)?.program.getSourceFile(path);
        if (!file) throw Error('Missing emitted module syntax tree: ' + path);
        function inspectNode(node: ts.Node) {
          if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier) &&
            /^(?:fresh(?:\/|$)|@fresh\/|jsr:|npm:)/.test(node.moduleSpecifier.text)
          ) throw Error('Retired runtime in emitted graph.');
          node.forEachChild(inspectNode);
        }
        inspectNode(file);
      }
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
  console.log(
    'Pinned Node/pnpm and one Preact 10 runtime verified; emitted imports contain no retired framework/runtime dependencies.',
  );
}
if (import.meta.main) await checkPrintArtifact();
if (import.meta.main) await checkDependencies();

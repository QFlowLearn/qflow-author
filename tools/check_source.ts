import ts from 'typescript';
import { relative, resolve } from 'node:path';
import { sourceFiles } from './source_files.ts';
/** Strict Node, Worker and Worker-test scopes must jointly cover every Git-visible TypeScript source. */
export async function checkSource(): Promise<void> {
  const covered = new Set<string>();
  for (
    const path of ['tsconfig.node.json', 'tsconfig.worker.json', 'tsconfig.cloudflare-tests.json']
  ) {
    const loaded = ts.readConfigFile(path, ts.sys.readFile);
    if (loaded.error) throw Error('Invalid TypeScript configuration.');
    const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, process.cwd());
    const program = ts.createProgram(config.fileNames, config.options);
    const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
    if (diagnostics.length) {
      console.error(
        ts.formatDiagnosticsWithColorAndContext(diagnostics, {
          getCurrentDirectory: () => process.cwd(),
          getNewLine: () => '\n',
          getCanonicalFileName: (file) => file,
        }),
      );
      throw Error('Strict source checking failed.');
    }
    for (const file of program.getSourceFiles()) covered.add(resolve(file.fileName));
  }
  const files = (await sourceFiles()).filter((path) =>
    /\.(?:[cm]?ts|tsx)$/.test(path) && !path.startsWith('tests/fixtures/')
  );
  const missing = files.filter((path) => !covered.has(resolve(path)));
  if (missing.length) throw Error('Unchecked TypeScript source: ' + missing.join(', '));
  for (const path of files) {
    const text = ts.sys.readFile(path);
    if (text === undefined) throw Error('Missing source.');
    const file = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function visit(node: ts.Node) {
      if (
        ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === 'Deno'
      ) throw Error('Retired runtime API in ' + relative(process.cwd(), resolve(path)));
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        /^(?:fresh(?:\/|$)|@fresh\/|jsr:|npm:)/.test(node.moduleSpecifier.text)
      ) throw Error('Retired runtime dependency in ' + path);
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  console.log(
    `Strict source scopes cover ${files.length} TypeScript files; no migration ownership map is required.`,
  );
}
if (import.meta.main) await checkSource();

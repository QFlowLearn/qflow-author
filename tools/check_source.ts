import { API, type Program } from 'typescript/unstable/sync';
import * as ts from 'typescript/unstable/ast';
import { relative, resolve } from 'node:path';
import { sourceFiles } from './source_files.ts';
/** Strict Node, Worker and Worker-test scopes must jointly cover every Git-visible TypeScript source. */
export async function checkSource(): Promise<void> {
  const paths = ['tsconfig.node.json', 'tsconfig.worker.json', 'tsconfig.cloudflare-tests.json'];
  const api = new API();
  try {
    const snapshot = api.updateSnapshot({ openProjects: paths });
    try {
      const covered = new Map<string, Program>();
      for (const path of paths) {
        const project = snapshot.getProject(path);
        if (!project) throw Error('Missing TypeScript project: ' + path);
        const program = project.program;
        const diagnostics = [
          ...program.getConfigFileParsingDiagnostics(),
          ...program.getGlobalDiagnostics(),
          ...program.getProgramDiagnostics(),
          ...program.getSyntacticDiagnostics(),
          ...program.getBindDiagnostics(),
          ...program.getSemanticDiagnostics(),
        ];
        if (diagnostics.length) {
          console.error(JSON.stringify(diagnostics, null, 2));
          throw Error('Strict source checking failed.');
        }
        for (const file of program.getSourceFileNames()) covered.set(resolve(file), program);
      }
      const files = (await sourceFiles()).filter((path) =>
        /\.(?:[cm]?ts|tsx)$/.test(path) && !path.startsWith('tests/fixtures/')
      );
      const missing = files.filter((path) => !covered.has(resolve(path)));
      if (missing.length) throw Error('Unchecked TypeScript source: ' + missing.join(', '));
      for (const path of files) {
        const file = covered.get(resolve(path))?.getSourceFile(path);
        if (!file) throw Error('Missing source: ' + path);
        function visit(node: ts.Node) {
          if (
            ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
            node.expression.text === 'Deno'
          ) throw Error('Retired runtime API in ' + relative(process.cwd(), resolve(path)));
          if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier) &&
            /^(?:fresh(?:\/|$)|@fresh\/|jsr:|npm:)/.test(node.moduleSpecifier.text)
          ) throw Error('Retired runtime dependency in ' + path);
          node.forEachChild(visit);
        }
        visit(file);
      }
      console.log(
        `Strict source scopes cover ${files.length} TypeScript files with the native compiler.`,
      );
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}
if (import.meta.main) await checkSource();

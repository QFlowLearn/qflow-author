import ts from 'typescript';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadAndParseConfig } from '@cloudflare/config';
import { readAuthorBuild } from './cloudflare_build.ts';
import { printWorkerConfig } from './print_worker_config.ts';
import { runCommand } from './process_command.ts';

const workflowNames = [
  'AiGenerationWorkflow',
  'BankEnrichmentWorkflow',
  'MigrationCommitWorkflow',
  'QuestionOrganizationWorkflow',
  'ReleaseBuildWorkflow',
  'AssessmentPrintWorkflow',
  'SourceMigrationWorkflow',
].sort();
function same(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw Error('Worker configuration contract differs.');
  }
}
/** Attest native output against the typed source and preserve the separate print compiler. */
export async function checkConfiguration(): Promise<void> {
  const { output, app, renderer } = await readAuthorBuild();
  const context = output.rootConfig.buildContext;
  if (!context?.mode) throw Error('Build mode is required.');
  const { result } = await loadAndParseConfig(resolve('cloudflare.config.ts'), {
    mode: context.mode,
    isPreview: context.isPreview,
  });
  if (!result.success || !result.data.worker) throw Error('Invalid Author configuration.');
  const source = result.data.worker;
  for (
    const key of [
      'name',
      'compatibilityDate',
      'compatibilityFlags',
      'workersDev',
      'limits',
      'env',
      'exports',
      'triggers',
    ] as const
  ) same(app.config[key], source[key]);
  same(Object.keys(source.exports ?? {}).sort(), workflowNames);
  same(
    source.triggers?.filter((trigger) => trigger.type === 'scheduled').map((trigger) =>
      trigger.schedule
    ).sort(),
    ['* * * * *', '*/2 * * * *', '0 3 * * *'].sort(),
  );
  const expected = printWorkerConfig(source);
  for (
    const key of [
      'name',
      'compatibilityDate',
      'compatibilityFlags',
      'workersDev',
      'limits',
      'env',
      'exports',
      'triggers',
    ] as const
  ) same(renderer.config[key], expected[key]);
  if (!app.bundleDir || !renderer.bundleDir || !app.assetsDir) {
    throw Error('Worker bundles and static assets are required.');
  }
  if (
    (await readdir(app.bundleDir, { recursive: true })).some((path) => /\.(wasm|bin)$/.test(path))
  ) throw Error('Application Worker contains print compiler binaries.');
  if (
    (await readdir(renderer.bundleDir, { recursive: true })).filter((path) =>
      path.endsWith('.wasm')
    ).length !== 1
  ) throw Error('Print Worker must contain one compiler module.');
  const entry = ts.createSourceFile(
    'index.js',
    await readFile(resolve(app.bundleDir, 'index.js'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const exported = entry.statements.flatMap((statement) =>
    ts.isExportDeclaration(statement) && statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.map((element) => element.name.text)
      : []
  );
  same(exported.filter((name) => name.endsWith('Workflow')).sort(), workflowNames);
  console.log(
    'Typed configuration, seven Workflows, three schedules, static assets and separate print compiler verified.',
  );
}

/** Cloudflare validates the prebuilt output locally without uploading it. */
export async function dryRun(): Promise<void> {
  await checkConfiguration();
  const { output } = await readAuthorBuild();
  await mkdir('.artifacts/dry-run', { recursive: true });
  for (const worker of Object.values(output.workers)) {
    const result = await runCommand(process.execPath, [
      resolve('node_modules/cf/bin/cf'),
      'deploy',
      '--prebuilt',
      '--dry-run',
      '--worker',
      worker.config.name,
    ]);
    await writeFile(
      resolve('.artifacts/dry-run', worker.config.name + '.log'),
      new TextDecoder().decode(result.stdout) + '\n' + new TextDecoder().decode(result.stderr),
    );
    if (!result.success) throw Error('Cloudflare dry run failed; inspect .artifacts/dry-run.');
  }
  console.log('Cloudflare dry run passed for both Workers.');
}
if (import.meta.main) {
  if (process.argv.includes('--dry-run')) await dryRun();
  else await checkConfiguration();
}

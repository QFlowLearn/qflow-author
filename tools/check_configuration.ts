function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from './jsonc.ts';
import { runCommand } from './process_command.ts';
import ts from 'typescript';
import { printWorkerConfig } from './print_worker_config.ts';
import { readdir } from 'node:fs/promises';
const workflowNames = [
  'AiGenerationWorkflow',
  'BankEnrichmentWorkflow',
  'MigrationCommitWorkflow',
  'QuestionOrganizationWorkflow',
  'ReleaseBuildWorkflow',
  'AssessmentPrintWorkflow',
  'SourceMigrationWorkflow',
].sort();
const crons = ['* * * * *', '*/2 * * * *', '0 3 * * *'].sort();
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw Error('Invalid Worker configuration.');
  return value;
}
function fieldNames(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) throw Error('Missing configured Worker capability.');
  return value.map((item) => {
    const name = record(item)[key];
    if (typeof name !== 'string') throw Error('Invalid Worker capability name.');
    return name;
  }).sort();
}
function same(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw Error('Worker configuration contract differs.');
  }
}
/** Attest the unchanged configured Worker identity, seven Workflows, three crons and generated origin. */
export async function checkConfiguration(): Promise<string> {
  const configured = process.env.QFLOW_WRANGLER_CONFIG;
  if (!configured) throw Error('QFLOW_WRANGLER_CONFIG is required.');
  const source = record(parseJsonc(await readFile(configured, 'utf8')));
  const template = record(parseJsonc(await readFile('wrangler.example.jsonc', 'utf8')));
  for (const config of [source, template]) {
    same(config.main, 'deploy/cloudflare/worker.entry.ts');
    same(record(config.assets).directory, './build/client');
    same(record(config.assets).binding, 'ASSETS');
    same(fieldNames(config.workflows, 'class_name'), workflowNames);
    const triggers = record(config.triggers);
    if (!Array.isArray(triggers.crons)) throw Error('Missing Worker schedules.');
    same([...triggers.crons].sort(), crons);
  }
  const built = record(JSON.parse(await readFile('build/ssr/wrangler.json', 'utf8')));
  same(built.userConfigPath, resolve(configured));
  same(built.name, source.name);
  for (
    const key of [
      'account_id',
      'routes',
      'compatibility_date',
      'compatibility_flags',
      'workers_dev',
      'preview_urls',
    ]
  ) {
    same(built[key], source[key]);
  }
  same(record(built.assets).binding, record(source.assets).binding);
  same(built.services, source.services);
  same(fieldNames(template.services, 'binding'), fieldNames(source.services, 'binding'));
  const expectedRenderer = printWorkerConfig(source);
  const renderer = record(JSON.parse(await readFile('build/print_renderer/wrangler.json', 'utf8')));
  for (
    const key of [
      'name',
      'account_id',
      'compatibility_date',
      'compatibility_flags',
      'workers_dev',
      'preview_urls',
      'limits',
    ]
  ) {
    same(renderer[key], Reflect.get(expectedRenderer, key));
  }
  for (const capability of ['services', 'workflows', 'r2_buckets', 'hyperdrive', 'd1_databases']) {
    same(renderer[capability], []);
  }
  if (
    (await readdir('build/ssr', { recursive: true })).some((path) => /\.(wasm|bin)$/.test(path))
  ) {
    throw Error('Application Worker must not contain print compiler or font binaries.');
  }
  const rendererFiles = await readdir('build/print_renderer', { recursive: true });
  if (rendererFiles.filter((path) => path.endsWith('.wasm')).length !== 1) {
    throw Error('Print Worker must contain exactly one compiler module.');
  }
  for (
    const [capability, identity] of [['hyperdrive', 'id'], ['r2_buckets', 'bucket_name'], [
      'ratelimits',
      'namespace_id',
    ], ['workflows', 'class_name']]
  ) {
    same(fieldNames(built[capability], identity), fieldNames(source[capability], identity));
  }
  for (const key of ['workflows', 'hyperdrive', 'r2_buckets', 'ratelimits', 'send_email']) {
    const name = key === 'workflows' || key === 'send_email' ? 'name' : 'binding';
    // Rate limit bindings use name in Wrangler's current schema.
    const property = key === 'ratelimits' ? 'name' : name;
    same(fieldNames(built[key], property), fieldNames(source[key], property));
    same(fieldNames(template[key], property), fieldNames(source[key], property));
  }
  same(record(built.triggers).crons, record(source.triggers).crons);
  const entry = ts.createSourceFile(
    'index.js',
    await readFile('build/ssr/index.js', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const exports = entry.statements.flatMap((statement) =>
    ts.isExportDeclaration(statement) && statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.map((element) => element.name.text)
      : []
  );
  same(exports.filter((name) => name.endsWith('Workflow')).sort(), workflowNames);
  console.log(
    'Worker identity, capability names, seven Workflow exports and three schedules match the selected configuration.',
  );
  return resolve('build/ssr/wrangler.json');
}
/** Bundle the generated form of the attested real configuration without contacting deployment APIs. */
export async function dryRun(): Promise<void> {
  const config = await checkConfiguration();
  for (const selected of ['build/print_renderer/wrangler.json', config]) {
    await mkdir('.artifacts/dry-run', { recursive: true });
    const result = await runCommand(process.execPath, [
      fileURLToPath(new URL('./bin/wrangler.js', import.meta.resolve('wrangler/package.json'))),
      'deploy',
      '--dry-run',
      '--config',
      selected,
      '--outdir',
      selected === config ? '.artifacts/dry-run/app' : '.artifacts/dry-run/renderer',
    ]);
    await writeFile(
      selected === config ? '.artifacts/dry-run/app.log' : '.artifacts/dry-run/renderer.log',
      new TextDecoder().decode(result.stdout) + '\n' + new TextDecoder().decode(result.stderr),
    );
    if (!result.success) {
      throw Error('Configured Worker dry-run failed; inspect the local command log.');
    }
  }
  console.log('Authoritative Worker configuration dry-run passed.');
}
if (import.meta.main) {
  if (process.argv.includes('--dry-run')) await dryRun();
  else await checkConfiguration();
}

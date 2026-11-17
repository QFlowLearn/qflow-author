import { rm } from 'node:fs/promises';
import { runCommand } from './process_command.ts';
import { qaDatabase } from './testing/database.ts';
import { runLane, runWorkerTests } from './testing/run.ts';
import { checkSource } from './check_source.ts';
import { dryRun } from './check_configuration.ts';

/** Run the mandatory local/CI matrix in dependency order, with one fresh CSS/application build. */
export async function verify(selection: string): Promise<void> {
  if (process.versions.node !== '24.16.0') throw Error('Use pinned Node 24.16.0.');
  const databaseUrl = await qaDatabase(selection);
  const environment = { ...process.env, DATABASE_URL: databaseUrl, QFLOW_CI_BROWSER_PORT: '55880' };
  process.env.DATABASE_URL = databaseUrl;
  process.env.QFLOW_CI_BROWSER_PORT = '55880';
  const command = async (executable: string, args: readonly string[]) => {
    const result = await runCommand(executable, args, { env: environment, output: 'inherit' });
    if (!result.success) throw Error('Verification command failed: ' + args.join(' '));
  };
  const tool = (name: string, args: readonly string[] = []) =>
    command(process.execPath, ['--import', 'tsx', `tools/${name}.ts`, ...args]);
  await command('pnpm', ['install', '--frozen-lockfile']);
  await checkSource();
  for (
    const name of [
      'lint',
      'check_qti3_module_size',
      'format',
      'check_i18n',
      'maintainability_check',
    ]
  ) await tool(name);
  await tool('require_db');
  await tool('db', ['migrate']);
  await tool('ci_browser', ['check']);
  await runLane('ordinary', environment);
  await rm('build', { recursive: true, force: true });
  await command('pnpm', ['run', 'build']);
  await runWorkerTests(environment);
  await runLane('browser', environment);
  await tool('ci_browser', ['a11y']);
  await tool('validate', ['--corpus']);
  await tool('check_assessment_authoring_bundle');
  await tool('check_dependencies');
  await dryRun();
  console.log(
    'Complete mandatory verification passed. Optional external/upgrade/scale lanes remain explicitly reported.',
  );
}
if (import.meta.main) {
  const [arg] = process.argv.slice(2);
  if (!arg?.startsWith('--database=')) throw Error('Explicit QA database selection is required.');
  await verify(arg.slice('--database='.length));
}

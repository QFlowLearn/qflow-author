import { access, readFile } from 'node:fs/promises';
import { engines } from '../package.json' with { type: 'json' };
import { localDatabaseStatus } from './local_database.ts';
import {
  assertSingleLocalEnvironment,
  localCa,
  LocalConfigurationError,
  localTls,
  parseLocalConfig,
} from './local_config.ts';
import { parseJsonc } from './jsonc.ts';
import { runCommand } from './process_command.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';

export type DoctorCheck = {
  readonly name: string;
  readonly ok: boolean;
  readonly message: string;
};

/** Read-only preflight. Checks keep reporting after a failure and never print secrets. */
export async function inspectDevelopment(): Promise<readonly DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const check = async (name: string, remedy: string, inspect: () => void | Promise<void>) => {
    try {
      await inspect();
      checks.push({ name, ok: true, message: 'ready' });
    } catch {
      checks.push({ name, ok: false, message: remedy });
    }
  };
  await check('Node', `Use Node ${engines.node}; see .node-version.`, () => {
    if (process.versions.node !== engines.node) throw Error('Node version differs.');
  });
  await check('pnpm', `Use pnpm ${engines.pnpm}.`, async () => {
    const result = await runCommand('pnpm', ['--version']);
    if (!result.success || new TextDecoder().decode(result.stdout).trim() !== engines.pnpm) {
      throw Error('pnpm version differs.');
    }
  });
  let config;
  try {
    config = parseLocalConfig(process.env);
    checks.push({ name: 'Local configuration', ok: true, message: '.env.local is consistent' });
  } catch (cause: unknown) {
    // parseLocalConfig owns this diagnostic; it never interpolates boundary values.
    checks.push({
      name: 'Local configuration',
      ok: false,
      message: cause instanceof LocalConfigurationError ? cause.message : 'Run pnpm setup:local.',
    });
  }
  await check(
    'Environment files',
    'Use .env.local only. Move local settings out of .env and .dev.vars, then remove those files.',
    () => assertSingleLocalEnvironment(),
  );
  if (!config) return checks;
  const selected = config;
  await check(
    'Worker configuration',
    'Run pnpm setup:local to prepare wrangler.local.jsonc with local bindings.',
    async () => {
      const value = parseJsonc(await readFile(selected.wranglerConfig, 'utf8'));
      if (
        !value || typeof value !== 'object' || Reflect.get(value, 'name') !== 'qflow-local' ||
        Reflect.get(value, 'routes') || Reflect.get(value, 'account_id')
      ) {
        throw Error('Select the local Worker configuration.');
      }
    },
  );
  if (selected.tls) {
    await check(
      'HTTPS certificate',
      'Run pnpm setup:local; check the certificate paths, expiry and matching private key.',
      () => {
        localTls(selected);
      },
    );
    await check(
      'Local certificate authority',
      'Set NODE_EXTRA_CA_CERTS to the mkcert rootCA.pem path that signs your local certificate.',
      () => {
        localCa(selected);
      },
    );
  } else {
    checks.push({
      name: 'HTTPS preview proxy',
      ok: true,
      message: 'Configured; verify browser access through the workspace preview URL.',
    });
  }
  for (const database of ['qflow_local', 'qflow_test']) {
    const url = new URL(selected.databaseUrl);
    url.pathname = '/' + database;
    const status = await localDatabaseStatus(url.href);
    checks.push({ name: `PostgreSQL: ${database}`, ...status });
  }
  await check('QTI validation', 'Install xmllint (libxml2) for schema validation.', async () => {
    if (!(await runCommand('xmllint', ['--version'])).success) throw Error('xmllint unavailable.');
  });
  await check('Browser tests', 'Run pnpm exec playwright install chromium.', async () => {
    const { chromium } = await import('playwright');
    await access(chromium.executablePath());
  });
  return checks;
}

if (import.meta.main) {
  try {
    const checks = await inspectDevelopment();
    for (const check of checks) {
      console.log(`${check.ok ? 'OK' : 'FIX'} ${check.name}: ${check.message}`);
    }
    process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
  } catch (cause: unknown) {
    console.error(`Doctor could not finish: ${safeErrorSummary(cause)}`);
    process.exitCode = 1;
  }
}

import { randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import postgres from 'postgres';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { hasFileErrorCode } from './file_errors.ts';
import { parseJsonc } from './jsonc.ts';
import {
  assertSingleLocalEnvironment,
  localCa,
  LocalConfigurationError,
  localDatabaseName,
  localTls,
  parseLocalConfig,
} from './local_config.ts';
import { runCommand } from './process_command.ts';

class LocalSetupError extends Error {}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (cause: unknown) {
    if (hasFileErrorCode(cause, 'ENOENT')) return false;
    throw cause;
  }
}

/** Preserve configured values while writing one dotenv file that round-trips through Node. */
export function serializeLocalEnvironment(environment: Readonly<Record<string, string>>): string {
  return '# Local configuration. Keep this file private. Prepared by pnpm setup:local.\n' +
    Object.entries(environment).sort(([left], [right]) => left.localeCompare(right)).map(
      ([name, value]) => {
        if (!/^[A-Z][A-Z0-9_]*$/.test(name) || /[\r\n]/.test(value)) {
          throw new LocalSetupError(
            'Local environment names and values must be single-line settings.',
          );
        }
        const quote = ["'", '"', '`'].find((delimiter) => !value.includes(delimiter));
        if (!quote) {
          throw new LocalSetupError(
            'A local environment value contains all supported quoting delimiters. Edit it explicitly before setup.',
          );
        }
        return `${name}=${quote}${value}${quote}\n`;
      },
    ).join('');
}

/** Prepare files only. Existing secrets and certificates survive repeated setup. No trust-store changes. */
export async function prepareLocalFiles(
  cwd: string,
  settings: Readonly<Record<string, string>> = {},
): Promise<NodeJS.ProcessEnv> {
  assertSingleLocalEnvironment(cwd);
  const existing: Record<string, string> = {};
  try {
    for (
      const [name, value] of Object.entries(
        parseEnv(await readFile(resolve(cwd, '.env.local'), 'utf8')),
      )
    ) {
      if (value !== undefined) existing[name] = value;
    }
  } catch (cause: unknown) {
    if (!hasFileErrorCode(cause, 'ENOENT')) throw cause;
  }
  const template = parseJsonc(await readFile(resolve(cwd, 'wrangler.example.jsonc'), 'utf8'));
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    throw new LocalSetupError('Invalid public Worker template.');
  }
  const vars: unknown = Reflect.get(template, 'vars');
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) {
    throw new LocalSetupError('Invalid public Worker variables.');
  }
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value !== 'string') {
      throw new LocalSetupError('Worker template variables must be strings.');
    }
    environment[name] = value;
  }
  Object.assign(
    environment,
    parseEnv(await readFile(resolve(cwd, '.env.example'), 'utf8')),
    existing,
    settings,
  );
  let url: URL;
  try {
    url = new URL(environment.DATABASE_URL ?? '');
  } catch {
    throw new LocalSetupError(
      'Set DATABASE_URL in .env.local before setup. See docs/development.md.',
    );
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  ) {
    throw new LocalSetupError(
      'Local setup requires an explicitly configured loopback PostgreSQL connection.',
    );
  }
  url.pathname = '/' + localDatabaseName;
  Object.assign(environment, {
    DATABASE_URL: url.href,
    QFLOW_SECURE_COOKIES: 'true',
    QFLOW_COOKIE_DOMAIN: '',
    QFLOW_ROOT_DOMAIN: '',
    QFLOW_STORAGE_BACKEND: 'r2-binding',
    QFLOW_WRANGLER_CONFIG: 'wrangler.local.jsonc',
  });
  delete environment.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_QFLOW_DB;
  delete environment.QFLOW_LOCAL_TRANSACTIONAL_EMAIL_DISABLED;
  for (const name of ['QFLOW_RUNNER_KEY', 'QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1']) {
    if (!environment[name] || environment[name] === 'change-me') {
      environment[name] = randomBytes(32).toString('base64url');
    }
  }
  await mkdir(resolve(cwd, '.artifacts/local-dev'), { recursive: true });
  if (environment.QFLOW_DEV_ORIGIN?.startsWith('https:')) {
    const mkcert = await runCommand('mkcert', ['-CAROOT'], { cwd });
    if (!mkcert.success) {
      throw new LocalSetupError(
        'Install mkcert and trust its development CA before setup. See docs/development.md.',
      );
    }
    const caRoot = new TextDecoder().decode(mkcert.stdout).trim();
    await access(resolve(caRoot, 'rootCA.pem'));
    environment.NODE_EXTRA_CA_CERTS = resolve(caRoot, 'rootCA.pem');
    // A supplied pair is deliberate configuration. Never repair or replace one half silently.
    if (!!existing.QFLOW_DEV_TLS_CERT !== !!existing.QFLOW_DEV_TLS_KEY) {
      throw new LocalSetupError(
        'Configure both QFLOW_DEV_TLS_CERT and QFLOW_DEV_TLS_KEY before setup. A supplied certificate pair is never repaired automatically.',
      );
    }
    const defaultPair = environment.QFLOW_DEV_TLS_CERT === '.artifacts/local-dev/cert.pem' &&
      environment.QFLOW_DEV_TLS_KEY === '.artifacts/local-dev/key.pem';
    const missingDefaultPair = defaultPair &&
      !await exists(resolve(cwd, '.artifacts/local-dev/cert.pem')) &&
      !await exists(resolve(cwd, '.artifacts/local-dev/key.pem'));
    if (missingDefaultPair) {
      const certificate = await runCommand('mkcert', [
        '-cert-file',
        environment.QFLOW_DEV_TLS_CERT,
        '-key-file',
        environment.QFLOW_DEV_TLS_KEY,
        '127.0.0.1',
        'localhost',
        '::1',
      ], { cwd });
      if (!certificate.success) {
        throw new LocalSetupError(
          'Could not generate the local certificate. Check mkcert; setup does not install a CA.',
        );
      }
    }
  }
  const config = parseLocalConfig(environment, cwd);
  localTls(config);
  localCa(config);
  const localWorker = {
    ...template,
    name: 'qflow-local',
    services: [{ binding: 'QFLOW_PRINT_RENDERER', service: 'qflow-local-print-renderer' }],
    vars: {},
    workers_dev: false,
  };
  Reflect.deleteProperty(localWorker, 'account_id');
  Reflect.deleteProperty(localWorker, 'routes');
  await writeFile(
    resolve(cwd, 'wrangler.local.jsonc'),
    JSON.stringify(localWorker, null, 2) + '\n',
    { mode: 0o600 },
  );
  // Stage secrets in an ignored private directory. A failed write must not truncate existing keys.
  const staging = await mkdtemp(resolve(cwd, '.artifacts/local-dev/config-'));
  try {
    const path = resolve(staging, 'environment');
    await writeFile(path, serializeLocalEnvironment(environment), {
      mode: 0o600,
      flag: 'wx',
      flush: true,
    });
    await rename(path, resolve(cwd, '.env.local'));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return environment;
}

/** Explicit local-only database creation; no resets, drops, alternate hosts or privilege changes. */
async function prepareDatabases(environment: NodeJS.ProcessEnv): Promise<void> {
  const configured = parseLocalConfig(environment).databaseUrl;
  const admin = new URL(configured);
  admin.pathname = '/postgres';
  const sql = postgres(admin.href, { max: 1, connect_timeout: 3, idle_timeout: 1 });
  try {
    const rows = await sql<
      { version: string }[]
    >`select current_setting('server_version_num') as version`;
    if (Math.floor(Number(rows[0]?.version) / 10000) !== 17) {
      throw new LocalSetupError('Local setup requires PostgreSQL 17.');
    }
    for (const name of [localDatabaseName, 'qflow_test']) {
      const found = await sql`select 1 from pg_database where datname = ${name}`;
      if (!found.length) {
        const roles = await sql<
          { allowed: boolean }[]
        >`select rolcreatedb or rolsuper as allowed from pg_roles where rolname = current_user`;
        if (!roles[0]?.allowed) {
          throw new LocalSetupError(
            `Ask your local PostgreSQL administrator to create ${name}, owned by your configured app role. Setup does not change privileges. See docs/development.md.`,
          );
        }
        await sql`create database ${sql(name)}`;
        console.log(`Created ${name}.`);
      }
      const database = new URL(configured);
      database.pathname = '/' + name;
      const result = await runCommand(process.execPath, [
        '--import',
        'tsx',
        'tools/db.ts',
        'migrate',
      ], {
        env: { ...environment, DATABASE_URL: database.href },
        output: 'capture',
      });
      if (!result.success) {
        throw new LocalSetupError(
          `Schema setup failed for ${name}. Run DATABASE_URL with that database explicitly and pnpm db:migrate to inspect the migration. Existing data was not reset.`,
        );
      }
      console.log(`${name}: schema ready.`);
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 2) {
      throw new LocalSetupError(
        'Use pnpm setup:local without arguments; the local database is qflow_local.',
      );
    }
    const environment = await prepareLocalFiles(process.cwd());
    await prepareDatabases(environment);
    console.log(
      'Local setup complete. Run pnpm run doctor, then pnpm dev. Sign up locally and use onboarding for demo content.',
    );
  } catch (cause: unknown) {
    // Setup defects below are owned diagnostics. Dependency errors are summarized without values.
    console.error(
      cause instanceof LocalSetupError || cause instanceof LocalConfigurationError
        ? cause.message
        : `Local setup failed: ${
          safeErrorSummary(cause)
        }. Check PostgreSQL, mkcert and file permissions; see docs/development.md.`,
    );
    process.exitCode = 1;
  }
}

import { expect, it } from 'vitest';
import { parseEnv } from 'node:util';
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../tools/process_command.ts';
import { join } from 'node:path';
import {
  assertSingleLocalEnvironment,
  localCa,
  LocalConfigurationError,
  localDatabaseUrl,
  localOrigin,
  localTls,
  parseLocalConfig,
} from '../tools/local_config.ts';
import { devContainerSettings } from '../tools/setup_devcontainer.ts';
import { prepareLocalFiles, serializeLocalEnvironment } from '../tools/setup_local.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { testEnvironment } from '../tools/testing/environment.ts';

const environment = {
  DATABASE_URL: 'postgres://developer:private-password@127.0.0.1:5433/qflow_local',
  QFLOW_APP_ORIGIN: localOrigin,
  QFLOW_DEV_ORIGIN: localOrigin,
  QFLOW_SECURE_COOKIES: 'true',
  QFLOW_ROOT_DOMAIN: '',
  QFLOW_COOKIE_DOMAIN: '',
  QFLOW_STORAGE_BACKEND: 'r2-binding',
  QFLOW_WRANGLER_CONFIG: 'wrangler.local.jsonc',
  QFLOW_DEV_TLS_CERT: '.artifacts/local-dev/cert.pem',
  QFLOW_DEV_TLS_KEY: '.artifacts/local-dev/key.pem',
  QFLOW_EMAIL_FROM: 'QFlow <local@example.test>',
  QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1: 'A'.repeat(43),
  QFLOW_RUNNER_KEY: 'private-runner-key',
  NODE_EXTRA_CA_CERTS: '/local-ca/rootCA.pem',
};

it('local preflight rejects competing environment files without changing their contents', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'qflow-local-environment-'));
  try {
    await writeFile(join(cwd, '.env.local'), 'DATABASE_URL=explicit-local-connection\n');
    assertSingleLocalEnvironment(cwd);
    for (const name of ['.env', '.dev.vars', '.dev.vars.local']) {
      await writeFile(join(cwd, name), 'PRIVATE_SETTING=fixture\n');
      expect(() => assertSingleLocalEnvironment(cwd)).toThrow(LocalConfigurationError);
      expect(await readFile(join(cwd, name), 'utf8')).toBe('PRIVATE_SETTING=fixture\n');
      await rm(join(cwd, name));
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

it('verification keeps orchestration settings while excluding developer application configuration', () => {
  const clean = testEnvironment({
    ...environment,
    QFLOW_AI_PROVIDER: 'cloudflare',
    QFLOW_SIGNUP_NOTIFY_BCC: '',
    QFLOW_BROWSER_TESTS: '1',
    QFLOW_HARBOR_INTEGRATION_TESTS: '1',
    QFLOW_HARBOR_TEST_ORIGIN: 'https://harbor.example.test',
    PATH: '/tools',
  });
  expect(clean.QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1).toBeUndefined();
  expect(clean.QFLOW_STORAGE_BACKEND).toBeUndefined();
  expect(clean.QFLOW_AI_PROVIDER).toBeUndefined();
  expect(clean.QFLOW_SIGNUP_NOTIFY_BCC).toBeUndefined();
  expect(clean.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV).toBe('false');
  expect(clean.QFLOW_WRANGLER_CONFIG).toBe('wrangler.local.jsonc');
  expect(clean.QFLOW_HARBOR_INTEGRATION_TESTS).toBe('1');
  expect(clean.QFLOW_HARBOR_TEST_ORIGIN).toBe('https://harbor.example.test');
  expect(clean.QFLOW_BROWSER_TESTS).toBe('1');
  expect(clean.PATH).toBe('/tools');
  expect(environment.QFLOW_STORAGE_BACKEND).toBe('r2-binding');
});

it('development and QA reject each other’s database and nonlocal database URLs', () => {
  expect(localDatabaseUrl(environment.DATABASE_URL)).toBe(environment.DATABASE_URL);
  expect(() => requireQaDatabaseUrl(environment.DATABASE_URL)).toThrow();
  for (const database of ['qflow_test', 'qflow_ci_test', 'qflow_dev', 'postgres']) {
    expect(() => localDatabaseUrl(environment.DATABASE_URL.replace('qflow_local', database)))
      .toThrow(LocalConfigurationError);
  }
  for (
    const value of [
      undefined,
      'private-invalid-value',
      'https://127.0.0.1/qflow_local',
      environment.DATABASE_URL.replace('127.0.0.1', 'production.example.test'),
    ]
  ) {
    expect(() => localDatabaseUrl(value)).toThrow(LocalConfigurationError);
  }
});

it('configuration establishes one HTTPS origin and reports several remedies without secrets', () => {
  const valid = parseLocalConfig(environment, '/project');
  expect(valid.origin.href).toBe(localOrigin + '/');
  expect(valid.tls?.certificatePath).toBe('/project/.artifacts/local-dev/cert.pem');
  expect(valid.wranglerConfig).toBe('/project/wrangler.local.jsonc');
  let failure: unknown;
  try {
    parseLocalConfig({
      ...environment,
      DATABASE_URL: 'invalid-private-value',
      QFLOW_SECURE_COOKIES: 'false',
      QFLOW_DEV_TLS_KEY: '',
    });
  } catch (cause: unknown) {
    failure = cause;
  }
  expect(failure).toBeInstanceOf(LocalConfigurationError);
  if (!(failure instanceof LocalConfigurationError)) {
    throw Error('Expected configuration diagnostic.');
  }
  expect(failure.message).toContain('DATABASE_URL');
  expect(failure.message).toContain('QFLOW_SECURE_COOKIES');
  expect(failure.message).toContain('QFLOW_DEV_TLS_KEY');
  for (
    const secret of ['invalid-private-value', 'private-password', environment.QFLOW_RUNNER_KEY]
  ) expect(failure.message).not.toContain(secret);
});

it('configuration rejects duplicated Hyperdrive settings and insecure or tenant-scoped local settings', () => {
  for (
    const changes of [
      { CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_QFLOW_DB: environment.DATABASE_URL },
      { QFLOW_APP_ORIGIN: 'http://127.0.0.1:5173' },
      { QFLOW_ROOT_DOMAIN: 'production.example.test' },
      { QFLOW_STORAGE_BACKEND: 's3-compatible' },
      { QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1: 'invalid-key' },
    ]
  ) expect(() => parseLocalConfig({ ...environment, ...changes })).toThrow(LocalConfigurationError);
});

it('local file serialization preserves secrets, literal characters and empty settings through Node dotenv parsing', () => {
  const settings = {
    ...environment,
    EMPTY: '',
    EMAIL: 'QFlow <local@example.test>',
    LITERAL: '# $HOME $(no-command) `no-command` \\path',
    QUOTED: "a'b",
    DOUBLE_QUOTED: 'a"b',
  };
  const serialized = serializeLocalEnvironment(settings);
  expect(parseEnv(serialized)).toEqual(settings);
  expect(serializeLocalEnvironment(Object.fromEntries(Object.entries(settings).reverse()))).toBe(
    serialized,
  );
  expect(() => serializeLocalEnvironment({ INVALID: 'first\nsecond' })).toThrow();
  expect(() => serializeLocalEnvironment({ 'INVALID-NAME': 'value' })).toThrow();
});

it('forwarded development keeps HTTPS browser identity separate from its loopback HTTP listener', () => {
  const cloud = devContainerSettings({
    QFLOW_DEV_CONTAINER: 'true',
    CODESPACES: 'true',
    CODESPACE_NAME: 'qflow-quiet-river',
    GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
  });
  const configured = parseLocalConfig({ ...environment, ...cloud }, '/project');
  expect(configured.origin.origin).toBe('https://qflow-quiet-river-5173.app.github.dev');
  expect(configured.listenOrigin.origin).toBe('http://127.0.0.1:5173');
  expect(configured.tls).toBeUndefined();
  expect(localTls(configured)).toBeUndefined();
  expect(localCa(configured)).toBeUndefined();
  for (
    const changes of [
      { QFLOW_DEV_ORIGIN: 'http://0.0.0.0:5173' },
      { QFLOW_DEV_ORIGIN: 'http://127.0.0.1' },
      { QFLOW_DEV_ORIGIN: 'http://127.0.0.1:5173/path' },
      { QFLOW_APP_ORIGIN: 'http://cloud.example.test' },
      { QFLOW_APP_ORIGIN: localOrigin },
      { QFLOW_APP_ORIGIN: 'https://secret@cloud.example.test' },
      { QFLOW_APP_ORIGIN: 'https://cloud.example.test/?query=secret' },
      { QFLOW_DEV_TLS_CERT: 'unrelated-local-cert.pem' },
      { NODE_EXTRA_CA_CERTS: 'unrelated-local-ca.pem' },
    ]
  ) {
    expect(() => parseLocalConfig({ ...environment, ...cloud, ...changes })).toThrow(
      LocalConfigurationError,
    );
  }
});

it('container setup requires explicit provider metadata and leaves native database guards intact', () => {
  expect(() => devContainerSettings({})).toThrow(LocalConfigurationError);
  for (
    const changes of [
      { CODESPACE_NAME: '' },
      { CODESPACE_NAME: 'name/path' },
      { GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: '' },
      { GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'https://app.github.dev' },
    ]
  ) {
    expect(() =>
      devContainerSettings({
        QFLOW_DEV_CONTAINER: 'true',
        CODESPACES: 'true',
        CODESPACE_NAME: 'qflow-quiet-river',
        GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
        ...changes,
      })
    ).toThrow(LocalConfigurationError);
  }
  const desktop = devContainerSettings({ QFLOW_DEV_CONTAINER: 'true' });
  expect(desktop.QFLOW_APP_ORIGIN).toBe(localOrigin);
  expect(desktop.QFLOW_DEV_ORIGIN).toBe(localOrigin);
  expect(localDatabaseUrl(desktop.DATABASE_URL)).toBe(
    'postgres://qflow:qflow@127.0.0.1:5432/qflow_local',
  );
  expect(() => requireQaDatabaseUrl(desktop.DATABASE_URL)).toThrow();
});

it('cloud setup writes private reusable configuration without certificates or production resources', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'qflow-container-setup-'));
  try {
    for (const name of ['.env.example', 'wrangler.example.jsonc']) {
      await copyFile(name, join(cwd, name));
    }
    const settings = devContainerSettings({
      QFLOW_DEV_CONTAINER: 'true',
      CODESPACES: 'true',
      CODESPACE_NAME: 'qflow-quiet-river',
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
    });
    const first = await prepareLocalFiles(cwd, settings);
    const second = await prepareLocalFiles(cwd, settings);
    expect(second.QFLOW_RUNNER_KEY).toBe(first.QFLOW_RUNNER_KEY);
    expect(second.QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1).toBe(
      first.QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1,
    );
    expect(parseLocalConfig(second, cwd).tls).toBeUndefined();
    expect(parseEnv(await readFile(join(cwd, '.env.local'), 'utf8'))).toEqual(second);
    expect((await stat(join(cwd, '.env.local'))).mode & 0o777).toBe(0o600);
    const worker: unknown = JSON.parse(await readFile(join(cwd, 'wrangler.local.jsonc'), 'utf8'));
    expect(worker).toMatchObject({ name: 'qflow-local', vars: {}, workers_dev: false });
    expect(worker).not.toHaveProperty('routes');
    expect(worker).not.toHaveProperty('account_id');
    await expect(stat(join(cwd, '.artifacts/local-dev/cert.pem'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

it('container lifecycle refuses to replace a native checkout’s environment file', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'qflow-container-native-guard-'));
  const contents =
    'DATABASE_URL=postgres://native-only@127.0.0.1/qflow_local\nQFLOW_RUNNER_KEY=private-native-key\n';
  try {
    await writeFile(join(cwd, '.env.local'), contents);
    const result = await runCommand(process.execPath, [
      '--import',
      import.meta.resolve('tsx'),
      fileURLToPath(new URL('../tools/setup_devcontainer.ts', import.meta.url)),
    ], {
      cwd,
      env: {
        QFLOW_DEV_CONTAINER: 'true',
        CODESPACES: 'true',
        CODESPACE_NAME: 'qflow-quiet-river',
        GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
      },
    });
    expect(result.success).toBe(false);
    const diagnostic = new TextDecoder().decode(result.stderr);
    expect(diagnostic).toContain('will not overwrite it');
    expect(diagnostic).not.toContain('private-native-key');
    expect(await readFile(join(cwd, '.env.local'), 'utf8')).toBe(contents);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

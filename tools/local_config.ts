import { createPrivateKey, X509Certificate } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export class LocalConfigurationError extends Error {}

export const localOrigin = 'https://127.0.0.1:5173';
export const localDatabaseName = 'qflow_local';

/** Reject competing Wrangler environment files before they can override the declared local path. */
export function assertSingleLocalEnvironment(cwd = process.cwd()): void {
  if (
    existsSync(resolve(cwd, '.env')) ||
    readdirSync(cwd).some((name) => name === '.dev.vars' || name.startsWith('.dev.vars.'))
  ) {
    throw new LocalConfigurationError(
      'Use .env.local only. Move local settings out of .env and .dev.vars files, then remove those files.',
    );
  }
}

export type LocalDevelopmentConfig = {
  readonly databaseUrl: string;
  readonly origin: URL;
  readonly listenOrigin: URL;
  readonly tls: {
    readonly certificatePath: string;
    readonly keyPath: string;
    readonly caPath: string;
  } | undefined;
  readonly wranglerConfig: string;
};

/** Local development is explicit and cannot use the databases owned by verification. */
export function localDatabaseUrl(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new LocalConfigurationError(
      'Set DATABASE_URL in .env.local to the local PostgreSQL qflow_local database.',
    );
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/' + localDatabaseName
  ) {
    throw new LocalConfigurationError(
      'Development requires a loopback PostgreSQL connection to qflow_local. Tests use qflow_test.',
    );
  }
  return url.href;
}

/** Parse startup settings once; diagnostics contain names and remedies, never configured values. */
export function parseLocalConfig(
  environment: Readonly<NodeJS.ProcessEnv>,
  cwd = process.cwd(),
): LocalDevelopmentConfig {
  const issues: string[] = [];
  let databaseUrl = '';
  try {
    databaseUrl = localDatabaseUrl(environment.DATABASE_URL);
  } catch {
    issues.push(
      'DATABASE_URL must select the loopback qflow_local database. Run pnpm setup:local.',
    );
  }
  const origin = parseOrigin(environment.QFLOW_APP_ORIGIN);
  const listenOrigin = parseOrigin(environment.QFLOW_DEV_ORIGIN);
  if (!origin || origin.protocol !== 'https:') {
    issues.push('Set QFLOW_APP_ORIGIN to the browser-facing HTTPS origin in .env.local.');
  }
  if (
    !listenOrigin || !['http:', 'https:'].includes(listenOrigin.protocol) ||
    listenOrigin.hostname !== '127.0.0.1' || !listenOrigin.port
  ) {
    issues.push(
      'Set QFLOW_DEV_ORIGIN to an explicit HTTP or HTTPS origin on 127.0.0.1 with a port.',
    );
  }
  if (origin && listenOrigin) {
    if (listenOrigin.protocol === 'https:' && origin.origin !== listenOrigin.origin) {
      issues.push(
        'Direct HTTPS development requires matching QFLOW_APP_ORIGIN and QFLOW_DEV_ORIGIN.',
      );
    }
    if (
      listenOrigin.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
    ) {
      issues.push('HTTP development requires an upstream HTTPS preview URL in QFLOW_APP_ORIGIN.');
    }
  }
  if (environment.QFLOW_SECURE_COOKIES !== 'true') {
    issues.push('Set QFLOW_SECURE_COOKIES=true in .env.local.');
  }
  for (const name of ['QFLOW_ROOT_DOMAIN', 'QFLOW_COOKIE_DOMAIN']) {
    if (environment[name] !== '') issues.push(`Set ${name} to an empty value in .env.local.`);
  }
  if (environment.QFLOW_STORAGE_BACKEND !== 'r2-binding') {
    issues.push('Set QFLOW_STORAGE_BACKEND=r2-binding in .env.local.');
  }
  for (
    const name of [
      'QFLOW_WRANGLER_CONFIG',
      'QFLOW_EMAIL_FROM',
    ]
  ) {
    if (!environment[name]) issues.push(`Set ${name} in .env.local. Run pnpm setup:local.`);
  }
  const tlsNames = ['QFLOW_DEV_TLS_CERT', 'QFLOW_DEV_TLS_KEY', 'NODE_EXTRA_CA_CERTS'];
  for (const name of tlsNames) {
    if (listenOrigin?.protocol === 'https:' && !environment[name]) {
      issues.push(`Set ${name} in .env.local. Run pnpm setup:local.`);
    }
    if (listenOrigin?.protocol === 'http:' && environment[name]) {
      issues.push(`Clear ${name} when HTTPS is terminated by the preview proxy.`);
    }
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(environment.QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1 ?? '')) {
    issues.push(
      'Set a base64url-encoded 32-byte QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1. Run pnpm setup:local.',
    );
  }
  if (!environment.QFLOW_RUNNER_KEY || environment.QFLOW_RUNNER_KEY === 'change-me') {
    issues.push('Set QFLOW_RUNNER_KEY. Run pnpm setup:local.');
  }
  if (environment.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_QFLOW_DB) {
    issues.push(
      'Remove CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_QFLOW_DB from .env.local; dev and preview derive it from DATABASE_URL.',
    );
  }
  if (issues.length || !origin || !listenOrigin) {
    throw new LocalConfigurationError(issues.join('\n'));
  }
  return {
    databaseUrl,
    origin,
    listenOrigin,
    tls: listenOrigin.protocol === 'https:'
      ? {
        certificatePath: resolve(cwd, environment.QFLOW_DEV_TLS_CERT ?? ''),
        keyPath: resolve(cwd, environment.QFLOW_DEV_TLS_KEY ?? ''),
        caPath: resolve(cwd, environment.NODE_EXTRA_CA_CERTS ?? ''),
      }
      : undefined,
    wranglerConfig: resolve(cwd, environment.QFLOW_WRANGLER_CONFIG ?? ''),
  };
}

/** Use the explicitly configured local CA for Node requests; never disable certificate checks. */
export function localCa(config: LocalDevelopmentConfig): Buffer | undefined {
  if (!config.tls) return undefined;
  const ca = readFileSync(config.tls.caPath);
  const root = new X509Certificate(ca);
  const leaf = new X509Certificate(readFileSync(config.tls.certificatePath));
  if (!root.ca || !leaf.verify(root.publicKey)) {
    throw new LocalConfigurationError(
      'NODE_EXTRA_CA_CERTS must name the CA that signed the local certificate.',
    );
  }
  return ca;
}

/** Check the certificate, key, expiry and hostname without weakening TLS verification. */
export function localTls(
  config: LocalDevelopmentConfig,
): { cert: Buffer; key: Buffer } | undefined {
  if (!config.tls) return undefined;
  const cert = readFileSync(config.tls.certificatePath);
  const key = readFileSync(config.tls.keyPath);
  const certificate = new X509Certificate(cert);
  const now = Date.now();
  if (
    !certificate.checkIP('127.0.0.1') ||
    now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo) ||
    !certificate.checkPrivateKey(createPrivateKey(key))
  ) {
    throw new LocalConfigurationError(
      'The local certificate must be current, cover 127.0.0.1 and match its private key. Run pnpm run doctor.',
    );
  }
  return { cert, key };
}

function parseOrigin(value: string | undefined): URL | undefined {
  try {
    const url = new URL(value ?? '');
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

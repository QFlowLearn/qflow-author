import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { hasFileErrorCode } from './file_errors.ts';
import { LocalConfigurationError, localOrigin } from './local_config.ts';
import { runCommand } from './process_command.ts';
import { prepareLocalFiles } from './setup_local.ts';

/** Resolve provider metadata at setup, never from HTTP headers or production application code. */
export function devContainerSettings(
  environment: Readonly<NodeJS.ProcessEnv>,
): Record<string, string> {
  if (environment.QFLOW_DEV_CONTAINER !== 'true') {
    throw new LocalConfigurationError('Run container setup inside the QFlow Dev Container.');
  }
  const settings: Record<string, string> = {
    QFLOW_DEV_CONTAINER: 'true',
    DATABASE_URL: 'postgres://qflow:qflow@127.0.0.1:5432/qflow_local',
    QFLOW_APP_ORIGIN: localOrigin,
    QFLOW_DEV_ORIGIN: localOrigin,
    QFLOW_DEV_TLS_CERT: '.artifacts/local-dev/cert.pem',
    QFLOW_DEV_TLS_KEY: '.artifacts/local-dev/key.pem',
  };
  if (environment.CODESPACES === 'true') {
    const name = environment.CODESPACE_NAME;
    const domain = environment.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
    if (
      !name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
      !domain || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(domain)
    ) {
      throw new LocalConfigurationError(
        'Codespaces must supply CODESPACE_NAME and GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN.',
      );
    }
    Object.assign(settings, {
      QFLOW_APP_ORIGIN: `https://${name}-5173.${domain}`,
      QFLOW_DEV_ORIGIN: 'http://127.0.0.1:5173',
      QFLOW_DEV_TLS_CERT: '',
      QFLOW_DEV_TLS_KEY: '',
      NODE_EXTRA_CA_CERTS: '',
    });
  } else if (environment.CODESPACES && environment.CODESPACES !== 'false') {
    throw new LocalConfigurationError('CODESPACES must be true or false when supplied.');
  }
  return settings;
}

async function setup(): Promise<void> {
  const settings = devContainerSettings(process.env);
  try {
    const existing = parseEnv(await readFile('.env.local', 'utf8'));
    if (
      existing.QFLOW_DEV_CONTAINER !== 'true' || existing.DATABASE_URL !== settings.DATABASE_URL
    ) {
      throw new LocalConfigurationError(
        'This checkout has a native .env.local. Use a fresh clone for the Dev Container, or move that file outside the checkout deliberately before rebuilding. Container setup will not overwrite it.',
      );
    }
  } catch (cause: unknown) {
    if (!hasFileErrorCode(cause, 'ENOENT')) throw cause;
  }
  if (settings.QFLOW_DEV_ORIGIN === localOrigin) {
    // This command runs only inside the declared container. Host/browser trust remains manual.
    const trust = await runCommand('mkcert', ['-install'], { output: 'capture' });
    if (!trust.success) {
      throw new LocalConfigurationError(
        'Could not prepare the development CA inside the container.',
      );
    }
  }
  await prepareLocalFiles(process.cwd(), settings);
  console.log('Container configuration ready. The application starts only when you run pnpm dev.');
}

if (import.meta.main) {
  try {
    await setup();
  } catch (cause: unknown) {
    console.error(
      cause instanceof LocalConfigurationError
        ? cause.message
        : `Container setup failed: ${safeErrorSummary(cause)}. See docs/development.md.`,
    );
    process.exitCode = 1;
  }
}

import process from 'node:process';
import { getRuntimeBinding, getRuntimeStringBinding, type RuntimeSource } from './runtime.ts';

export function getEnv(key: string, runtime?: RuntimeSource): string | undefined {
  const runtimeValue = getRuntimeStringBinding(runtime, key);
  if (runtimeValue !== undefined) return runtimeValue;

  return process.env[key];
}

export function requireEnv(key: string, runtime?: RuntimeSource): string {
  const value = getEnv(key, runtime);
  if (!value) throw new Error(`Missing required env var ${key}`);
  return value;
}

/** Validated database mode; Hyperdrive identity belongs to its request scope. */
export type DatabaseConfiguration =
  | { readonly _tag: 'Direct'; readonly url: string }
  | { readonly _tag: 'Hyperdrive'; readonly url: string; readonly binding: object };

/** Resolve and validate one database mode before constructing an adapter. */
export function getDatabaseConfiguration(runtime?: RuntimeSource): DatabaseConfiguration {
  const binding = getRuntimeBinding(runtime, 'QFLOW_DB');
  if (binding !== undefined) {
    if (
      binding === null || typeof binding !== 'object' || !('connectionString' in binding) ||
      typeof binding.connectionString !== 'string'
    ) throw new Error('Invalid QFLOW_DB Hyperdrive binding.');
    return {
      _tag: 'Hyperdrive',
      binding,
      url: requireDatabaseUrl(binding.connectionString, 'QFLOW_DB'),
    };
  }
  const value = getEnv('DATABASE_URL', runtime);
  if (value === undefined) {
    throw new Error('Missing required database connection. Set DATABASE_URL or bind QFLOW_DB.');
  }
  return { _tag: 'Direct', url: requireDatabaseUrl(value, 'DATABASE_URL') };
}

/** Read the URL from the same validated mode used by database construction. */
export function getDatabaseUrl(runtime?: RuntimeSource): string {
  return getDatabaseConfiguration(runtime).url;
}

function requireDatabaseUrl(value: string, source: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${source} database connection.`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
    url.pathname.length <= 1
  ) {
    throw new Error(`Invalid ${source} database connection.`);
  }
  return value;
}

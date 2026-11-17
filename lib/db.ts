import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { hyperdriveSocket } from './hyperdrive_socket.ts';
import { getDatabaseConfiguration, getDatabaseUrl } from './config.ts';
import { getRuntimeBinding, resolveRequestDatabase, type RuntimeSource } from './runtime.ts';

type DbClient = ReturnType<typeof drizzle>;
type PostgresClient = ReturnType<typeof postgres>;
type DbCacheEntry = { db: DbClient; client: PostgresClient };

/** Application database capability supplied explicitly at non-request runtime boundaries. */
export type QflowDatabase = DbClient;

/** Transaction capability created by the application database adapter. */
export type QflowDatabaseTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

/** Read operations shared by the database client and caller-owned transactions. */
export type DbReadConnection = Pick<DbClient, 'select'>;

const dbCache = new Map<string, DbCacheEntry>();
function createDirectPostgresDb(databaseUrl: string): DbCacheEntry {
  const pg = postgres(databaseUrl, {
    max_lifetime: null,
    prepare: false,
  });
  return { db: drizzle(pg), client: pg };
}

function createHyperdriveDb(databaseUrl: string): DbCacheEntry {
  // Postgres.js documents socket factories but omits them from its option type.
  const options = {
    max: 5,
    prepare: true,
    fetch_types: false,
    socket: hyperdriveSocket(databaseUrl),
  };
  const pg = postgres(databaseUrl, options);
  return { db: drizzle(pg), client: pg };
}

/** Own a Hyperdrive client for one durable step; release sockets on success and failure. */
export async function withHyperdriveDatabase<T>(
  runtime: RuntimeSource,
  operation: (database: QflowDatabase) => Promise<T>,
): Promise<T> {
  if (getRuntimeBinding(runtime, 'QFLOW_DB') === undefined) {
    throw new Error('A step-owned database requires the QFLOW_DB Hyperdrive binding.');
  }
  const configuration = getDatabaseConfiguration(runtime);
  if (configuration._tag !== 'Hyperdrive') {
    throw new Error('A step-owned database requires the QFLOW_DB Hyperdrive binding.');
  }
  const entry = createHyperdriveDb(configuration.url);
  try {
    return await operation(entry.db);
  } finally {
    await entry.client.end({ timeout: 5 });
  }
}

export function getDb(runtime?: RuntimeSource): DbClient {
  const configuration = getDatabaseConfiguration(runtime);
  const databaseUrl = configuration.url;
  if (configuration._tag === 'Hyperdrive') {
    return resolveRequestDatabase(configuration.binding, () => createHyperdriveDb(databaseUrl).db);
  }

  // Direct Postgres runs in a normal CLI process, where client reuse is desired.
  let entry = dbCache.get(databaseUrl);
  if (!entry) {
    entry = createDirectPostgresDb(databaseUrl);
    dbCache.set(databaseUrl, entry);
  }
  return entry.db;
}

export const db = new Proxy({} as DbClient, {
  get(_target, prop) {
    const real = getDb();
    const value: unknown = Reflect.get(real, prop, real);
    if (typeof value === 'function') return value.bind(real);
    return value;
  },
});

export async function shutdownDb(runtime?: RuntimeSource) {
  if (runtime !== undefined) {
    const databaseUrl = getDatabaseUrl(runtime);
    const entry = dbCache.get(databaseUrl);
    if (!entry) return;
    dbCache.delete(databaseUrl);
    await entry.client.end();
    return;
  }

  const entries = [...dbCache.values()];
  dbCache.clear();
  await Promise.all(entries.map((entry) => entry.client.end()));
}

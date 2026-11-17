import { runCommand } from './process_command.ts';
import { startFetchServer } from '../tests/helpers/fetch_server.ts';

import postgres from 'postgres';

declare const evidenceDatabaseBaseUrlBrand: unique symbol;

/** Explicit database reserved for destructive Respondus evidence runs. */
export type EvidenceDatabaseBaseUrl = string & {
  readonly [evidenceDatabaseBaseUrlBrand]: 'EvidenceDatabaseBaseUrl';
};

/** Safe configuration failure returned before an evidence database can be used. */
export type InvalidEvidenceDatabaseUrl = {
  readonly _tag: 'InvalidEvidenceDatabaseUrl';
  readonly message: string;
};

/** Result of parsing the dedicated evidence database URL from startup configuration. */
export type EvidenceDatabaseUrlParseResult =
  | { readonly ok: true; readonly value: EvidenceDatabaseBaseUrl }
  | { readonly ok: false; readonly error: InvalidEvidenceDatabaseUrl };

/** Disposable database schema and object store used by one Respondus evidence run. */
export type RespondusWedgeEnvironment = {
  readonly databaseUrl: string;
  readonly appEnvironment: Readonly<Record<string, string>>;
  close(): Promise<void>;
};

/**
 * Parses a database URL that is explicitly named for evidence or test data.
 *
 * The environment owns its own search path, so caller-provided connection options are rejected.
 */
export function parseEvidenceDatabaseBaseUrl(
  input: string | undefined,
): EvidenceDatabaseUrlParseResult {
  if (!input?.trim()) {
    return invalidDatabaseUrl(
      'QFLOW_EVIDENCE_DATABASE_URL must name a dedicated evidence or test database.',
    );
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return invalidDatabaseUrl('QFLOW_EVIDENCE_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return invalidDatabaseUrl('QFLOW_EVIDENCE_DATABASE_URL must use postgres or postgresql.');
  }
  if (url.searchParams.has('options')) {
    return invalidDatabaseUrl('QFLOW_EVIDENCE_DATABASE_URL must not define PostgreSQL options.');
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!/(^|_)(evidence|test)($|_)/.test(databaseName)) {
    return invalidDatabaseUrl(
      'QFLOW_EVIDENCE_DATABASE_URL database name must contain "evidence" or "test".',
    );
  }
  // SAFETY: URL parsing and the dedicated-database name check establish the evidence URL contract.
  return { ok: true, value: url.toString() as EvidenceDatabaseBaseUrl };
}

/**
 * Creates an isolated schema, applies current migrations, and starts a local S3-compatible store.
 *
 * Closing the environment drops the entire schema. No table-specific teardown is required.
 */
export async function createRespondusWedgeEnvironment(
  baseDatabaseUrl: EvidenceDatabaseBaseUrl,
): Promise<RespondusWedgeEnvironment> {
  const schemaName = `qflow_evidence_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = postgres(baseDatabaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
  });
  let schemaCreated = false;
  try {
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;
    const databaseUrl = databaseUrlForSchema(baseDatabaseUrl, schemaName);
    await runMigrations(databaseUrl);
    const storage = await startLocalStorageServer();
    await admin.end({ timeout: 5 });

    let closed = false;
    return {
      databaseUrl,
      appEnvironment: {
        DATABASE_URL: databaseUrl,
        QFLOW_STORAGE_BACKEND: 's3-compatible',
        R2_ENDPOINT: storage.endpoint,
        R2_ACCESS_KEY_ID: 'qflow-respondus-evidence',
        R2_SECRET_ACCESS_KEY: 'qflow-respondus-evidence-secret',
        R2_BUCKET: 'qflow-respondus-evidence',
        R2_FORCE_PATH_STYLE: 'true',
      },
      async close() {
        if (closed) return;
        closed = true;
        const results = await Promise.allSettled([
          storage.shutdown(),
          dropSchema(baseDatabaseUrl, schemaName),
        ]);
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason);
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Respondus evidence environment cleanup failed.');
        }
      },
    };
  } catch (cause: unknown) {
    if (schemaCreated) await dropSchemaWithClient(admin, schemaName).catch(() => {});
    await admin.end({ timeout: 5 }).catch(() => {});
    throw new Error('Could not create the Respondus evidence environment.', { cause });
  }
}

function invalidDatabaseUrl(message: string): EvidenceDatabaseUrlParseResult {
  return {
    ok: false,
    error: {
      _tag: 'InvalidEvidenceDatabaseUrl',
      message,
    },
  };
}

function databaseUrlForSchema(
  baseDatabaseUrl: EvidenceDatabaseBaseUrl,
  schemaName: string,
): string {
  const url = new URL(baseDatabaseUrl);
  url.searchParams.set('options', `-c search_path=${schemaName}`);
  return url.toString();
}

async function runMigrations(databaseUrl: string): Promise<void> {
  const status = await runCommand(process.execPath, ['--import', 'tsx', 'tools/db.ts', 'migrate'], {
    env: { DATABASE_URL: databaseUrl },
    output: 'inherit',
  });
  if (!status.success) {
    throw new Error(`Evidence database migration failed with exit code ${status.code}.`);
  }
}

async function dropSchema(
  baseDatabaseUrl: EvidenceDatabaseBaseUrl,
  schemaName: string,
): Promise<void> {
  const admin = postgres(baseDatabaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
  });
  try {
    await dropSchemaWithClient(admin, schemaName);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function dropSchemaWithClient(
  admin: ReturnType<typeof postgres>,
  schemaName: string,
): Promise<void> {
  await admin.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
}

type LocalStorageServer = {
  readonly endpoint: string;
  shutdown(): Promise<void>;
};

async function startLocalStorageServer(): Promise<LocalStorageServer> {
  const objects = new Map<string, Uint8Array>();
  const server = await startFetchServer(async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/qflow-respondus-evidence/')) {
      return new Response('Not Found', { status: 404 });
    }
    if (request.method === 'PUT') {
      objects.set(url.pathname, new Uint8Array(await request.arrayBuffer()));
      return new Response(null, { status: 200 });
    }
    if (request.method === 'GET') {
      const object = objects.get(url.pathname);
      return object
        ? new Response(object.slice().buffer, { status: 200 })
        : new Response('Not Found', { status: 404 });
    }
    return new Response('Method Not Allowed', { status: 405 });
  });
  return {
    endpoint: `http://${'127.0.0.1'}:${server.port}`,
    shutdown: () => server.close(),
  };
}

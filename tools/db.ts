#!/usr/bin/env -S node --import tsx
import * as _fs from 'node:fs/promises';
import { hasFileErrorCode } from './file_errors.ts';
import * as _path from 'node:path';
import * as _url from 'node:url';

import { join } from 'node:path';
import { fileURLToPath as fromFileUrl } from 'node:url';
import postgres from 'postgres';
import { getDatabaseUrl } from '../lib/config.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import {
  applyOidcClientSecretMigration,
  OIDC_CLIENT_SECRET_MIGRATION_ID,
} from './migrations/encrypt_oidc_client_secrets.ts';

const ROOT = fromFileUrl(new URL('..', import.meta.url));
const MIGRATIONS_DIR = join(ROOT, 'db', 'migrations');
const SEEDS_DIR = join(ROOT, 'db', 'seeds');
type SqlClient = ReturnType<typeof postgres>;

type MigrationEntry =
  | { readonly _tag: 'Sql'; readonly id: string; readonly path: string }
  | {
    readonly _tag: 'Application';
    readonly id: string;
    readonly apply: (sql: SqlClient) => Promise<void>;
  };

const APPLICATION_MIGRATIONS: readonly MigrationEntry[] = [{
  _tag: 'Application',
  id: OIDC_CLIENT_SECRET_MIGRATION_ID,
  apply: applyOidcClientSecretMigration,
}];

/** The live migration sources, shared by migration application and read-only local diagnostics. */
export async function expectedMigrationIds(): Promise<readonly string[]> {
  return [...await listSqlFiles(MIGRATIONS_DIR), ...APPLICATION_MIGRATIONS.map((entry) => entry.id)]
    .sort();
}

async function main() {
  const command = process.argv.slice(2)[0];
  if (!command || !['migrate', 'seed'].includes(command)) {
    console.error('Usage: node --import tsx tools/db.ts [migrate|seed]');
    process.exit(1);
  }

  const databaseUrl = getDatabaseUrl();
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });

  try {
    if (command === 'migrate') {
      await runMigrations(sql);
    } else {
      await runSeeds(sql);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function runMigrations(sql: SqlClient) {
  await ensureMigrationsTable(sql);
  await runMigrationDirectory(sql, MIGRATIONS_DIR);
  console.log('Migrations complete.');
}

async function runMigrationDirectory(sql: SqlClient, directory: string, prefix = '') {
  const files = await listSqlFiles(directory);
  const migrations: MigrationEntry[] = [
    ...files.map((file): MigrationEntry => ({
      _tag: 'Sql',
      id: `${prefix}${file}`,
      path: join(directory, file),
    })),
    ...(prefix ? [] : APPLICATION_MIGRATIONS),
  ];
  migrations.sort((left, right) => left.id.localeCompare(right.id));
  assertUniqueMigrationIds(migrations);

  for (const migration of migrations) {
    const migrationId = migration.id;
    const already =
      await sql`SELECT filename FROM schema_migrations WHERE filename = ${migrationId}`;
    if (already.length) {
      continue;
    }
    console.log(`Applying migration ${migrationId} ...`);
    if (migration._tag === 'Sql') {
      await executeSqlFile(sql, migration.path, migrationId, migrationId);
      continue;
    }
    await migration.apply(sql);
    const recorded =
      await sql`SELECT filename FROM schema_migrations WHERE filename = ${migrationId}`;
    if (!recorded.length) {
      throw new Error(`Application migration ${migrationId} did not record its ledger entry.`);
    }
  }
}

function assertUniqueMigrationIds(migrations: readonly MigrationEntry[]): void {
  const ids = new Set<string>();
  for (const migration of migrations) {
    if (ids.has(migration.id)) throw new Error(`Duplicate migration ID ${migration.id}.`);
    ids.add(migration.id);
  }
}

async function runSeeds(sql: SqlClient) {
  const files = await listSqlFiles(SEEDS_DIR);
  if (!files.length) {
    console.log(
      'No SQL seed files found. Sign in and use onboarding to create demo content.',
    );
    return;
  }
  for (const file of files) {
    const fullPath = join(SEEDS_DIR, file);
    console.log(`Running seed ${file} ...`);
    await executeSqlFile(sql, fullPath, file);
  }
  console.log('Seeds complete.');
}

async function ensureMigrationsTable(sql: SqlClient) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      executed_at timestamptz DEFAULT now()
    )
  `);
}

async function listSqlFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for await (const entry of await _fs.opendir(dir)) {
      if (entry.isFile() && entry.name.endsWith('.sql')) {
        files.push(entry.name);
      }
    }
  } catch (error) {
    if (hasFileErrorCode(error, 'ENOENT')) {
      return [];
    }
    throw error;
  }
  return files.sort();
}

async function executeSqlFile(
  sql: SqlClient,
  path: string,
  label: string,
  migrationId?: string,
) {
  const sqlText = await _fs.readFile(path, 'utf8');
  const statements = splitSqlStatements(sqlText);
  if (!statements.length) {
    console.warn(`File ${label} is empty; skipping.`);
    if (!migrationId) return;
  }
  try {
    await sql.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement);
      }
      if (migrationId) {
        await tx`INSERT INTO schema_migrations (filename) VALUES (${migrationId})`;
      }
    });
  } catch (error) {
    throw new Error(`Failed while executing ${label}: ${safeErrorSummary(error)}`);
  }
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inDollarTag: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      current += char;
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inDollarTag) {
      if (char === '-' && next === '-') {
        inLineComment = true;
        current += char;
        continue;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        current += char;
        continue;
      }
    }

    if (!inDoubleQuote && !inDollarTag && char === "'") {
      if (inSingleQuote && next === "'") {
        current += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDollarTag && char === '"') {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '$') {
      const tag = readDollarTag(sql, i);
      if (tag) {
        if (inDollarTag === null) {
          inDollarTag = tag;
          current += tag;
          i += tag.length - 1;
          continue;
        }
        if (sql.startsWith(inDollarTag, i)) {
          current += inDollarTag;
          i += inDollarTag.length - 1;
          inDollarTag = null;
          continue;
        }
      }
    }

    if (!inSingleQuote && !inDoubleQuote && !inDollarTag && char === ';') {
      if (current.trim().length) {
        statements.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim().length) {
    statements.push(current.trim());
  }

  return statements;
}

function readDollarTag(sql: string, index: number): string | null {
  if (sql[index] !== '$') return null;
  let end = index + 1;
  while (end < sql.length && /[0-9A-Za-z_]/.test(sql[end])) {
    end++;
  }
  if (sql[end] === '$') {
    return sql.slice(index, end + 1);
  }
  if (sql[index + 1] === '$') {
    return '$$';
  }
  return null;
}

if ((process.argv[1] && _path.resolve(process.argv[1]) === _url.fileURLToPath(import.meta.url))) {
  await main();
}

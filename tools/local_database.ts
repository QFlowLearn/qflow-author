import postgres from 'postgres';
import { expectedMigrationIds } from './db.ts';

/** Inspect identity, PostgreSQL major version and migration ledger without changing the database. */
export async function localDatabaseStatus(databaseUrl: string): Promise<{
  readonly ok: boolean;
  readonly message: string;
}> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 3, idle_timeout: 1 });
  try {
    try {
      const rows = await sql<
        { name: string; version: string }[]
      >`select current_database() as name, current_setting('server_version_num') as version`;
      if (
        '/' + rows[0]?.name !== new URL(databaseUrl).pathname ||
        Math.floor(Number(rows[0]?.version) / 10000) !== 17
      ) {
        return {
          ok: false,
          message: 'Check the configured database identity and PostgreSQL 17 version.',
        };
      }
      const applied = new Set(
        (await sql<{ filename: string }[]>`select filename from schema_migrations`).map((row) =>
          row.filename
        ),
      );
      if ((await expectedMigrationIds()).some((id) => !applied.has(id))) {
        return { ok: false, message: 'Schema is behind. Stop the app and run pnpm setup:local.' };
      }
      return { ok: true, message: 'PostgreSQL 17 and schema ready' };
    } finally {
      await sql.end({ timeout: 1 });
    }
  } catch {
    return {
      ok: false,
      message:
        'Cannot inspect the schema. Check PostgreSQL and DATABASE_URL, then run pnpm setup:local.',
    };
  }
}

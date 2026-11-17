import { safeErrorSummary } from '../lib/error_summary.ts';

import postgres from 'postgres';
import { requirePostgresDatabaseUrl } from './test_database_url.ts';

export async function main(): Promise<void> {
  let databaseUrl: string;
  try {
    databaseUrl = requirePostgresDatabaseUrl(process.env['DATABASE_URL']);
  } catch (cause: unknown) {
    console.error('Database preflight configuration failed.');
    console.error(safeErrorSummary(cause));
    process.exitCode = 1;
    return;
  }

  const client = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 1,
    connect_timeout: 3,
  });

  try {
    await client`select 1 as ok`;
    console.log('Database preflight passed.');
  } catch (error) {
    console.error('Database preflight failed.');
    console.error(safeErrorSummary(error));
    process.exitCode = 1;
  } finally {
    await client.end({ timeout: 1 });
  }
}
if (import.meta.main) await main();

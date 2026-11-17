import { expect, test as testCase } from 'vitest';

import postgres from 'postgres';

import { decryptCredential } from '../lib/credential_cipher.ts';
import { reveal } from '../lib/redacted.ts';
import {
  applyOidcClientSecretMigration,
  OIDC_CLIENT_SECRET_MIGRATION_ID,
} from '../tools/migrations/encrypt_oidc_client_secrets.ts';
import { oidcTestRuntime } from './oidc_config_fixture.ts';

const DATABASE_URL = process.env['DATABASE_URL'];

testCase('OIDC credential migration encrypts, renames, and records one atomic migration', {
  skip: !DATABASE_URL,
}, async function () {
  const databaseUrl = DATABASE_URL;
  if (!databaseUrl) return;
  await withLegacyOidcSchema(databaseUrl, false, async (sql) => {
    const tenantId = crypto.randomUUID();
    const plaintext = 'v1.legacy-value-that-is-still-plaintext';
    await sql`
        INSERT INTO oidc_tenant_configs (tenant_id, provider, client_secret)
        VALUES (${tenantId}, 'google', ${plaintext})
      `;

    await applyOidcClientSecretMigration(sql, oidcTestRuntime());

    expect(await oidcColumnNames(sql)).toStrictEqual(['encrypted_client_secret']);
    const ledger = await sql<{ filename: string }[]>`SELECT filename FROM schema_migrations`;
    expect(ledger.map((row) => row.filename)).toStrictEqual([OIDC_CLIENT_SECRET_MIGRATION_ID]);
    const rows = await sql<{ encrypted_client_secret: string }[]>`
        SELECT encrypted_client_secret FROM oidc_tenant_configs
        WHERE tenant_id = ${tenantId} AND provider = 'google'
      `;
    const encrypted = rows[0]?.encrypted_client_secret;
    if (!encrypted) expect.unreachable('Expected encrypted');
    if (!(encrypted !== plaintext)) expect.unreachable('Expected encrypted !== plaintext');
    expect(reveal(
      await decryptCredential(oidcTestRuntime(), encrypted, {
        purpose: 'oidc-client-secret',
        tenantId,
        provider: 'google',
      }),
    )).toStrictEqual(plaintext);
  });
});

testCase('OIDC credential migration rolls back data and schema when ledger insertion fails', {
  skip: !DATABASE_URL,
}, async function () {
  const databaseUrl = DATABASE_URL;
  if (!databaseUrl) return;
  await withLegacyOidcSchema(databaseUrl, true, async (sql) => {
    const tenantId = crypto.randomUUID();
    const plaintext = 'must-remain-plaintext-after-rollback';
    await sql`
        INSERT INTO oidc_tenant_configs (tenant_id, provider, client_secret)
        VALUES (${tenantId}, 'google', ${plaintext})
      `;

    await expect(
      Promise.resolve().then(() => applyOidcClientSecretMigration(sql, oidcTestRuntime())),
    ).rejects.toBeInstanceOf(Error);

    expect(await oidcColumnNames(sql)).toStrictEqual(['client_secret']);
    const ledger = await sql<{ filename: string }[]>`SELECT filename FROM schema_migrations`;
    expect(ledger.map((row) => row.filename)).toStrictEqual([]);
    const remaining = await sql<{ client_secret: string }[]>`
        SELECT client_secret FROM oidc_tenant_configs WHERE tenant_id = ${tenantId}
      `;
    expect(remaining.map((row) => row.client_secret)).toStrictEqual([plaintext]);
  });
});

type SqlClient = ReturnType<typeof postgres>;

async function withLegacyOidcSchema(
  databaseUrl: string,
  rejectLedgerInsert: boolean,
  run: (sql: SqlClient) => Promise<void>,
): Promise<void> {
  const schema = `oidc_migration_${crypto.randomUUID().replaceAll('-', '')}`;
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    await sql.unsafe(`SET search_path TO "${schema}"`);
    await sql.unsafe(`
      CREATE TABLE schema_migrations (
        filename text PRIMARY KEY${rejectLedgerInsert ? ' CHECK (false)' : ''}
      )
    `);
    await sql.unsafe(`
      CREATE TABLE oidc_tenant_configs (
        tenant_id text NOT NULL,
        provider text NOT NULL,
        client_secret text,
        PRIMARY KEY (tenant_id, provider)
      )
    `);
    await run(sql);
  } finally {
    await sql.unsafe('SET search_path TO public').catch(() => undefined);
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await sql.end({ timeout: 5 });
  }
}

async function oidcColumnNames(sql: SqlClient): Promise<string[]> {
  const rows = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'oidc_tenant_configs'
      AND column_name IN ('client_secret', 'encrypted_client_secret')
    ORDER BY column_name
  `;
  return rows.map((row) => row.column_name);
}

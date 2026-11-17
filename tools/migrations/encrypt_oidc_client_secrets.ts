import postgres from 'postgres';

import { encryptCredential, validateCredentialCipherRuntime } from '../../lib/credential_cipher.ts';
import { parseOidcProviderId } from '../../lib/oidc_provider.ts';
import { redact } from '../../lib/redacted.ts';
import type { RuntimeSource } from '../../lib/runtime.ts';

type SqlClient = ReturnType<typeof postgres>;

/** Stable ledger identity retained from the SQL migration it replaces. */
export const OIDC_CLIENT_SECRET_MIGRATION_ID = '0043_encrypt_oidc_client_secrets.sql';

type LegacyOidcCredentialRow = {
  readonly tenant_id: string;
  readonly provider: string;
  readonly client_secret: string;
};

/** Atomically encrypts legacy OIDC credentials, renames the column, and records the migration. */
export async function applyOidcClientSecretMigration(
  sql: SqlClient,
  runtime?: RuntimeSource,
): Promise<void> {
  let changed = 0;
  let cleared = 0;
  await sql.begin(async (tx) => {
    const columns = await tx<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'oidc_tenant_configs'
        AND column_name IN ('client_secret', 'encrypted_client_secret')
    `;
    const names = new Set(columns.map((column) => column.column_name));
    if (!names.has('client_secret') || names.has('encrypted_client_secret')) {
      throw new Error('OIDC credential schema is not ready for migration 0043.');
    }

    const rows = await tx<LegacyOidcCredentialRow[]>`
      SELECT tenant_id, provider, client_secret
      FROM oidc_tenant_configs
      WHERE client_secret IS NOT NULL
      ORDER BY tenant_id, provider
      FOR UPDATE
    `;
    if (rows.some((row) => row.client_secret.trim())) {
      validateCredentialCipherRuntime(runtime);
    }
    for (const row of rows) {
      const provider = parseOidcProviderId(row.provider);
      if (!provider) {
        throw new Error(`OIDC credential uses unsupported provider ${row.provider}.`);
      }
      if (!row.client_secret.trim()) {
        await tx`
          UPDATE oidc_tenant_configs
          SET client_secret = NULL
          WHERE tenant_id = ${row.tenant_id}
            AND provider = ${row.provider}
        `;
        cleared += 1;
        continue;
      }
      const context = {
        purpose: 'oidc-client-secret' as const,
        tenantId: row.tenant_id,
        provider,
      };
      const encrypted = await encryptCredential(runtime, redact(row.client_secret), context);
      await tx`
        UPDATE oidc_tenant_configs
        SET client_secret = ${encrypted}
        WHERE tenant_id = ${row.tenant_id}
          AND provider = ${row.provider}
      `;
      changed += 1;
    }
    await tx.unsafe(
      'ALTER TABLE oidc_tenant_configs RENAME COLUMN client_secret TO encrypted_client_secret',
    );
    await tx`
      INSERT INTO schema_migrations (filename)
      VALUES (${OIDC_CLIENT_SECRET_MIGRATION_ID})
    `;
  });

  if (changed > 0) console.log(`Encrypted ${changed} legacy OIDC client secret(s).`);
  if (cleared > 0) console.log(`Cleared ${cleared} empty legacy OIDC client secret(s).`);
}

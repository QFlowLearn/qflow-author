import { and, eq, sql } from 'drizzle-orm';
import { decryptCredential, encryptCredential } from '../credential_cipher.ts';
import { db, getDb, type QflowDatabase } from '../db.ts';
import { oidcTenantConfigs, tenants } from '../db/schema.ts';
import {
  OIDC_PROVIDER_IDS,
  type OidcProviderId,
  oidcProviderLabel,
  type OidcProviderOption,
  parseOidcProviderId,
} from '../oidc_provider.ts';
import { type Redacted, reveal } from '../redacted.ts';
import type { RuntimeSource } from '../runtime.ts';
import { parseCanonicalUuid } from '../uuid.ts';
import { findRequiredSsoProviderReadinessIssue } from './required_sso_provider_readiness.ts';

const OIDC_CLIENT_ID_MAX_LENGTH = 2048;
const OIDC_CLIENT_SECRET_MAX_LENGTH = 8192;

const oidcTenantConfigSelection = {
  tenantId: oidcTenantConfigs.tenantId,
  provider: oidcTenantConfigs.provider,
  enabled: oidcTenantConfigs.enabled,
  clientId: oidcTenantConfigs.clientId,
  clientSecretConfigured: sql<boolean>`${oidcTenantConfigs.encryptedClientSecret} is not null`,
  microsoftTenant: oidcTenantConfigs.microsoftTenant,
  createdAt: oidcTenantConfigs.createdAt,
  updatedAt: oidcTenantConfigs.updatedAt,
};

/** Secret-free OIDC provider configuration returned to tenant administration surfaces. */
export type OidcTenantConfig = {
  readonly tenantId: string;
  readonly provider: OidcProviderId;
  readonly enabled: boolean;
  readonly clientId: string | null;
  readonly clientSecretConfigured: boolean;
  readonly microsoftTenant: string | null;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
};

/** Partial administrative update for one tenant OIDC provider. */
export type OidcTenantConfigInput = {
  readonly enabled?: boolean;
  readonly clientId?: string | null;
  readonly clientSecret?: Redacted<string> | null;
  readonly microsoftTenant?: string | null;
};

/** Decrypted credentials exposed only to the OIDC protocol service. */
export type ConfiguredOidcProviderCredentials = {
  readonly provider: OidcProviderId;
  readonly clientId: string;
  readonly clientSecret: Redacted<string>;
  readonly microsoftTenant: string | null;
};

/** A tenant OIDC setting failed domain validation. */
export class OidcTenantConfigError extends Error {
  readonly _tag = 'OidcTenantConfigError' as const;

  constructor(message: string) {
    super(message);
    this.name = 'OidcTenantConfigError';
  }
}

/** Loads one secret-free tenant OIDC configuration. */
export async function getOidcTenantConfig(
  tenantId: string,
  provider: OidcProviderId,
  database: QflowDatabase = db,
): Promise<OidcTenantConfig | null> {
  const rows = await database.select(oidcTenantConfigSelection).from(oidcTenantConfigs)
    .where(and(eq(oidcTenantConfigs.tenantId, tenantId), eq(oidcTenantConfigs.provider, provider)))
    .limit(1);

  return rows[0] ? projectOidcTenantConfig(rows[0], provider) : null;
}

/** Lists a complete, ordered secret-free read model for every supported provider. */
export async function listOidcTenantConfigs(
  tenantId: string,
  database: QflowDatabase = db,
): Promise<OidcTenantConfig[]> {
  const rows = await database.select(oidcTenantConfigSelection).from(oidcTenantConfigs)
    .where(eq(oidcTenantConfigs.tenantId, tenantId));

  const byProvider = new Map<OidcProviderId, OidcTenantConfig>();
  for (const row of rows) {
    const provider = parseOidcProviderId(row.provider);
    if (provider) byProvider.set(provider, projectOidcTenantConfig(row, provider));
  }

  return OIDC_PROVIDER_IDS.map((provider) =>
    byProvider.get(provider) ?? emptyOidcTenantConfig(tenantId, provider)
  );
}

/** Atomically updates one or more tenant OIDC providers without returning stored secrets. */
export async function updateOidcTenantConfigs(
  tenantId: string,
  inputs: Partial<Record<OidcProviderId, OidcTenantConfigInput>>,
  runtime?: RuntimeSource,
): Promise<OidcTenantConfig[]> {
  const prepared = await Promise.all(OIDC_PROVIDER_IDS.flatMap((provider) => {
    const input = inputs[provider];
    return input ? [prepareOidcTenantConfigInput(tenantId, provider, input, runtime)] : [];
  }));
  const database = getDb(runtime);
  await database.transaction(async (tx) => {
    await tx.select({ id: tenants.id }).from(tenants)
      .where(eq(tenants.id, tenantId))
      .for('update')
      .limit(1);
    for (const update of prepared) {
      const rows = await tx.select({
        enabled: oidcTenantConfigs.enabled,
        clientId: oidcTenantConfigs.clientId,
        encryptedClientSecret: oidcTenantConfigs.encryptedClientSecret,
        microsoftTenant: oidcTenantConfigs.microsoftTenant,
      }).from(oidcTenantConfigs).where(and(
        eq(oidcTenantConfigs.tenantId, tenantId),
        eq(oidcTenantConfigs.provider, update.provider),
      )).for('update').limit(1);
      const existing = rows[0];
      const next = {
        enabled: update.input.enabled ?? existing?.enabled ?? false,
        clientId: update.input.clientId !== undefined
          ? normalizeOptionalText(update.input.clientId)
          : existing?.clientId ?? null,
        encryptedClientSecret: update.encryptedClientSecret !== undefined
          ? update.encryptedClientSecret
          : existing?.encryptedClientSecret ?? null,
        microsoftTenant: update.provider === 'microsoft'
          ? (update.input.microsoftTenant !== undefined
            ? parseMicrosoftTenantId(update.input.microsoftTenant)
            : parseMicrosoftTenantId(existing?.microsoftTenant))
          : null,
      };
      assertValidOidcTenantConfig(update.provider, {
        ...next,
        clientSecretConfigured: next.encryptedClientSecret !== null,
      });

      const now = new Date();
      await tx.insert(oidcTenantConfigs).values({
        tenantId,
        provider: update.provider,
        ...next,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [oidcTenantConfigs.tenantId, oidcTenantConfigs.provider],
        set: {
          enabled: next.enabled,
          clientId: next.clientId,
          ...(update.encryptedClientSecret !== undefined
            ? { encryptedClientSecret: next.encryptedClientSecret }
            : {}),
          microsoftTenant: next.microsoftTenant,
          updatedAt: now,
        },
      });
    }

    const readinessIssue = await findRequiredSsoProviderReadinessIssue(tx, tenantId);
    if (readinessIssue) throw new OidcTenantConfigError(readinessIssue);
  });

  return await listOidcTenantConfigs(tenantId, database);
}

/** Lists only providers with enabled, complete credentials for login. */
export async function listConfiguredOidcProvidersForTenant(
  tenantId: string,
): Promise<OidcProviderOption[]> {
  const configs = await listOidcTenantConfigs(tenantId);
  return configs.filter(isOidcProviderConfigured).map((config) => ({
    id: config.provider,
    label: oidcProviderLabel(config.provider),
  }));
}

/** Loads and decrypts one complete provider credential set for the protocol service. */
export async function getConfiguredOidcProviderCredentials(
  tenantId: string,
  provider: unknown,
  runtime?: RuntimeSource,
): Promise<ConfiguredOidcProviderCredentials | null> {
  const parsedProvider = parseOidcProviderId(provider);
  if (!parsedProvider) return null;

  const rows = await getDb(runtime).select({
    enabled: oidcTenantConfigs.enabled,
    clientId: oidcTenantConfigs.clientId,
    encryptedClientSecret: oidcTenantConfigs.encryptedClientSecret,
    microsoftTenant: oidcTenantConfigs.microsoftTenant,
  }).from(oidcTenantConfigs).where(and(
    eq(oidcTenantConfigs.tenantId, tenantId),
    eq(oidcTenantConfigs.provider, parsedProvider),
  )).limit(1);
  const row = rows[0];
  const clientId = normalizeOptionalText(row?.clientId);
  if (!row?.enabled || !clientId || !row.encryptedClientSecret) return null;

  return {
    provider: parsedProvider,
    clientId,
    clientSecret: await decryptCredential(runtime, row.encryptedClientSecret, {
      purpose: 'oidc-client-secret',
      tenantId,
      provider: parsedProvider,
    }),
    microsoftTenant: row.microsoftTenant,
  };
}

function projectOidcTenantConfig(
  row: {
    readonly tenantId: string;
    readonly enabled: boolean;
    readonly clientId: string | null;
    readonly clientSecretConfigured: boolean;
    readonly microsoftTenant: string | null;
    readonly createdAt: Date | null;
    readonly updatedAt: Date | null;
  },
  provider: OidcProviderId,
): OidcTenantConfig {
  return {
    tenantId: row.tenantId,
    provider,
    enabled: row.enabled,
    clientId: row.clientId,
    clientSecretConfigured: row.clientSecretConfigured,
    microsoftTenant: row.microsoftTenant,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function emptyOidcTenantConfig(
  tenantId: string,
  provider: OidcProviderId,
): OidcTenantConfig {
  return {
    tenantId,
    provider,
    enabled: false,
    clientId: null,
    clientSecretConfigured: false,
    microsoftTenant: null,
    createdAt: null,
    updatedAt: null,
  };
}

async function prepareOidcTenantConfigInput(
  tenantId: string,
  provider: OidcProviderId,
  input: OidcTenantConfigInput,
  runtime: RuntimeSource,
): Promise<{
  readonly provider: OidcProviderId;
  readonly input: OidcTenantConfigInput;
  readonly encryptedClientSecret: string | null | undefined;
}> {
  if (input.clientSecret === undefined) {
    return { provider, input, encryptedClientSecret: undefined };
  }
  if (input.clientSecret === null) {
    return { provider, input, encryptedClientSecret: null };
  }
  const clientSecret = reveal(input.clientSecret);
  if (!clientSecret.trim()) throw new OidcTenantConfigError('Client secret cannot be empty.');
  if (clientSecret.length > OIDC_CLIENT_SECRET_MAX_LENGTH) {
    throw new OidcTenantConfigError('Client secret must be 8,192 characters or fewer.');
  }
  const encryptedClientSecret = await encryptCredential(runtime, input.clientSecret, {
    purpose: 'oidc-client-secret',
    tenantId,
    provider,
  });
  return { provider, input, encryptedClientSecret };
}

function assertValidOidcTenantConfig(
  provider: OidcProviderId,
  input: {
    readonly enabled: boolean;
    readonly clientId: string | null;
    readonly clientSecretConfigured: boolean;
    readonly microsoftTenant: string | null;
  },
): void {
  const clientId = normalizeOptionalText(input.clientId);

  if (clientId && clientId.length > OIDC_CLIENT_ID_MAX_LENGTH) {
    throw new OidcTenantConfigError('Client ID must be 2,048 characters or fewer.');
  }
  if (input.enabled && !clientId) {
    throw new OidcTenantConfigError('Client ID is required when OIDC provider is enabled.');
  }
  if (input.enabled && !input.clientSecretConfigured) {
    throw new OidcTenantConfigError('Client secret is required when OIDC provider is enabled.');
  }
  if (provider === 'microsoft' && input.enabled && input.microsoftTenant === null) {
    throw new OidcTenantConfigError(
      'Microsoft Directory tenant ID is required when Microsoft OIDC is enabled.',
    );
  }
}

function isOidcProviderConfigured(config: OidcTenantConfig): boolean {
  return Boolean(
    config.enabled && normalizeOptionalText(config.clientId) &&
      config.clientSecretConfigured &&
      (config.provider !== 'microsoft' || parseCanonicalUuid(config.microsoftTenant)),
  );
}

function parseMicrosoftTenantId(value: unknown): string | null {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  const tenantId = parseCanonicalUuid(text);
  if (!tenantId) {
    throw new OidcTenantConfigError('Microsoft tenant must be a Directory tenant UUID.');
  }
  return tenantId;
}

function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

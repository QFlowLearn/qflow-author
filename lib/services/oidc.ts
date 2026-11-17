import { eq } from 'drizzle-orm';
import { encodeBase64Url } from '../base64.ts';
import { getEnv } from '../config.ts';
import { db } from '../db.ts';
import { oidcLoginStates, tenants } from '../db/schema.ts';
import { parseAuthReturnPath } from '../http/auth_return_path.ts';
import {
  type OidcProviderId,
  type OidcProviderOption,
  parseOidcProviderId,
} from '../oidc_provider.ts';
import { buildOidcProviderConfig, type OidcProviderConfig } from '../oidc_protocol.ts';
import type { RuntimeSource } from '../runtime.ts';
import {
  getConfiguredOidcProviderCredentials,
  listConfiguredOidcProvidersForTenant,
} from './oidc_tenant_configs.ts';

const OIDC_LOGIN_TTL_MS = 10 * 60 * 1000;
const PUBLIC_OIDC_TENANT_SLUG_ENV = 'QFLOW_PUBLIC_OIDC_TENANT_SLUG';

type OidcLoginState = {
  readonly state: string;
  readonly tenantId: string;
  readonly provider: OidcProviderId;
  readonly nonce: string;
  readonly redirectPath: string | null;
  readonly expiresAt: Date;
};

export async function getPublicOidcTenantId(): Promise<string | null> {
  const slug = normalizeOptionalText(getEnv(PUBLIC_OIDC_TENANT_SLUG_ENV));
  if (!slug) return null;

  const rows = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function listConfiguredOidcProvidersForPublicLogin(): Promise<OidcProviderOption[]> {
  const tenantId = await getPublicOidcTenantId();
  if (!tenantId) return [];
  return await listConfiguredOidcProvidersForTenant(tenantId);
}

export async function getOidcProviderConfigForPublicLogin(
  provider: string,
  runtime?: RuntimeSource,
): Promise<{ tenantId: string; config: OidcProviderConfig } | null> {
  const tenantId = await getPublicOidcTenantId();
  if (!tenantId) return null;

  const config = await getOidcProviderConfigForTenant(tenantId, provider, runtime);
  if (!config) return null;

  return { tenantId, config };
}

export async function getOidcProviderConfigForTenant(
  tenantId: string,
  provider: string,
  runtime?: RuntimeSource,
): Promise<OidcProviderConfig | null> {
  const credentials = await getConfiguredOidcProviderCredentials(tenantId, provider, runtime);
  return credentials ? buildOidcProviderConfig(credentials) : null;
}

export async function createOidcLoginState(input: {
  tenantId: string;
  provider: OidcProviderId;
  redirectPath?: string | null;
}): Promise<OidcLoginState> {
  const state = generateOpaqueToken();
  const nonce = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + OIDC_LOGIN_TTL_MS);
  const redirectPath = parseAuthReturnPath(input.redirectPath);
  await db.insert(oidcLoginStates).values({
    state,
    tenantId: input.tenantId,
    provider: input.provider,
    nonce,
    redirectPath,
    expiresAt,
  });
  return {
    state,
    tenantId: input.tenantId,
    provider: input.provider,
    nonce,
    redirectPath,
    expiresAt,
  };
}

export async function consumeOidcLoginState(state: string): Promise<OidcLoginState | null> {
  if (!state) return null;
  const rows = await db.delete(oidcLoginStates)
    .where(eq(oidcLoginStates.state, state))
    .returning({
      state: oidcLoginStates.state,
      tenantId: oidcLoginStates.tenantId,
      provider: oidcLoginStates.provider,
      nonce: oidcLoginStates.nonce,
      redirectPath: oidcLoginStates.redirectPath,
      expiresAt: oidcLoginStates.expiresAt,
    });
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  const provider = parseOidcProviderId(row.provider);
  if (!provider) return null;

  return {
    state: row.state,
    tenantId: row.tenantId,
    provider,
    nonce: row.nonce,
    redirectPath: row.redirectPath ?? null,
    expiresAt: row.expiresAt,
  };
}

function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function generateOpaqueToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

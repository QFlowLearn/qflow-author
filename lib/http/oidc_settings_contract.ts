import type { OidcProviderId } from '../oidc_provider.ts';
import type { OidcTenantConfig } from '../services/oidc_tenant_configs.ts';

/** Secret-free JSON representation of one tenant OIDC provider. */
export type OidcProviderSettingsResponse = {
  readonly tenantId: string;
  readonly provider: OidcProviderId;
  readonly enabled: boolean;
  readonly clientId: string | null;
  readonly clientSecretConfigured: boolean;
  readonly microsoftTenant: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

/** Complete JSON read model returned by the OIDC administration API. */
export type OidcSettingsResponse = {
  readonly google: OidcProviderSettingsResponse;
  readonly microsoft: OidcProviderSettingsResponse;
};

const OIDC_PROVIDER_RESPONSE_FIELDS = new Set([
  'tenantId',
  'provider',
  'enabled',
  'clientId',
  'clientSecretConfigured',
  'microsoftTenant',
  'createdAt',
  'updatedAt',
]);

/** Projects Date-bearing service values into the explicit JSON administration contract. */
export function projectOidcSettingsResponse(
  configs: readonly OidcTenantConfig[],
): OidcSettingsResponse {
  const google = configs.find((config) => config.provider === 'google');
  const microsoft = configs.find((config) => config.provider === 'microsoft');
  if (!google || !microsoft) throw new Error('OIDC provider read model is incomplete.');
  return {
    google: projectProvider(google),
    microsoft: projectProvider(microsoft),
  };
}

/** Parses the write-only OIDC settings read model returned by the administration API. */
export function parseOidcSettingsResponse(payload: unknown): OidcSettingsResponse | null {
  if (
    !isRecord(payload) ||
    Object.keys(payload).some((key) => key !== 'google' && key !== 'microsoft')
  ) return null;
  const google = parseProvider(payload.google, 'google');
  const microsoft = parseProvider(payload.microsoft, 'microsoft');
  return google && microsoft ? { google, microsoft } : null;
}

function projectProvider(config: OidcTenantConfig): OidcProviderSettingsResponse {
  return {
    tenantId: config.tenantId,
    provider: config.provider,
    enabled: config.enabled,
    clientId: config.clientId,
    clientSecretConfigured: config.clientSecretConfigured,
    microsoftTenant: config.microsoftTenant,
    createdAt: config.createdAt?.toISOString() ?? null,
    updatedAt: config.updatedAt?.toISOString() ?? null,
  };
}

function parseProvider(
  value: unknown,
  expectedProvider: OidcProviderId,
): OidcProviderSettingsResponse | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !OIDC_PROVIDER_RESPONSE_FIELDS.has(key)) ||
    typeof value.tenantId !== 'string' ||
    value.provider !== expectedProvider ||
    typeof value.enabled !== 'boolean' ||
    !isNullableString(value.clientId) ||
    typeof value.clientSecretConfigured !== 'boolean' ||
    !isNullableString(value.microsoftTenant) ||
    !isNullableIsoTimestamp(value.createdAt) ||
    !isNullableIsoTimestamp(value.updatedAt)
  ) return null;
  return {
    tenantId: value.tenantId,
    provider: expectedProvider,
    enabled: value.enabled,
    clientId: value.clientId,
    clientSecretConfigured: value.clientSecretConfigured,
    microsoftTenant: value.microsoftTenant,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableIsoTimestamp(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

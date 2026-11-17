import { parseSsoDomain, type SsoDomain } from '../sso_domain.ts';
import {
  parseSsoLoginPolicy,
  parseSsoRouteProvider,
  type SsoDomainRoute,
  type SsoLoginPolicy,
  type SsoRouteProvider,
} from '../sso_policy.ts';
import type { DomainVerificationRecord } from '../services/domain_verification.ts';
import type { TenantSsoSettings, TenantSsoSettingsInput } from '../services/sso_policy.ts';

/** Secret-free HTTP representation of one SSO domain route. */
export type SsoDomainRouteResponse = {
  readonly domain: SsoDomain;
  readonly provider: SsoRouteProvider;
};

/** Complete HTTP read model returned by the tenant SSO policy API. */
export type SsoPolicySettingsResponse = {
  readonly loginPolicy: SsoLoginPolicy;
  readonly domainRoutes: readonly SsoDomainRouteResponse[];
};

/** Secret-bearing domain ownership challenge returned only to tenant administrators. */
export type DomainVerificationResponse = {
  readonly domain: SsoDomain;
  readonly verificationToken: string;
  readonly expectedDnsTxt: string;
  readonly httpsVerificationUrl: string;
  readonly dnsVerifiedAt: string | null;
  readonly httpsVerifiedAt: string | null;
  readonly verifiedAt: string | null;
};

/** HTTP list envelope returned by the domain-verification API. */
export type DomainVerificationListResponse = {
  readonly domains: readonly DomainVerificationResponse[];
};

/** HTTP mutation envelope returned by the domain-verification API. */
export type DomainVerificationActionResponse = {
  readonly record: DomainVerificationResponse;
};

/** Supported domain-verification administration commands. */
export type DomainVerificationAction = 'prepare' | 'verify_dns' | 'verify_https';

/** Parsed domain-verification administration command. */
export type DomainVerificationCommand = {
  readonly domain: SsoDomain;
  readonly action: DomainVerificationAction;
};

/** Project tenant SSO settings into their explicit HTTP response contract. */
export function projectSsoPolicySettingsResponse(
  settings: TenantSsoSettings,
): SsoPolicySettingsResponse {
  return {
    loginPolicy: settings.loginPolicy,
    domainRoutes: settings.domainRoutes.map((route) => ({
      domain: route.domain,
      provider: route.provider,
    })),
  };
}

/** Parse a tenant SSO settings response from decoded JSON. */
export function parseSsoPolicySettingsResponse(
  payload: unknown,
): SsoPolicySettingsResponse | null {
  if (!hasExactKeys(payload, ['loginPolicy', 'domainRoutes'])) return null;
  const loginPolicy = parseSsoLoginPolicy(payload.loginPolicy);
  if (!loginPolicy || !Array.isArray(payload.domainRoutes)) return null;
  const domainRoutes: SsoDomainRouteResponse[] = [];
  for (const value of payload.domainRoutes) {
    const route = parseDomainRoute(value);
    if (!route) return null;
    domainRoutes.push(route);
  }
  return { loginPolicy, domainRoutes };
}

/** Parse a strict tenant SSO settings update from decoded JSON. */
export function parseSsoPolicySettingsUpdate(
  payload: unknown,
): TenantSsoSettingsInput | null {
  if (!isRecord(payload)) return null;
  if (Object.keys(payload).some((key) => key !== 'loginPolicy' && key !== 'domainRoutes')) {
    return null;
  }

  let loginPolicy: SsoLoginPolicy | undefined;
  if (payload.loginPolicy !== undefined) {
    const parsed = parseSsoLoginPolicy(payload.loginPolicy);
    if (!parsed) return null;
    loginPolicy = parsed;
  }

  let domainRoutes: SsoDomainRoute[] | undefined;
  if (payload.domainRoutes !== undefined) {
    if (!Array.isArray(payload.domainRoutes)) return null;
    domainRoutes = [];
    for (const value of payload.domainRoutes) {
      const route = parseDomainRoute(value);
      if (!route) return null;
      domainRoutes.push(route);
    }
  }

  return { loginPolicy, domainRoutes };
}

/** Project one Date-bearing domain verification into its HTTP representation. */
export function projectDomainVerificationResponse(
  record: DomainVerificationRecord,
): DomainVerificationResponse {
  return {
    domain: record.domain,
    verificationToken: record.verificationToken,
    expectedDnsTxt: `qflow-domain-verification=${record.verificationToken}`,
    httpsVerificationUrl: `https://${record.domain}/.well-known/qflow-domain-verification.txt`,
    dnsVerifiedAt: record.dnsVerifiedAt?.toISOString() ?? null,
    httpsVerifiedAt: record.httpsVerifiedAt?.toISOString() ?? null,
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
  };
}

/** Parse the domain-verification list envelope from decoded JSON. */
export function parseDomainVerificationListResponse(
  payload: unknown,
): DomainVerificationListResponse | null {
  if (!hasExactKeys(payload, ['domains']) || !Array.isArray(payload.domains)) return null;
  const domains: DomainVerificationResponse[] = [];
  for (const value of payload.domains) {
    const record = parseDomainVerificationResponse(value);
    if (!record) return null;
    domains.push(record);
  }
  return { domains };
}

/** Parse one domain-verification mutation response from decoded JSON. */
export function parseDomainVerificationActionResponse(
  payload: unknown,
): DomainVerificationActionResponse | null {
  if (!hasExactKeys(payload, ['record'])) return null;
  const record = parseDomainVerificationResponse(payload.record);
  return record ? { record } : null;
}

/** Parse a strict domain-verification command from decoded JSON. */
export function parseDomainVerificationCommand(
  payload: unknown,
): DomainVerificationCommand | null {
  if (!hasExactKeys(payload, ['domain', 'action'])) return null;
  const domain = parseSsoDomain(payload.domain);
  const action = parseDomainVerificationAction(payload.action);
  return domain && action ? { domain, action } : null;
}

/** Closed error codes returned by SSO administration endpoints. */
export type SsoSettingsErrorCode =
  | 'forbidden'
  | 'invalid_payload'
  | 'invalid_oidc_configuration'
  | 'invalid_policy_configuration'
  | 'dns_verification_failed'
  | 'https_verification_failed'
  | 'oidc_update_failed'
  | 'policy_update_failed'
  | 'domain_verification_failed';

/** Parse additive SSO error data while tolerating the legacy prose envelope. */
export function parseSsoSettingsError(payload: unknown): {
  readonly code: SsoSettingsErrorCode;
  readonly params?: { readonly domain: SsoDomain };
} | null {
  if (!isRecord(payload)) return null;
  const error = parseSsoSettingsErrorCode(payload.code) ?? parseSsoSettingsErrorCode(payload.error);
  if (!error) return null;
  const requiresDomain = error === 'dns_verification_failed' ||
    error === 'https_verification_failed';
  if (payload.params === undefined) return requiresDomain ? null : { code: error };
  if (!requiresDomain) return null;
  if (!isRecord(payload.params)) {
    return null;
  }
  if (!Object.hasOwn(payload.params, 'domain') || typeof payload.params.domain !== 'string') {
    return null;
  }
  const domain = parseSsoDomain(payload.params.domain);
  if (!domain) return null;
  return { code: error, params: { domain } };
}

/** Extract the legacy SSO error text for compatibility callers. */
export function ssoSettingsErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload) || typeof payload.error !== 'string') return fallback;
  return payload.error.trim() || fallback;
}

function parseSsoSettingsErrorCode(value: unknown): SsoSettingsErrorCode | null {
  switch (value) {
    case 'forbidden':
    case 'invalid_payload':
    case 'invalid_oidc_configuration':
    case 'invalid_policy_configuration':
    case 'dns_verification_failed':
    case 'https_verification_failed':
    case 'oidc_update_failed':
    case 'policy_update_failed':
    case 'domain_verification_failed':
      return value;
    default:
      return null;
  }
}

/** Select the additive code for a domain verification operation. */
export function domainVerificationFailureCode(
  method: 'dns' | 'https',
): 'dns_verification_failed' | 'https_verification_failed' {
  return method === 'dns' ? 'dns_verification_failed' : 'https_verification_failed';
}

function parseDomainRoute(value: unknown): SsoDomainRoute | null {
  if (!hasExactKeys(value, ['domain', 'provider'])) return null;
  const domain = parseSsoDomain(value.domain);
  const provider = parseSsoRouteProvider(value.provider);
  return domain && provider ? { domain, provider } : null;
}

function parseDomainVerificationResponse(value: unknown): DomainVerificationResponse | null {
  if (
    !hasExactKeys(value, [
      'domain',
      'verificationToken',
      'expectedDnsTxt',
      'httpsVerificationUrl',
      'dnsVerifiedAt',
      'httpsVerifiedAt',
      'verifiedAt',
    ])
  ) return null;
  const domain = parseSsoDomain(value.domain);
  if (
    !domain ||
    typeof value.verificationToken !== 'string' ||
    typeof value.expectedDnsTxt !== 'string' ||
    typeof value.httpsVerificationUrl !== 'string' ||
    !isNullableIsoTimestamp(value.dnsVerifiedAt) ||
    !isNullableIsoTimestamp(value.httpsVerifiedAt) ||
    !isNullableIsoTimestamp(value.verifiedAt)
  ) return null;
  return {
    domain,
    verificationToken: value.verificationToken,
    expectedDnsTxt: value.expectedDnsTxt,
    httpsVerificationUrl: value.httpsVerificationUrl,
    dnsVerifiedAt: value.dnsVerifiedAt,
    httpsVerifiedAt: value.httpsVerifiedAt,
    verifiedAt: value.verifiedAt,
  };
}

function parseDomainVerificationAction(value: unknown): DomainVerificationAction | null {
  switch (value) {
    case 'prepare':
    case 'verify_dns':
    case 'verify_https':
      return value;
    default:
      return null;
  }
}

function isNullableIsoTimestamp(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => key in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

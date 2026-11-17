import type { SsoDomain } from './sso_domain.ts';

/** Supported tenant login policies. */
const SSO_LOGIN_POLICIES = ['allow_password', 'prefer_sso', 'require_sso'] as const;

/** Tenant policy governing password and routed SSO login. */
export type SsoLoginPolicy = (typeof SSO_LOGIN_POLICIES)[number];

/** OIDC providers supported by domain routing. */
const SSO_ROUTE_PROVIDERS = ['google', 'microsoft'] as const;

/** OIDC provider selected for one verified domain. */
export type SsoRouteProvider = (typeof SSO_ROUTE_PROVIDERS)[number];

/** Canonical mapping from one verified domain to its OIDC provider. */
export type SsoDomainRoute = {
  readonly domain: SsoDomain;
  readonly provider: SsoRouteProvider;
};

/** Parse one exact tenant login policy. */
export function parseSsoLoginPolicy(value: unknown): SsoLoginPolicy | null {
  switch (value) {
    case 'allow_password':
    case 'prefer_sso':
    case 'require_sso':
      return value;
    default:
      return null;
  }
}

/** Parse persisted policy state, applying the database default when absent. */
export function ssoLoginPolicyFromPersistence(value: unknown): SsoLoginPolicy {
  return parseSsoLoginPolicy(value) ?? 'allow_password';
}

/** Parse one exact domain-route provider. */
export function parseSsoRouteProvider(value: unknown): SsoRouteProvider | null {
  switch (value) {
    case 'google':
    case 'microsoft':
      return value;
    default:
      return null;
  }
}

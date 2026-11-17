/** OIDC providers supported by QFlow tenant configuration and login. */
export const OIDC_PROVIDER_IDS = ['google', 'microsoft'] as const;

/** Stable identifier for one supported OIDC provider. */
export type OidcProviderId = (typeof OIDC_PROVIDER_IDS)[number];

/** Provider option rendered by login surfaces. */
export type OidcProviderOption = {
  readonly id: OidcProviderId;
  readonly label: string;
};

/** Parses an untrusted provider identifier into the supported provider domain. */
export function parseOidcProviderId(value: unknown): OidcProviderId | null {
  return value === 'google' || value === 'microsoft' ? value : null;
}

/** Returns the stable human-facing label for one supported provider. */
export function oidcProviderLabel(provider: OidcProviderId): string {
  return provider === 'google' ? 'Google' : 'Microsoft';
}

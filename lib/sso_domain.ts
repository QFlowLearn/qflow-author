declare const ssoDomainBrand: unique symbol;

/** Canonical lower-case DNS domain used for SSO routing and ownership verification. */
export type SsoDomain = string & { readonly [ssoDomainBrand]: true };

/** Parse and normalize one SSO routing domain. */
export function parseSsoDomain(value: unknown): SsoDomain | null {
  if (typeof value !== 'string') return null;
  const domain = value.trim().toLowerCase().replace(/\.$/, '');
  if (!domain || !/^[a-z0-9.-]+$/.test(domain)) return null;
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return null;
  if (domain.includes('..')) return null;
  // SAFETY: The checks above establish the canonical SSO domain invariant.
  return domain as SsoDomain;
}

/** Extract and parse the routing domain from an email address. */
export function ssoDomainFromEmail(email: string): SsoDomain | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at < 1 || at >= normalized.length - 1) return null;
  return parseSsoDomain(normalized.slice(at + 1));
}

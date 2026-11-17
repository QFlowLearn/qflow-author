declare const emailAddressBrand: unique symbol;

/** Canonical email address accepted at an application boundary. */
export type EmailAddress = string & { readonly [emailAddressBrand]: true };

/** Return the canonical form used for email identity comparisons. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Return whether a canonical email address has the supported shape and length. */
export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/** Parse and canonicalize one boundary string into a valid email address. */
export function parseEmailAddress(input: string): EmailAddress | null {
  const normalized = normalizeEmail(input);
  if (!isValidEmail(normalized)) return null;
  // SAFETY: normalization and isValidEmail established the EmailAddress invariant.
  return normalized as EmailAddress;
}

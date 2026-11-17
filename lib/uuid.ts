const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns whether a boundary value is one canonical RFC 4122 UUID string. */
export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID_PATTERN.test(value);
}

/** Parses and lowercases one canonical UUID version 1 through 5 string. */
export function parseCanonicalUuid(value: unknown): string | null {
  return isCanonicalUuid(value) ? value.toLowerCase() : null;
}

import { isCanonicalUuid } from './uuid.ts';

/** Parse one persisted UUID or reject with a caller-owned message. */
export function parseUuid(value: unknown, message: string): string {
  if (!isCanonicalUuid(value)) throw new Error(message);
  return value;
}

/** Parse one persisted timestamp or reject with a caller-owned message. */
export function parseTimestamp(value: unknown, message: string): string {
  const parsed = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.getTime())) throw new Error(message);
  return parsed.toISOString();
}

/** Parse one optional persisted timestamp. */
export function parseOptionalTimestamp(value: unknown, message: string): string | null {
  return value === null || value === undefined ? null : parseTimestamp(value, message);
}

/** Parse one non-empty trimmed string. */
export function parseNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value.trim();
}

/** Parse one optional non-empty trimmed string. */
export function parseOptionalNonEmptyString(value: unknown, message: string): string | null {
  if (value === null || value === undefined) return null;
  return parseNonEmptyString(value, message);
}

/** Parse one non-negative integer. */
export function parseNonNegativeInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(message);
  return value;
}

/** Parse one positive integer. */
export function parsePositiveInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(message);
  return value;
}

/** Parse one persisted SHA-256 hex digest. */
export function parseSha256(value: unknown, message: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error(message);
  return value;
}

/** Parse one optional persisted SHA-256 hex digest. */
export function parseOptionalSha256(value: unknown, message: string): string | null {
  return value === null ? null : parseSha256(value, message);
}

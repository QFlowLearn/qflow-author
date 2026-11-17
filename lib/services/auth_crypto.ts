import { decodeBase64Url, encodeBase64Url } from '../base64.ts';

/** Minimum accepted password length, in Unicode code points. */
export const PASSWORD_MIN_LENGTH = 12;
/** Maximum accepted password length, in Unicode code points. */
export const PASSWORD_MAX_LENGTH = 1024;

const PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORD_HASH_LENGTH_BYTES = 32;
const PASSWORD_HASH_PREFIX = 'pbkdf2';

export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) {
    issues.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (length > PASSWORD_MAX_LENGTH) {
    issues.push(`Password must be no more than ${PASSWORD_MAX_LENGTH} characters.`);
  }
  return issues;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePbkdf2(
    password,
    salt,
    PASSWORD_HASH_ITERATIONS,
    PASSWORD_HASH_LENGTH_BYTES,
  );
  return [
    PASSWORD_HASH_PREFIX,
    String(PASSWORD_HASH_ITERATIONS),
    encodeBase64Url(salt),
    encodeBase64Url(hash),
  ].join('$');
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const parts = passwordHash.split('$');
  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_PREFIX) return false;
  const [_, iterationsRaw, saltB64, hashB64] = parts;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = decodeBase64Url(saltB64);
    expected = decodeBase64Url(hashB64);
  } catch (_cause: unknown) {
    return false;
  }
  const iterations = Number(iterationsRaw);
  if (!Number.isSafeInteger(iterations) || iterations < 1) return false;
  const actual = await derivePbkdf2(password, salt, iterations, expected.length);
  return timingSafeEqual(actual, expected);
}

export function passwordHashNeedsUpgrade(passwordHash: string): boolean {
  const parts = passwordHash.split('$');
  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_PREFIX) return false;
  const iterations = Number(parts[1]);
  return Number.isSafeInteger(iterations) && iterations < PASSWORD_HASH_ITERATIONS;
}

export function generateAuthToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashAuthToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function derivePbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations,
    },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

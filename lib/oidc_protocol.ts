import { decodeBase64Url } from './base64.ts';
import { type OidcProviderId } from './oidc_provider.ts';
import { type Redacted, reveal } from './redacted.ts';
import { type EmailAddress, parseEmailAddress } from './services/email_address.ts';
import { parseCanonicalUuid } from './uuid.ts';

const JWT_ALG = 'RS256';
const OIDC_REQUEST_TIMEOUT_MS = 10_000;
const OIDC_CLOCK_SKEW_SECONDS = 60;
const MAX_JWKS_KEYS = 100;
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Complete protocol configuration for one enabled OIDC provider. */
export type OidcProviderConfig = {
  readonly id: OidcProviderId;
  readonly label: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUrl: string;
  readonly clientId: string;
  readonly clientSecret: Redacted<string>;
  readonly scope: string;
  readonly issuers: readonly string[];
};

/** Caller-owned cancellation accepted by OIDC network operations. */
export type OidcRequestOptions = {
  readonly signal?: AbortSignal;
};

/** Provider email evidence preserved after token verification. */
export type OidcEmailClaim =
  | { readonly _tag: 'Verified'; readonly address: EmailAddress }
  | { readonly _tag: 'ProviderAsserted'; readonly address: EmailAddress };

/** Identity claims accepted only after the provider token has been verified. */
export type VerifiedOidcIdentity = {
  readonly subject: string;
  readonly email: OidcEmailClaim | null;
  readonly displayName: string | null;
  readonly issuer: string;
};

type OidcJwtHeader = {
  readonly alg: typeof JWT_ALG;
  readonly kid: string;
};

type OidcIdTokenClaims = {
  readonly iss: string;
  readonly sub: string;
  readonly nonce: string;
  readonly aud: string | readonly string[];
  readonly azp?: string;
  readonly exp: number;
  readonly iat?: number;
  readonly nbf?: number;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly name?: string;
  readonly givenName?: string;
  readonly familyName?: string;
};

type VerificationJwk = JsonWebKey & {
  readonly kid: string;
  readonly kty: 'RSA';
  readonly n: string;
  readonly e: string;
};

/** Build one exact provider protocol configuration from decrypted tenant credentials. */
export function buildOidcProviderConfig(config: {
  readonly provider: OidcProviderId;
  readonly clientId: string;
  readonly clientSecret: Redacted<string>;
  readonly microsoftTenant: string | null;
}): OidcProviderConfig {
  const clientId = normalizeOptionalText(config.clientId);
  if (!clientId || !reveal(config.clientSecret).trim()) {
    throw new Error('OIDC provider missing credentials.');
  }

  if (config.provider === 'google') {
    return {
      id: 'google',
      label: 'Google',
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
      clientId,
      clientSecret: config.clientSecret,
      scope: 'openid email profile',
      issuers: Array.from(GOOGLE_ISSUERS),
    };
  }

  const tenant = parseCanonicalUuid(config.microsoftTenant);
  if (!tenant) throw new Error('Microsoft OIDC tenant ID is invalid.');
  const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
  return {
    id: 'microsoft',
    label: 'Microsoft',
    authorizationEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    jwksUrl: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
    clientId,
    clientSecret: config.clientSecret,
    scope: 'openid email profile',
    issuers: [issuer],
  };
}

export function buildOidcAuthorizationUrl(input: {
  config: OidcProviderConfig;
  state: string;
  nonce: string;
  redirectUri: string;
}): string {
  const url = new URL(input.config.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.config.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.config.scope);
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  return url.toString();
}

export async function exchangeOidcCode(input: {
  config: OidcProviderConfig;
  code: string;
  redirectUri: string;
}, options: OidcRequestOptions = {}): Promise<{ idToken: string; accessToken?: string }> {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', input.code);
  body.set('redirect_uri', input.redirectUri);
  body.set('client_id', input.config.clientId);
  body.set('client_secret', reveal(input.config.clientSecret));
  body.set('scope', input.config.scope);

  const res = await fetch(input.config.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: oidcRequestSignal(options.signal),
  });
  if (!res.ok) throw new Error('Token exchange failed.');

  const tokens = parseTokenResponse(await res.json());
  return {
    idToken: tokens.idToken,
    ...(tokens.accessToken === undefined ? {} : { accessToken: tokens.accessToken }),
  };
}

export async function verifyOidcIdToken(input: {
  config: OidcProviderConfig;
  token: string;
  nonce: string;
}, options: OidcRequestOptions = {}): Promise<VerifiedOidcIdentity> {
  const parts = input.token.split('.');
  if (parts.length !== 3) throw new Error('Invalid id_token.');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJwtHeader(encodedHeader);
  const payload = parseIdTokenClaims(encodedPayload);

  const jwks = await fetchJwks(input.config.jwksUrl, options);
  const key = jwks.keys.find((key) => key.kid === header.kid);
  if (!key) throw new Error('Unable to verify id_token.');

  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = decodeBase64Url(encodedSignature);
  } catch (_cause: unknown) {
    throw new Error('Invalid id_token signature.');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    key,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    toArrayBuffer(signatureBytes),
    data,
  );
  if (!ok) throw new Error('Invalid id_token signature.');

  if (!input.config.issuers.includes(payload.iss)) throw new Error('Invalid issuer.');
  if (!audMatches(payload.aud, payload.azp, input.config.clientId)) {
    throw new Error('Invalid audience.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now - OIDC_CLOCK_SKEW_SECONDS) throw new Error('Token expired.');
  if (payload.iat !== undefined && payload.iat > now + OIDC_CLOCK_SKEW_SECONDS) {
    throw new Error('Invalid issued-at time.');
  }
  if (payload.nbf !== undefined && payload.nbf > now + OIDC_CLOCK_SKEW_SECONDS) {
    throw new Error('Token is not active.');
  }
  if (payload.nonce !== input.nonce) throw new Error('Invalid nonce.');

  const email = extractEmail(payload, input.config.id);
  return {
    subject: payload.sub,
    email,
    displayName: pickDisplayName(payload),
    issuer: payload.iss,
  };
}

function audMatches(
  aud: string | readonly string[],
  azp: string | undefined,
  clientId: string,
): boolean {
  const audienceMatches = typeof aud === 'string' ? aud === clientId : aud.includes(clientId);
  if (!audienceMatches) return false;
  if (Array.isArray(aud) && aud.length > 1) return azp === clientId;
  return azp === undefined || azp === clientId;
}

function extractEmail(
  payload: OidcIdTokenClaims,
  provider: OidcProviderId,
): OidcEmailClaim | null {
  const rawEmail = payload.email?.trim() ?? '';
  if (!rawEmail) return null;
  if (provider === 'google' && payload.emailVerified !== true) return null;
  const address = parseEmailAddress(rawEmail);
  if (!address) throw new Error('Invalid email claim.');
  return payload.emailVerified === true
    ? { _tag: 'Verified', address }
    : { _tag: 'ProviderAsserted', address };
}

function pickDisplayName(payload: OidcIdTokenClaims): string | null {
  if (payload.name?.trim()) return payload.name.trim();
  const given = payload.givenName?.trim() ?? '';
  const family = payload.familyName?.trim() ?? '';
  return [given, family].filter(Boolean).join(' ') || null;
}

async function fetchJwks(
  url: string,
  options: OidcRequestOptions,
): Promise<{ readonly keys: readonly VerificationJwk[] }> {
  const res = await fetch(url, { signal: oidcRequestSignal(options.signal) });
  if (!res.ok) throw new Error('Unable to fetch JWKS.');
  return parseJwks(await res.json());
}

function parseTokenResponse(value: unknown): {
  readonly idToken: string;
  readonly accessToken?: string;
} {
  const record = parseJsonRecord(value, 'Token response is invalid.');
  const idToken = parseRequiredString(record.id_token, 'Missing id_token.');
  if (record.access_token !== undefined && typeof record.access_token !== 'string') {
    throw new Error('Token response is invalid.');
  }
  const accessToken = record.access_token?.trim();
  if (record.access_token !== undefined && !accessToken) {
    throw new Error('Token response is invalid.');
  }
  return { idToken, ...(accessToken === undefined ? {} : { accessToken }) };
}

function parseJwtHeader(segment: string): OidcJwtHeader {
  const record = parseJwtObject(segment);
  if (record.alg !== JWT_ALG) throw new Error('Unsupported id_token algorithm.');
  return {
    alg: JWT_ALG,
    kid: parseRequiredString(record.kid, 'Invalid id_token key identifier.'),
  };
}

function parseIdTokenClaims(segment: string): OidcIdTokenClaims {
  const record = parseJwtObject(segment);
  const aud = parseAudience(record.aud);
  const iat = parseOptionalNumericDate(record.iat, 'Issued-at claim must be numeric.');
  const nbf = parseOptionalNumericDate(record.nbf, 'Not-before claim must be numeric.');
  const azp = parseOptionalStringClaim(record.azp, 'azp');
  const email = parseOptionalStringClaim(record.email, 'email');
  const emailVerified = parseOptionalBooleanClaim(record.email_verified, 'email_verified');
  const name = parseOptionalStringClaim(record.name, 'name');
  const givenName = parseOptionalStringClaim(record.given_name, 'given_name');
  const familyName = parseOptionalStringClaim(record.family_name, 'family_name');
  return {
    iss: parseRequiredString(record.iss, 'Missing issuer claim.'),
    sub: parseRequiredString(record.sub, 'Missing subject claim.'),
    nonce: parseRequiredString(record.nonce, 'Missing nonce claim.'),
    aud,
    exp: parseNumericDate(record.exp, 'Expiration claim must be numeric.'),
    ...(iat === undefined ? {} : { iat }),
    ...(nbf === undefined ? {} : { nbf }),
    ...(azp === undefined ? {} : { azp }),
    ...(email === undefined ? {} : { email }),
    ...(emailVerified === undefined ? {} : { emailVerified }),
    ...(name === undefined ? {} : { name }),
    ...(givenName === undefined ? {} : { givenName }),
    ...(familyName === undefined ? {} : { familyName }),
  };
}

function parseJwtObject(segment: string): Record<string, unknown> {
  try {
    const bytes = decodeBase64Url(segment);
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parseJsonRecord(value, 'Invalid token encoding.');
  } catch (_cause: unknown) {
    throw new Error('Invalid token encoding.');
  }
}

function parseAudience(value: unknown): string | readonly string[] {
  if (typeof value === 'string' && value.trim()) return value;
  if (
    Array.isArray(value) && value.length > 0 &&
    value.every((entry) => typeof entry === 'string' && entry.trim())
  ) {
    return value;
  }
  throw new Error('Invalid audience.');
}

function parseOptionalStringClaim(value: unknown, claim: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid ${claim} claim.`);
  return value;
}

function parseOptionalBooleanClaim(value: unknown, claim: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${claim} claim.`);
  return value;
}

function parseOptionalNumericDate(value: unknown, message: string): number | undefined {
  return value === undefined ? undefined : parseNumericDate(value, message);
}

function parseNumericDate(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(message);
  }
  return value;
}

function parseJwks(value: unknown): { readonly keys: readonly VerificationJwk[] } {
  const record = parseJsonRecord(value, 'JWKS response is invalid.');
  if (!Array.isArray(record.keys) || record.keys.length > MAX_JWKS_KEYS) {
    throw new Error('JWKS response is invalid.');
  }
  const keys: VerificationJwk[] = [];
  for (const value of record.keys) {
    const key = parseVerificationJwk(value);
    if (key) keys.push(key);
  }
  return { keys };
}

function parseVerificationJwk(value: unknown): VerificationJwk | null {
  const record = parseJsonRecord(value, 'JWKS key is invalid.');
  if (record.kty !== 'RSA') return null;
  if (record.alg !== undefined && record.alg !== JWT_ALG) return null;
  if (record.use !== undefined && record.use !== 'sig') return null;
  const kid = parseRequiredString(record.kid, 'JWKS key identifier is invalid.');
  const n = parseRequiredString(record.n, 'JWKS modulus is invalid.');
  const e = parseRequiredString(record.e, 'JWKS exponent is invalid.');
  return {
    kty: 'RSA',
    kid,
    n,
    e,
    ...(record.alg === undefined ? {} : { alg: JWT_ALG }),
    ...(record.use === undefined ? {} : { use: 'sig' }),
  };
}

function parseJsonRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  // SAFETY: the object shape is established above; every consumed field is parsed before use.
  return value as Record<string, unknown>;
}

function parseRequiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value;
}

function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function oidcRequestSignal(signal: AbortSignal | undefined): AbortSignal {
  const deadline = AbortSignal.timeout(OIDC_REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

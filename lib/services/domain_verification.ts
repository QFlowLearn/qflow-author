import { resolveDomainAddresses, resolveDomainTxt } from '../adapters/domain_dns.ts';
import { and, eq } from 'drizzle-orm';
import { encodeBase64Url } from '../base64.ts';
import { awaitWithAbortSignal, type CancellableOptions } from '../cancellation.ts';
import { db } from '../db.ts';
import { ssoDomainVerifications } from '../db/schema.ts';
import { parseSsoDomain, type SsoDomain } from '../sso_domain.ts';

const DOMAIN_VERIFICATION_METHODS = ['dns', 'https'] as const;
export type DomainVerificationMethod = (typeof DOMAIN_VERIFICATION_METHODS)[number];

export type DomainVerificationRecord = {
  readonly tenantId: string;
  readonly domain: SsoDomain;
  readonly verificationToken: string;
  readonly dnsVerifiedAt: Date | null;
  readonly httpsVerifiedAt: Date | null;
  readonly verifiedAt: Date | null;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
};

/** A user-correctable domain-ownership verification failure. */
export class DomainOwnershipVerificationError extends Error {
  readonly _tag = 'DomainOwnershipVerificationError' as const;
}

type DnsResolver = (domain: string, recordType: 'TXT') => Promise<Array<string | string[]>>;
type AddressResolver = (domain: string, recordType: 'A' | 'AAAA') => Promise<string[]>;
type HttpFetcher = typeof fetch;

const DOMAIN_VERIFICATION_TIMEOUT_MS = 5_000;
const HTTPS_VERIFICATION_MAX_BODY_BYTES = 1_024;

/** External capabilities used to verify an SSO domain challenge. */
export type DomainOwnershipVerifierDependencies = {
  readonly dnsResolver: DnsResolver;
  readonly addressResolver: AddressResolver;
  readonly httpFetcher: HttpFetcher;
};

export async function listDomainVerificationsForTenant(
  tenantId: string,
): Promise<DomainVerificationRecord[]> {
  const rows = await db.select({
    tenantId: ssoDomainVerifications.tenantId,
    domain: ssoDomainVerifications.domain,
    verificationToken: ssoDomainVerifications.verificationToken,
    dnsVerifiedAt: ssoDomainVerifications.dnsVerifiedAt,
    httpsVerifiedAt: ssoDomainVerifications.httpsVerifiedAt,
    verifiedAt: ssoDomainVerifications.verifiedAt,
    createdAt: ssoDomainVerifications.createdAt,
    updatedAt: ssoDomainVerifications.updatedAt,
  }).from(ssoDomainVerifications)
    .where(eq(ssoDomainVerifications.tenantId, tenantId));

  return rows.map(parseDomainVerificationRow);
}

async function getDomainVerificationRecord(
  tenantId: string,
  domain: SsoDomain,
): Promise<DomainVerificationRecord | null> {
  const rows = await db.select({
    tenantId: ssoDomainVerifications.tenantId,
    domain: ssoDomainVerifications.domain,
    verificationToken: ssoDomainVerifications.verificationToken,
    dnsVerifiedAt: ssoDomainVerifications.dnsVerifiedAt,
    httpsVerifiedAt: ssoDomainVerifications.httpsVerifiedAt,
    verifiedAt: ssoDomainVerifications.verifiedAt,
    createdAt: ssoDomainVerifications.createdAt,
    updatedAt: ssoDomainVerifications.updatedAt,
  }).from(ssoDomainVerifications)
    .where(and(
      eq(ssoDomainVerifications.tenantId, tenantId),
      eq(ssoDomainVerifications.domain, domain),
    ))
    .limit(1);

  const row = rows[0];
  return row ? parseDomainVerificationRow(row) : null;
}

export async function ensureDomainVerificationChallenge(
  tenantId: string,
  domain: SsoDomain,
): Promise<DomainVerificationRecord> {
  const existing = await getDomainVerificationRecord(tenantId, domain);
  const token = existing?.verificationToken ?? generateVerificationToken();
  const now = new Date();

  await db.insert(ssoDomainVerifications).values({
    tenantId,
    domain,
    verificationToken: token,
    dnsVerifiedAt: existing?.dnsVerifiedAt ?? null,
    httpsVerifiedAt: existing?.httpsVerifiedAt ?? null,
    verifiedAt: existing?.verifiedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [ssoDomainVerifications.tenantId, ssoDomainVerifications.domain],
    set: {
      verificationToken: token,
      updatedAt: now,
    },
  });

  const record = await getDomainVerificationRecord(tenantId, domain);
  if (!record) throw new Error('Unable to load domain verification challenge.');
  return record;
}

/** Create a domain-ownership verifier with explicit DNS and HTTP boundaries. */
export function createDomainOwnershipVerifier(
  dependencies: DomainOwnershipVerifierDependencies,
) {
  return async function verifyDomainOwnership(
    tenantId: string,
    domain: SsoDomain,
    method: DomainVerificationMethod,
    options: CancellableOptions = {},
  ): Promise<DomainVerificationRecord> {
    if (!DOMAIN_VERIFICATION_METHODS.includes(method)) {
      throw new Error('Invalid verification method.');
    }

    const record = await ensureDomainVerificationChallenge(tenantId, domain);
    const token = record.verificationToken;

    const deadline = AbortSignal.timeout(DOMAIN_VERIFICATION_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    let ok = false;
    try {
      ok = method === 'dns'
        ? await verifyByDns(domain, token, dependencies.dnsResolver, { signal })
        : await verifyByHttps(
          domain,
          token,
          dependencies.addressResolver,
          dependencies.httpFetcher,
          { signal },
        );
    } catch (cause: unknown) {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? cause;
      }
    }

    if (!ok) {
      throw new DomainOwnershipVerificationError(
        method === 'dns'
          ? 'DNS TXT verification failed. Add the expected TXT value and retry.'
          : 'HTTPS verification failed. Serve the expected token at /.well-known/qflow-domain-verification.txt and retry.',
      );
    }

    const now = new Date();
    await db.update(ssoDomainVerifications).set({
      dnsVerifiedAt: method === 'dns' ? now : record.dnsVerifiedAt,
      httpsVerifiedAt: method === 'https' ? now : record.httpsVerifiedAt,
      verifiedAt: now,
      updatedAt: now,
    }).where(and(
      eq(ssoDomainVerifications.tenantId, tenantId),
      eq(ssoDomainVerifications.domain, domain),
    ));

    const updated = await getDomainVerificationRecord(tenantId, domain);
    if (!updated) throw new Error('Unable to load verified domain.');
    return updated;
  };
}

/** Verify domain ownership using the production DNS and HTTP implementations. */
export const verifyDomainOwnership = createDomainOwnershipVerifier({
  dnsResolver: resolveDomainTxt,
  addressResolver: resolveDomainAddresses,
  httpFetcher: fetch,
});

export async function isTenantDomainVerified(
  tenantId: string,
  domain: SsoDomain,
): Promise<boolean> {
  const record = await getDomainVerificationRecord(tenantId, domain);
  return Boolean(record?.verifiedAt);
}

function parseDomainVerificationRow(
  row: {
    tenantId: string;
    domain: string;
    verificationToken: string;
    dnsVerifiedAt: Date | null;
    httpsVerifiedAt: Date | null;
    verifiedAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
  },
): DomainVerificationRecord {
  const domain = parseSsoDomain(row.domain);
  if (!domain) throw new Error('Persisted domain verification is invalid.');
  return {
    tenantId: row.tenantId,
    domain,
    verificationToken: row.verificationToken,
    dnsVerifiedAt: row.dnsVerifiedAt,
    httpsVerifiedAt: row.httpsVerifiedAt,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function generateVerificationToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

function expectedTokenValues(token: string): string[] {
  return [token, `qflow-domain-verification=${token}`];
}

async function verifyByDns(
  domain: string,
  token: string,
  dnsResolver: DnsResolver,
  options: CancellableOptions,
): Promise<boolean> {
  let records: Array<string | string[]>;
  try {
    records = await awaitWithAbortSignal(dnsResolver(domain, 'TXT'), options);
  } catch (cause: unknown) {
    if (options.signal?.aborted) throw cause;
    return false;
  }

  const expected = new Set(expectedTokenValues(token));
  for (const record of records) {
    const text = Array.isArray(record) ? record.join('') : String(record);
    const normalized = text.trim();
    if (expected.has(normalized)) return true;
  }
  return false;
}

async function verifyByHttps(
  domain: string,
  token: string,
  addressResolver: AddressResolver,
  httpFetcher: HttpFetcher,
  options: CancellableOptions,
): Promise<boolean> {
  const url = new URL('/.well-known/qflow-domain-verification.txt', `https://${domain}`);
  if (url.hostname !== domain) return false;

  try {
    const addresses = await awaitWithAbortSignal(
      resolveHostAddresses(domain, addressResolver),
      options,
    );
    if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
      return false;
    }

    const res = await httpFetcher(url, {
      method: 'GET',
      redirect: 'manual',
      signal: options.signal,
    });
    if (!res.ok) return false;
    const body = await readBoundedText(res, HTTPS_VERIFICATION_MAX_BODY_BYTES);
    if (body === null) return false;
    return expectedTokenValues(token).includes(body);
  } catch (cause: unknown) {
    if (options.signal?.aborted) throw cause;
    return false;
  }
}

async function resolveHostAddresses(
  domain: string,
  addressResolver: AddressResolver,
): Promise<string[]> {
  const results = await Promise.allSettled([
    addressResolver(domain, 'A'),
    addressResolver(domain, 'AAAA'),
  ]);
  return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
}

function isPublicIpAddress(address: string): boolean {
  const ipv4 = parseIpv4Address(address);
  if (ipv4) return isPublicIpv4Address(ipv4);

  const normalized = address.toLowerCase();
  if (!normalized.includes(':')) return false;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) {
    const parsed = parseIpv4Address(mappedIpv4);
    return parsed !== null && isPublicIpv4Address(parsed);
  }

  const firstGroup = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
  if (!Number.isFinite(firstGroup) || firstGroup < 0x2000 || firstGroup > 0x3fff) return false;
  if (normalized.startsWith('2001:db8:')) return false;
  return true;
}

function parseIpv4Address(address: string): [number, number, number, number] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => /^\d{1,3}$/.test(part) ? Number(part) : -1);
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  return [octets[0], octets[1], octets[2], octets[3]];
}

function isPublicIpv4Address([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string | null> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body).trim();
}

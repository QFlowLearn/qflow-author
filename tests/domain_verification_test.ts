import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { tenants } from '../lib/db/schema.ts';
import { parseSsoDomain, type SsoDomain } from '../lib/sso_domain.ts';
import {
  createDomainOwnershipVerifier,
  ensureDomainVerificationChallenge,
} from '../lib/services/domain_verification.ts';

testCase('domain verification succeeds via DNS TXT challenge', async () => {
  const tenantId = crypto.randomUUID();
  const domain = requireSsoDomain('acme.edu');
  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `t-${tenantId.slice(0, 8)}`,
      name: 'Tenant',
    });
    const challenge = await ensureDomainVerificationChallenge(tenantId, domain);
    const expected = `qflow-domain-verification=${challenge.verificationToken}`;

    const verifyDomainOwnership = createDomainOwnershipVerifier({
      dnsResolver: () => Promise.resolve([expected]),
      addressResolver: unexpectedAddressResolver,
      httpFetcher: unexpectedHttpFetcher,
    });
    const verified = await verifyDomainOwnership(tenantId, domain, 'dns');
    if (!(verified.verifiedAt)) expect.unreachable('Expected verified.verifiedAt');
    if (!(verified.dnsVerifiedAt)) expect.unreachable('Expected verified.dnsVerifiedAt');
  } finally {
    try {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    } catch (_) {
      // ignore cleanup
    }
    await shutdownDb().catch(() => {});
  }
});

testCase('domain verification succeeds via HTTPS well-known challenge', async () => {
  const tenantId = crypto.randomUUID();
  const domain = requireSsoDomain('school.org');
  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `t-${tenantId.slice(0, 8)}`,
      name: 'Tenant 2',
    });
    const challenge = await ensureDomainVerificationChallenge(tenantId, domain);
    const expected = `qflow-domain-verification=${challenge.verificationToken}`;

    const verifyDomainOwnership = createDomainOwnershipVerifier({
      dnsResolver: unexpectedDnsResolver,
      addressResolver: publicAddressResolver,
      httpFetcher: (url, init) => {
        expect(String(url)).toStrictEqual(
          'https://school.org/.well-known/qflow-domain-verification.txt',
        );
        expect(init?.redirect).toStrictEqual('manual');
        if (!(init?.signal)) expect.unreachable('Expected init?.signal');
        return Promise.resolve(new Response(expected, { status: 200 }));
      },
    });
    const verified = await verifyDomainOwnership(tenantId, domain, 'https');
    if (!(verified.verifiedAt)) expect.unreachable('Expected verified.verifiedAt');
    if (!(verified.httpsVerifiedAt)) expect.unreachable('Expected verified.httpsVerifiedAt');
  } finally {
    try {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    } catch (_) {
      // ignore cleanup
    }
    await shutdownDb().catch(() => {});
  }
});

testCase('domain verification rejects when challenge is not present on DNS', async () => {
  const tenantId = crypto.randomUUID();
  const domain = requireSsoDomain('invalid.org');
  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `t-${tenantId.slice(0, 8)}`,
      name: 'Tenant 3',
    });
    await ensureDomainVerificationChallenge(tenantId, domain);
    const verifyDomainOwnership = createDomainOwnershipVerifier({
      dnsResolver: () => Promise.resolve(['not-the-token']),
      addressResolver: unexpectedAddressResolver,
      httpFetcher: unexpectedHttpFetcher,
    });

    let message = '';
    try {
      await verifyDomainOwnership(tenantId, domain, 'dns');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err ?? '');
    }
    expect(message).toStrictEqual(
      'DNS TXT verification failed. Add the expected TXT value and retry.',
    );
  } finally {
    try {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    } catch (_) {
      // ignore cleanup
    }
    await shutdownDb().catch(() => {});
  }
});

testCase('HTTPS domain verification rejects private destinations before fetching', async () => {
  const tenantId = crypto.randomUUID();
  const domain = requireSsoDomain('internal.example');
  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `t-${tenantId.slice(0, 8)}`,
      name: 'Tenant 4',
    });
    await ensureDomainVerificationChallenge(tenantId, domain);
    const verifyDomainOwnership = createDomainOwnershipVerifier({
      dnsResolver: unexpectedDnsResolver,
      addressResolver: () => Promise.resolve(['127.0.0.1']),
      httpFetcher: unexpectedHttpFetcher,
    });

    await assertHttpsVerificationFails(verifyDomainOwnership, tenantId, domain);
  } finally {
    try {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    } catch (_) {
      // ignore cleanup
    }
    await shutdownDb().catch(() => {});
  }
});

testCase('HTTPS domain verification rejects oversized responses', async () => {
  const tenantId = crypto.randomUUID();
  const domain = requireSsoDomain('large.example');
  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `t-${tenantId.slice(0, 8)}`,
      name: 'Tenant 5',
    });
    await ensureDomainVerificationChallenge(tenantId, domain);
    const verifyDomainOwnership = createDomainOwnershipVerifier({
      dnsResolver: unexpectedDnsResolver,
      addressResolver: publicAddressResolver,
      httpFetcher: () => Promise.resolve(new Response('x'.repeat(1_025), { status: 200 })),
    });

    await assertHttpsVerificationFails(verifyDomainOwnership, tenantId, domain);
  } finally {
    try {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    } catch (_) {
      // ignore cleanup
    }
    await shutdownDb().catch(() => {});
  }
});

function unexpectedDnsResolver(): Promise<Array<string | string[]>> {
  return Promise.reject(new Error('DNS resolution was not expected.'));
}

function publicAddressResolver(_: string, recordType: 'A' | 'AAAA'): Promise<string[]> {
  return Promise.resolve(recordType === 'A' ? ['93.184.216.34'] : []);
}

function unexpectedAddressResolver(): Promise<string[]> {
  return Promise.reject(new Error('Address resolution was not expected.'));
}

const unexpectedHttpFetcher: typeof fetch = () =>
  Promise.reject(new Error('HTTP fetching was not expected.'));

function requireSsoDomain(value: string): SsoDomain {
  const domain = parseSsoDomain(value);
  if (!domain) expect.unreachable('Expected domain');
  return domain;
}

async function assertHttpsVerificationFails(
  verify: ReturnType<typeof createDomainOwnershipVerifier>,
  tenantId: string,
  domain: SsoDomain,
): Promise<void> {
  let message = '';
  try {
    await verify(tenantId, domain, 'https');
  } catch (cause: unknown) {
    message = cause instanceof Error ? cause.message : '';
  }
  expect(message).toStrictEqual(
    'HTTPS verification failed. Serve the expected token at /.well-known/qflow-domain-verification.txt and retry.',
  );
}

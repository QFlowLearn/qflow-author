import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authIdentities, organizationMemberships, tenants, users } from '../lib/db/schema.ts';
import { provisionLocalUser } from '../lib/services/account_provisioning.ts';
import { parseEmailAddress } from '../lib/services/email_address.ts';
import { linkExternalIdentity } from '../lib/services/identity_linking.ts';

testCase(
  'external identities resolve exact subjects and never link new subjects by email',
  async () => {
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    const email = `teacher-${tenantA.slice(0, 8)}@example.com`;
    const providerIdA = `sub-${tenantA.slice(0, 8)}-123`;
    const providerIdB = `sub-${tenantA.slice(0, 8)}-999`;
    const verifiedEmail = parseEmailAddress(email);
    if (!verifiedEmail) throw new Error('expected fixture email to be valid');
    let userId: string | null = null;

    try {
      await db.insert(tenants).values({
        id: tenantA,
        slug: `t-${tenantA.slice(0, 8)}`,
        name: 'Tenant A',
      });
      await db.insert(tenants).values({
        id: tenantB,
        slug: `t-${tenantB.slice(0, 8)}`,
        name: 'Tenant B',
      });

      const created = await provisionLocalUser({
        interfaceLocale: 'en-US' as const,
        email,
        password: 'A strong identity linking password 2026',
        displayName: 'Teacher Example',
      });
      if (!created.ok) throw new Error('expected user creation to succeed');
      userId = created.userId;

      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId: tenantA,
        userId,
        role: 'owner',
      });

      const collision = await linkExternalIdentity({
        interfaceLocale: 'en-US' as const,
        tenantId: tenantA,
        provider: 'google',
        providerId: providerIdA,
        email: { _tag: 'Verified', address: verifiedEmail },
        displayName: 'Teacher Example',
      });
      if (collision._tag !== 'Rejected' || collision.reason !== 'identity_conflict') {
        throw new Error('expected email collision to require explicit identity linking');
      }

      await db.insert(authIdentities).values({
        id: crypto.randomUUID(),
        userId,
        provider: 'google',
        providerId: providerIdA,
        email,
      });

      const exact = await linkExternalIdentity({
        interfaceLocale: 'en-US' as const,
        tenantId: tenantA,
        provider: 'google',
        providerId: providerIdA,
        email: { _tag: 'Verified', address: verifiedEmail },
        displayName: 'Teacher Example',
      });
      if (exact._tag !== 'Resolved' || exact.userId !== userId) {
        throw new Error('expected exact provider subject to resolve');
      }

      const conflict = await linkExternalIdentity({
        interfaceLocale: 'en-US' as const,
        tenantId: tenantA,
        provider: 'google',
        providerId: providerIdB,
        email: { _tag: 'Verified', address: verifiedEmail },
        displayName: 'Teacher Example',
      });
      if (conflict._tag !== 'Rejected' || conflict.reason !== 'identity_conflict') {
        throw new Error('expected a different provider subject to remain unlinked');
      }

      const mismatch = await linkExternalIdentity({
        interfaceLocale: 'en-US' as const,
        tenantId: tenantB,
        provider: 'google',
        providerId: providerIdA,
        email: { _tag: 'Verified', address: verifiedEmail },
        displayName: 'Teacher Example',
      });
      if (mismatch._tag !== 'Rejected' || mismatch.reason !== 'tenant_mismatch') {
        throw new Error('expected tenant mismatch');
      }
    } finally {
      try {
        if (userId) {
          await db.delete(users).where(eq(users.id, userId));
        }
        await db.delete(tenants).where(eq(tenants.id, tenantA));
        await db.delete(tenants).where(eq(tenants.id, tenantB));
      } catch (_) {
        // ignore cleanup errors
      }
      await shutdownDb().catch(() => {});
    }
  },
);

testCase('concurrent first logins cannot attach one external identity to two tenants', async () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const subject = `concurrent-subject-${crypto.randomUUID()}`;
  const email = parseEmailAddress(`concurrent-${crypto.randomUUID()}@example.com`);
  if (!email) throw new Error('expected fixture email to be valid');
  let userId: string | null = null;

  try {
    await db.insert(tenants).values([
      { id: tenantA, slug: `concurrent-a-${tenantA.slice(0, 8)}`, name: 'Tenant A' },
      { id: tenantB, slug: `concurrent-b-${tenantB.slice(0, 8)}`, name: 'Tenant B' },
    ]);

    const results = await Promise.all([
      linkExternalIdentity({
        interfaceLocale: 'en-US' as const,
        tenantId: tenantA,
        provider: 'google',
        providerId: subject,
        email: { _tag: 'Verified', address: email },
        displayName: 'Concurrent Teacher',
      }),
      linkExternalIdentity({
        interfaceLocale: 'en-US' as const,
        tenantId: tenantB,
        provider: 'google',
        providerId: subject,
        email: { _tag: 'Verified', address: email },
        displayName: 'Concurrent Teacher',
      }),
    ]);

    const resolved = results.filter((result) => result._tag === 'Resolved');
    const rejected = results.filter((result) => result._tag === 'Rejected');
    expect(resolved.length).toStrictEqual(1);
    expect(rejected).toStrictEqual([{ _tag: 'Rejected', reason: 'tenant_mismatch' }]);
    userId = resolved[0].userId;

    const memberships = await db.select({ tenantId: organizationMemberships.tenantId })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, userId));
    expect(memberships.length).toStrictEqual(1);
    expect(new Set<string>([tenantA, tenantB]).has(memberships[0].tenantId)).toStrictEqual(true);
  } finally {
    try {
      if (userId) await db.delete(users).where(eq(users.id, userId));
      await db.delete(tenants).where(eq(tenants.id, tenantA));
      await db.delete(tenants).where(eq(tenants.id, tenantB));
    } catch (_) {
      // ignore cleanup errors
    }
    await shutdownDb().catch(() => {});
  }
});

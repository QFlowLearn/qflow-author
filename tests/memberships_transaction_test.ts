import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';

import { db } from '../lib/db.ts';
import { organizationMemberships, tenants, users } from '../lib/db/schema.ts';
import { removeMember, updateMemberRole } from '../lib/services/memberships.ts';

testCase('concurrent owner demotions preserve one tenant owner', async () => {
  const fixture = await createTwoOwnerTenant();
  try {
    const results = await Promise.all(
      fixture.userIds.map((userId) =>
        updateMemberRole({
          actor: { tenantId: fixture.tenantId, userId, role: 'owner' },
          tenantId: fixture.tenantId,
          userId,
          role: 'instructor',
        })
      ),
    );

    expect(results.filter((result) => result.ok).length).toStrictEqual(1);
    expect(results.filter((result) => !result.ok && result.code === 'last_owner').length)
      .toStrictEqual(1);
    expect(await ownerCount(fixture.tenantId)).toStrictEqual(1);
  } finally {
    await deleteTenantFixture(fixture);
  }
});

testCase('concurrent owner removals preserve one tenant owner', async () => {
  const fixture = await createTwoOwnerTenant();
  try {
    const results = await Promise.all(
      fixture.userIds.map((userId) =>
        removeMember({
          actor: { tenantId: fixture.tenantId, userId, role: 'owner' },
          tenantId: fixture.tenantId,
          userId,
        })
      ),
    );

    expect(results.filter((result) => result.ok).length).toStrictEqual(1);
    expect(results.filter((result) => !result.ok && result.code === 'last_owner').length)
      .toStrictEqual(1);
    expect(await ownerCount(fixture.tenantId)).toStrictEqual(1);
  } finally {
    await deleteTenantFixture(fixture);
  }
});

type TwoOwnerTenant = {
  readonly tenantId: string;
  readonly userIds: readonly [string, string];
};

async function createTwoOwnerTenant(): Promise<TwoOwnerTenant> {
  const tenantId = crypto.randomUUID();
  const userIds = [crypto.randomUUID(), crypto.randomUUID()] as const;
  await db.insert(tenants).values({
    id: tenantId,
    slug: `membership-${tenantId.slice(0, 8)}`,
    name: 'Membership concurrency test',
  });
  await db.insert(users).values(userIds.map((userId, index) => ({
    id: userId,
    email: `owner-${index}-${tenantId}@example.com`,
    emailNormalized: `owner-${index}-${tenantId}@example.com`,
  })));
  await db.insert(organizationMemberships).values(userIds.map((userId) => ({
    id: crypto.randomUUID(),
    tenantId,
    userId,
    role: 'owner',
  })));
  return { tenantId, userIds };
}

async function ownerCount(tenantId: string): Promise<number> {
  const rows = await db.select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.tenantId, tenantId));
  return rows.filter((row) => row.role === 'owner').length;
}

async function deleteTenantFixture(fixture: TwoOwnerTenant): Promise<void> {
  await db.delete(tenants).where(eq(tenants.id, fixture.tenantId));
  for (const userId of fixture.userIds) {
    await db.delete(users).where(eq(users.id, userId));
  }
}

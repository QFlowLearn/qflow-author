import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';

import { db, shutdownDb } from '../lib/db.ts';
import {
  canvasConnections,
  canvasOauthStates,
  canvasUserGrants,
  organizationMemberships,
  tenants,
  users,
  workflowDispatches,
} from '../lib/db/schema.ts';

testCase('Workflow and Canvas ownership constraints preserve tenant and user lifecycles', {
  skip: !process.env['DATABASE_URL'],
}, async () => {
  const tenantId = crypto.randomUUID();
  const otherTenantId = crypto.randomUUID();
  const creatorId = crypto.randomUUID();
  const granteeId = crypto.randomUUID();
  const otherTenantUserId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const dispatchId = crypto.randomUUID();
  const stateHash = crypto.randomUUID();
  const now = new Date();

  try {
    await db.insert(tenants).values([
      {
        id: tenantId,
        slug: `ownership-${tenantId.slice(0, 8)}`,
        name: 'Ownership constraint test',
      },
      {
        id: otherTenantId,
        slug: `ownership-${otherTenantId.slice(0, 8)}`,
        name: 'Other ownership constraint test',
      },
    ]);
    await db.insert(users).values([
      testUser(creatorId, 'creator'),
      testUser(granteeId, 'grantee'),
      testUser(otherTenantUserId, 'other-tenant'),
    ]);
    await db.insert(organizationMemberships).values([
      { id: crypto.randomUUID(), tenantId, userId: creatorId, role: 'owner' },
      { id: crypto.randomUUID(), tenantId, userId: granteeId, role: 'instructor' },
      {
        id: crypto.randomUUID(),
        tenantId: otherTenantId,
        userId: otherTenantUserId,
        role: 'owner',
      },
    ]);
    await db.insert(canvasConnections).values({
      id: connectionId,
      tenantId,
      name: 'Constraint Canvas',
      baseUrl: 'https://canvas-constraints.example.edu',
      clientId: 'constraint-client',
      encryptedClientSecret: 'encrypted-client-secret',
      credentialVersion: 1,
      lifecycleState: 'active',
      createdBy: creatorId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(canvasUserGrants).values({
      connectionId,
      tenantId,
      userId: granteeId,
      encryptedRefreshToken: 'encrypted-refresh-token',
      canvasUserId: '42',
      authorizedAt: now,
      updatedAt: now,
    });
    await db.insert(canvasOauthStates).values({
      stateHash,
      connectionId,
      tenantId,
      userId: granteeId,
      credentialVersion: 1,
      returnPath: '/settings/canvas',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await expect(
      Promise.resolve().then(() =>
        db.insert(canvasOauthStates).values({
          stateHash: crypto.randomUUID().replaceAll('-', '').repeat(2),
          connectionId,
          tenantId,
          userId: otherTenantUserId,
          credentialVersion: 1,
          returnPath: '/settings/canvas',
          createdAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
        })
      ),
    ).rejects.toBeInstanceOf(Error);
    await db.insert(workflowDispatches).values({
      id: dispatchId,
      kind: 'source_migration',
      jobId: crypto.randomUUID(),
      tenantId,
      state: 'pending',
      workflowStatus: null,
      attempts: 0,
      lastErrorCode: null,
      startedAt: null,
      completedAt: null,
      lastCheckedAt: null,
    });

    await expect(Promise.resolve().then(() => db.delete(users).where(eq(users.id, creatorId))))
      .rejects.toBeInstanceOf(Error);

    await db.delete(users).where(eq(users.id, granteeId));
    expect(await db.select().from(canvasUserGrants).where(eq(canvasUserGrants.userId, granteeId)))
      .toStrictEqual([]);
    expect(await db.select().from(canvasOauthStates).where(eq(canvasOauthStates.userId, granteeId)))
      .toStrictEqual([]);

    await db.delete(tenants).where(eq(tenants.id, tenantId));
    expect(await db.select().from(canvasConnections).where(eq(canvasConnections.id, connectionId)))
      .toStrictEqual([]);
    expect(await db.select().from(workflowDispatches).where(eq(workflowDispatches.id, dispatchId)))
      .toStrictEqual([]);
  } finally {
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined);
    await db.delete(tenants).where(eq(tenants.id, otherTenantId)).catch(() => undefined);
    await db.delete(users).where(eq(users.id, granteeId)).catch(() => undefined);
    await db.delete(users).where(eq(users.id, creatorId)).catch(() => undefined);
    await db.delete(users).where(eq(users.id, otherTenantUserId)).catch(() => undefined);
    await shutdownDb().catch(() => undefined);
  }
});

function testUser(id: string, label: string) {
  const email = `ownership-${label}-${id.slice(0, 8)}@example.test`;
  return { id, email, emailNormalized: email };
}

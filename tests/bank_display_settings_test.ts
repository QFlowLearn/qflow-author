import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { auditLogs, organizationMemberships, tenants, users } from '../lib/db/schema.ts';
import { parseBankDisplayName, updateBankDisplayName } from '../lib/services/tenants.ts';
import { getTenantSettings } from '../lib/services/tenants.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase('bank display names have an explicit absent state and bounded input', () => {
  expect(parseBankDisplayName('  ')).toStrictEqual({ ok: true, name: null });
  expect(parseBankDisplayName(' Biology ')).toStrictEqual({ ok: true, name: 'Biology' });
  expect(parseBankDisplayName('x'.repeat(161))).toStrictEqual({ ok: false });
  expect(parseBankDisplayName(new Blob(['Biology']))).toStrictEqual({ ok: false });
});

testCase('only the current workspace owner may update the optional bank label', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const ctx: RequestContext = { tenantId, userId, role: 'owner' };
  try {
    await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace' });
    await db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      emailNormalized: `${userId}@example.com`,
    });
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });
    expect((await getTenantSettings(ctx))?.bankDisplayName).toStrictEqual(null);
    expect(await updateBankDisplayName(ctx, ' Biology ')).toStrictEqual({ ok: true });
    expect(await updateBankDisplayName(ctx, 'Biology')).toStrictEqual({ ok: true });
    expect((await getTenantSettings(ctx))?.bankDisplayName).toStrictEqual('Biology');
    expect((await getTenantSettings(ctx))?.name).toStrictEqual('Workspace');
    expect((await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId))).length)
      .toStrictEqual(1);
    await db.update(organizationMemberships).set({ role: 'admin' }).where(
      eq(organizationMemberships.userId, userId),
    );
    expect(await updateBankDisplayName(ctx, 'Forged')).toStrictEqual({
      ok: false,
      code: 'forbidden',
    });
    await db.update(organizationMemberships).set({ role: 'owner' }).where(
      eq(organizationMemberships.userId, userId),
    );
    expect(await updateBankDisplayName(ctx, '')).toStrictEqual({ ok: true });
    expect((await getTenantSettings(ctx))?.bankDisplayName).toStrictEqual(null);
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId));
    expect(await updateBankDisplayName(ctx, 'Revoked')).toStrictEqual({
      ok: false,
      code: 'forbidden',
    });
  } finally {
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(users).where(eq(users.id, userId));
    await shutdownDb();
  }
});

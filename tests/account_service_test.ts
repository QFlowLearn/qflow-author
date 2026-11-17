import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  authIdentities,
  organizationMemberships,
  tenants,
  userPasswords,
  users,
} from '../lib/db/schema.ts';
import {
  getAccountProfile,
  getAuthenticatedAccount,
  getDeliveryLaunchUser,
  updateAccountProfile,
} from '../lib/services/account.ts';
import { provisionLocalUser } from '../lib/services/account_provisioning.ts';
import { getTenantSettings, updateTenantName } from '../lib/services/tenants.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import type { RequestContext } from '../lib/tenants.ts';

const TEST_INTERFACE_LOCALE: InterfaceLocale = 'en-US';

testCase('account service returns authenticated account projection', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const email = `account-${userId.slice(0, 8)}@example.test`;
  const auth: RequestContext = { tenantId, userId, role: 'owner' };

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `t-${tenantId.slice(0, 8)}`,
      name: 'Account Tenant',
    });
    await db.insert(users).values({
      id: userId,
      email,
      emailNormalized: email,
      displayName: 'Account Owner',
    });
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });

    const account = await getAuthenticatedAccount(auth);
    if (!account) expect.unreachable('Expected account');
    expect(account.user.id).toStrictEqual(userId);
    expect(account.tenant.id).toStrictEqual(tenantId);
    expect(account.role).toStrictEqual('owner');

    const profile = await getAccountProfile(auth);
    if (!profile) expect.unreachable('Expected profile');
    expect(profile.email).toStrictEqual(email);
    expect(profile.displayName).toStrictEqual('Account Owner');

    await updateAccountProfile(auth, { displayName: 'Updated Owner' });
    const updated = await getAccountProfile(auth);
    expect(updated?.displayName).toStrictEqual('Updated Owner');

    const launchUser = await getDeliveryLaunchUser(userId);
    if (!launchUser) expect.unreachable('Expected launchUser');
    expect(launchUser.email).toStrictEqual(email);
    expect(launchUser.displayName).toStrictEqual('Updated Owner');
  } finally {
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId))
      .catch(() => {});
    await db.delete(users).where(eq(users.id, userId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => {});
    await shutdownDb().catch(() => {});
  }
});

testCase('tenant settings service reads and updates tenant name', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const email = `tenant-${userId.slice(0, 8)}@example.test`;
  const auth: RequestContext = { tenantId, userId, role: 'admin' };

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `t-${tenantId.slice(0, 8)}`,
      name: 'Original Name',
    });
    await db.insert(users).values({
      id: userId,
      email,
      emailNormalized: email,
    });

    const settings = await getTenantSettings(auth);
    if (!settings) expect.unreachable('Expected settings');
    expect(settings.name).toStrictEqual('Original Name');

    await updateTenantName(auth, 'Renamed Workspace');
    const updated = await getTenantSettings(auth);
    expect(updated?.name).toStrictEqual('Renamed Workspace');
  } finally {
    await db.delete(users).where(eq(users.id, userId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => {});
    await shutdownDb().catch(() => {});
  }
});

testCase('password signup rejects duplicate normalized email', async () => {
  const email = `dup-${crypto.randomUUID()}@example.test`;
  let userId: string | null = null;

  try {
    const first = await provisionLocalUser({
      email,
      password: 'A strong duplicate account password 2026',
      displayName: 'First User',
      interfaceLocale: TEST_INTERFACE_LOCALE,
    });
    expect(first.ok).toStrictEqual(true);
    if (!first.ok) throw new Error('expected first signup to succeed');
    userId = first.userId;

    const second = await provisionLocalUser({
      email: email.toUpperCase(),
      password: 'A strong duplicate account password 2026',
      displayName: 'Second User',
      interfaceLocale: TEST_INTERFACE_LOCALE,
    });
    expect(second).toStrictEqual({ ok: false, code: 'email_exists' });
  } finally {
    if (userId) {
      await db.delete(userPasswords).where(eq(userPasswords.userId, userId)).catch(() => {});
      await db.delete(authIdentities).where(eq(authIdentities.userId, userId)).catch(() => {});
      await db.delete(users).where(eq(users.id, userId)).catch(() => {});
    }
    await shutdownDb().catch(() => {});
  }
});

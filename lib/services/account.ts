import { eq } from 'drizzle-orm';
import { db } from '../db.ts';
import { tenants, users } from '../db/schema.ts';
import type { Role } from '../roles.ts';
import type { RequestContext } from '../tenants.ts';

export type AccountProfile = {
  email: string;
  displayName: string | null;
};

export type AuthenticatedAccount = {
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  role: Role;
};

export type DeliveryLaunchUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export async function getAuthenticatedAccount(
  auth: RequestContext,
): Promise<AuthenticatedAccount | null> {
  const [userRows, tenantRows] = await Promise.all([
    db.select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    }).from(users).where(eq(users.id, auth.userId)).limit(1),
    db.select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
    }).from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1),
  ]);

  if (!userRows.length || !tenantRows.length) return null;

  return {
    user: userRows[0],
    tenant: tenantRows[0],
    role: auth.role,
  };
}

export async function getAccountProfile(auth: RequestContext): Promise<AccountProfile | null> {
  const rows = await db.select({
    email: users.email,
    displayName: users.displayName,
  }).from(users).where(eq(users.id, auth.userId)).limit(1);
  return rows[0] ?? null;
}

export async function updateAccountProfile(
  auth: RequestContext,
  input: { displayName: string | null },
): Promise<void> {
  await db.update(users).set({
    displayName: input.displayName,
    updatedAt: new Date(),
  }).where(eq(users.id, auth.userId));
}

export async function getDeliveryLaunchUser(userId: string): Promise<DeliveryLaunchUser | null> {
  const rows = await db.select({
    id: users.id,
    email: users.email,
    displayName: users.displayName,
  }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

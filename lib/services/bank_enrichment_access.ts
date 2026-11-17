import { and, eq } from 'drizzle-orm';
import type { DbReadConnection, QflowDatabaseTransaction } from '../db.ts';
import { organizationMemberships, tenants } from '../db/principal_schema.ts';
import { hasCapability, parseRole } from '../roles.ts';
import type { RequestContext } from '../tenants.ts';

/** Recheck mutation authority after serializing with tenant membership changes. */
export async function authorizeEnrichment(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  capability: 'manage_content',
): Promise<boolean> {
  const tenant = await tx.select({ id: tenants.id }).from(tenants)
    .where(eq(tenants.id, ctx.tenantId)).for('update');
  if (!tenant.length) return false;
  return await canReadEnrichment(tx, ctx, capability);
}

/** Check the required persisted capability in a read snapshot without locking the workspace. */
export async function canReadEnrichment(
  database: DbReadConnection,
  ctx: RequestContext,
  capability: 'view_content' | 'manage_content',
): Promise<boolean> {
  const rows = await database.select({ role: organizationMemberships.role }).from(
    organizationMemberships,
  )
    .where(
      and(
        eq(organizationMemberships.tenantId, ctx.tenantId),
        eq(organizationMemberships.userId, ctx.userId),
      ),
    );
  const role = parseRole(rows[0]?.role);
  return role !== null && hasCapability(role, capability);
}

import { and, eq } from 'drizzle-orm';
import { db, type DbReadConnection, type QflowDatabaseTransaction } from '../db.ts';
import { workspacePublicationGrants } from '../db/publication_schema.ts';
import { organizationMemberships, tenants } from '../db/principal_schema.ts';
import { type Capability, hasCapability, parseRole } from '../roles.ts';
import { type RequestContext, SYSTEM_USER_ID } from '../tenants.ts';

/** Current persisted capability; synthetic system/runner actors never authorize editorial mutations. */
export async function hasWorkspaceCapability(
  ctx: RequestContext,
  capability: Capability,
  database: DbReadConnection = db,
): Promise<boolean> {
  if (ctx.userId === SYSTEM_USER_ID || !hasCapability(ctx.role, capability)) return false;
  const [member] = await database.select({ role: organizationMemberships.role }).from(
    organizationMemberships,
  )
    .where(
      and(
        eq(organizationMemberships.tenantId, ctx.tenantId),
        eq(organizationMemberships.userId, ctx.userId),
      ),
    );
  const role = parseRole(member?.role);
  return role !== null && hasCapability(role, capability);
}

/** Shared serialization boundary for membership, grant, review and publication mutations. */
export async function lockWorkspace(
  tx: QflowDatabaseTransaction,
  tenantId: string,
): Promise<boolean> {
  const [tenant] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId))
    .for('update');
  return tenant !== undefined;
}

/** Explicit authority only: workspace role/creator status never supplies a missing grant. */
export async function canPublishEditions(
  conn: DbReadConnection,
  ctx: RequestContext,
): Promise<boolean> {
  if (ctx.userId === SYSTEM_USER_ID) return false;
  const [grant] = await conn.select({ id: workspacePublicationGrants.userId }).from(
    workspacePublicationGrants,
  )
    .innerJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.tenantId, workspacePublicationGrants.tenantId),
        eq(organizationMemberships.userId, workspacePublicationGrants.userId),
      ),
    ).where(
      and(
        eq(workspacePublicationGrants.tenantId, ctx.tenantId),
        eq(workspacePublicationGrants.userId, ctx.userId),
      ),
    );
  return grant !== undefined;
}

/** Lock first, then re-read the requested authority within the mutation transaction. */
export async function lockWorkspaceAndRequireAuthority(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  authority: { readonly capability: 'manage_content' | 'manage_members' } | {
    readonly grant: 'publication';
  },
): Promise<boolean> {
  if (!await lockWorkspace(tx, ctx.tenantId)) return false;
  return 'capability' in authority
    ? await hasWorkspaceCapability(ctx, authority.capability, tx)
    : await canPublishEditions(tx, ctx);
}

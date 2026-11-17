import { and, eq } from 'drizzle-orm';
import { db } from '../db.ts';
import { organizationMemberships } from '../db/principal_schema.ts';
import { workspacePublicationGrants } from '../db/publication_schema.ts';
import { type RequestContext, SYSTEM_USER_ID } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { lockWorkspaceAndRequireAuthority } from './workspace_authorization.ts';
import { recordAuditEventInTransaction } from './audit_logs.ts';

export type PublicationGrantResult = { readonly ok: true } | {
  readonly ok: false;
  readonly code: 'forbidden' | 'invalid_member' | 'not_member';
};

/** Grant/revoke publication authority and record the change under the membership lock. */
export async function setPublicationGrant(
  ctx: RequestContext,
  userId: string,
  action: 'grant' | 'revoke',
): Promise<PublicationGrantResult> {
  if (!isCanonicalUuid(userId) || userId === SYSTEM_USER_ID) {
    return { ok: false, code: 'invalid_member' };
  }
  return await db.transaction(async (tx) => {
    if (
      !await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_members' })
    ) return { ok: false, code: 'forbidden' };
    const [member] = await tx.select({ id: organizationMemberships.id }).from(
      organizationMemberships,
    )
      .where(
        and(
          eq(organizationMemberships.tenantId, ctx.tenantId),
          eq(organizationMemberships.userId, userId),
        ),
      );
    if (!member) return { ok: false, code: 'not_member' };
    const changed = action === 'grant'
      ? await tx.insert(workspacePublicationGrants).values({
        tenantId: ctx.tenantId,
        userId,
        grantedBy: ctx.userId,
      }).onConflictDoNothing().returning()
      : await tx.delete(workspacePublicationGrants).where(
        and(
          eq(workspacePublicationGrants.tenantId, ctx.tenantId),
          eq(workspacePublicationGrants.userId, userId),
        ),
      ).returning();
    if (changed.length) {
      await recordAuditEventInTransaction(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        targetUserId: userId,
        action: action === 'grant' ? 'publication.granted' : 'publication.revoked',
      });
    }
    return { ok: true };
  });
}

/** The grant resource accepts exactly one action and one member reference. */
export function parsePublicationGrantForm(form: FormData):
  | { readonly ok: true; readonly userId: string; readonly action: 'grant' | 'revoke' }
  | { readonly ok: false; readonly code: 'invalid_member' | 'invalid_input' } {
  const action = form.get('action');
  const userId = form.get('userId');
  if (
    [...form.keys()].length !== 2 || form.getAll('action').length !== 1 ||
    form.getAll('userId').length !== 1 || (action !== 'grant' && action !== 'revoke')
  ) {
    return { ok: false, code: 'invalid_input' };
  }
  if (typeof userId !== 'string' || !isCanonicalUuid(userId) || userId === SYSTEM_USER_ID) {
    return { ok: false, code: 'invalid_member' };
  }
  return { ok: true, action, userId };
}

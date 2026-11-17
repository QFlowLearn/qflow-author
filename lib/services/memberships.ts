import { workspacePublicationGrants } from '../db/publication_schema.ts';
import { lockWorkspaceAndRequireAuthority } from './workspace_authorization.ts';
import { recordAuditEventInTransaction } from './audit_logs.ts';
import type { RequestContext } from '../tenants.ts';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, type QflowDatabaseTransaction } from '../db.ts';
import { organizationMemberships, users } from '../db/schema.ts';
import { parseRole, type Role } from '../roles.ts';

export async function getMembershipRole(userId: string, tenantId: string): Promise<Role | null> {
  const rows = await db.select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.tenantId, tenantId),
      ),
    )
    .limit(1);

  return parseRole(rows[0]?.role ?? null);
}

export type MemberRecord = {
  userId: string;
  email: string;
  displayName?: string | null;
  role: string;
  canPublishEditions: boolean;
  joinedAt?: string | null;
};

export type MemberSearchResult = Pick<MemberRecord, 'userId' | 'email' | 'displayName'>;

/** Search a bounded set of tenant members for assignment controls. */
export async function searchMembers(
  tenantId: string,
  query: string,
  limit = 20,
): Promise<readonly MemberSearchResult[]> {
  const phrase = query.trim();
  if (
    phrase.length < 2 || phrase.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 50
  ) {
    return [];
  }
  return await db.select({
    userId: users.id,
    email: users.email,
    displayName: users.displayName,
  })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(and(
      eq(organizationMemberships.tenantId, tenantId),
      or(ilike(users.email, `%${phrase}%`), ilike(users.displayName, `%${phrase}%`)),
    ))
    .orderBy(asc(users.email))
    .limit(limit);
}

export async function listMembers(tenantId: string): Promise<MemberRecord[]> {
  const rows = await db.select({
    userId: users.id,
    email: users.email,
    displayName: users.displayName,
    role: organizationMemberships.role,
    joinedAt: organizationMemberships.joinedAt,
    canPublishEditions: sql<boolean>`${workspacePublicationGrants.userId} IS NOT NULL`,
  })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .leftJoin(
      workspacePublicationGrants,
      and(
        eq(workspacePublicationGrants.tenantId, organizationMemberships.tenantId),
        eq(workspacePublicationGrants.userId, organizationMemberships.userId),
      ),
    )
    .where(eq(organizationMemberships.tenantId, tenantId))
    .orderBy(users.email);
  return rows.map((row) => ({
    userId: row.userId,
    email: row.email,
    displayName: row.displayName ?? null,
    role: row.role,
    canPublishEditions: row.canPublishEditions,
    joinedAt: row.joinedAt ? row.joinedAt.toISOString() : null,
  }));
}

type MembershipMutationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'not_found' | 'last_owner' | 'forbidden' };

/** Changes a membership role while preserving at least one tenant owner. */
export async function updateMemberRole(input: {
  readonly actor: RequestContext;
  readonly tenantId: string;
  readonly userId: string;
  readonly role: Role;
}): Promise<MembershipMutationResult> {
  return await withLockedMembership(input, async (tx, currentRole) => {
    if (currentRole === 'owner' && input.role !== 'owner') {
      const lastOwner = await rejectIfLastOwner(tx, input.tenantId);
      if (lastOwner) return lastOwner;
    }
    await tx.update(organizationMemberships)
      .set({ role: input.role })
      .where(
        and(
          eq(organizationMemberships.userId, input.userId),
          eq(organizationMemberships.tenantId, input.tenantId),
        ),
      );
    await recordAuditEventInTransaction(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actor.userId,
      targetUserId: input.userId,
      action: 'member_role_updated',
      metadata: { role: input.role },
    });
    return { ok: true };
  });
}

/** Removes a membership while preserving at least one tenant owner. */
export async function removeMember(input: {
  readonly actor: RequestContext;
  readonly tenantId: string;
  readonly userId: string;
}): Promise<MembershipMutationResult> {
  return await withLockedMembership(input, async (tx, currentRole) => {
    if (currentRole === 'owner') {
      const lastOwner = await rejectIfLastOwner(tx, input.tenantId);
      if (lastOwner) return lastOwner;
    }
    const removedGrants = await tx.delete(workspacePublicationGrants).where(and(
      eq(workspacePublicationGrants.tenantId, input.tenantId),
      eq(workspacePublicationGrants.userId, input.userId),
    )).returning({ userId: workspacePublicationGrants.userId });
    if (removedGrants.length) {
      await recordAuditEventInTransaction(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actor.userId,
        targetUserId: input.userId,
        action: 'publication.revoked',
        metadata: { reason: 'membership_removed' },
      });
    }
    await tx.delete(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, input.userId),
          eq(organizationMemberships.tenantId, input.tenantId),
        ),
      );
    await recordAuditEventInTransaction(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actor.userId,
      targetUserId: input.userId,
      action: 'member_removed',
    });
    return { ok: true };
  });
}

async function withLockedMembership(
  input: { readonly actor: RequestContext; readonly tenantId: string; readonly userId: string },
  mutate: (
    tx: QflowDatabaseTransaction,
    currentRole: string,
  ) => Promise<MembershipMutationResult>,
): Promise<MembershipMutationResult> {
  return await db.transaction(async (tx) => {
    if (
      input.actor.tenantId !== input.tenantId ||
      !await lockWorkspaceAndRequireAuthority(tx, input.actor, { capability: 'manage_members' })
    ) return { ok: false, code: 'forbidden' };
    const rows = await tx.select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, input.userId),
          eq(organizationMemberships.tenantId, input.tenantId),
        ),
      )
      .for('update')
      .limit(1);
    if (!rows.length) return { ok: false, code: 'not_found' };
    return await mutate(tx, rows[0].role);
  });
}

async function rejectIfLastOwner(
  tx: QflowDatabaseTransaction,
  tenantId: string,
): Promise<{ readonly ok: false; readonly code: 'last_owner' } | undefined> {
  if (await countOwners(tx, tenantId) <= 1) return { ok: false, code: 'last_owner' };
  return undefined;
}

async function countOwners(
  tx: QflowDatabaseTransaction,
  tenantId: string,
): Promise<number> {
  const rows = await tx.select({ count: sql<number>`COUNT(*)` })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.tenantId, tenantId),
        eq(organizationMemberships.role, 'owner'),
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

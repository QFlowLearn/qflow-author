import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizationMemberships, users } from './principal_schema.ts';

/** Explicit publication authority; removing membership also removes the grant. */
export const workspacePublicationGrants = pgTable('workspace_publication_grants', {
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  grantedBy: uuid('granted_by').notNull().references(() => users.id),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.userId] }),
  member: foreignKey({
    columns: [t.tenantId, t.userId],
    foreignColumns: [organizationMemberships.tenantId, organizationMemberships.userId],
  }).onDelete('cascade'),
  human: check(
    'workspace_publication_grants_user_id_check',
    sql`${t.userId} <> '00000000-0000-0000-0000-000000000000'`,
  ),
}));

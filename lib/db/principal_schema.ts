import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Tenant identity referenced by tenant-owned persistence records. */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    bankDisplayName: text('bank_display_name'),
    loginPolicy: text('login_policy').notNull().default('allow_password'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    bankDisplayNameCheck: check(
      'tenants_bank_display_name_check',
      sql`${t.bankDisplayName} IS NULL OR (${t.bankDisplayName} = btrim(${t.bankDisplayName}) AND char_length(${t.bankDisplayName}) BETWEEN 1 AND 160)`,
    ),
  }),
);

/** User identity referenced by actor-owned persistence records. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    emailNormalized: text('email_normalized').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    authProvider: text('auth_provider'),
    authProviderId: text('auth_provider_id'),
    plan: text('plan').notNull().default('free'),
    planPeriodStart: timestamp('plan_period_start', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    emailNormalizedUnique: uniqueIndex('users_email_normalized_unique_idx').on(
      table.emailNormalized,
    ),
  }),
);

/** One user's tenant membership and workspace role. */
export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'cascade',
    }),
    role: text('role').notNull().default('instructor'),
    invitedAt: timestamp('invited_at', { withTimezone: true }).defaultNow(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => ({
    tenantUserUnique: uniqueIndex('organization_memberships_unique_idx').on(
      table.tenantId,
      table.userId,
    ),
  }),
);

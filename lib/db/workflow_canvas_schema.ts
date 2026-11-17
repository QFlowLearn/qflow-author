import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizationMemberships, tenants } from './principal_schema.ts';

export const workflowDispatches = pgTable(
  'workflow_dispatches',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    jobId: uuid('job_id').notNull(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    state: text('state').notNull(),
    workflowStatus: text('workflow_status'),
    attempts: integer('attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kindCheck: check(
      'workflow_dispatches_kind_check',
      sql`${table.kind} IN ('source_migration', 'ai_generation', 'release_build', 'migration_commit', 'bank_enrichment', 'question_organization', 'assessment_print')`,
    ),
    stateCheck: check(
      'workflow_dispatches_state_check',
      sql`${table.state} IN ('pending', 'active', 'complete', 'failed')`,
    ),
    workflowStatusCheck: check(
      'workflow_dispatches_workflow_status_check',
      sql`${table.workflowStatus} IS NULL OR ${table.workflowStatus} IN ('queued', 'running', 'paused', 'errored', 'terminated', 'complete', 'waiting', 'waitingForPause', 'unknown')`,
    ),
    lifecycleCheck: check(
      'workflow_dispatches_lifecycle_check',
      sql`(${table.state} = 'pending' AND ${table.startedAt} IS NULL AND ${table.completedAt} IS NULL) OR (${table.state} = 'active' AND ${table.startedAt} IS NOT NULL AND ${table.completedAt} IS NULL) OR (${table.state} IN ('complete', 'failed') AND ${table.startedAt} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`,
    ),
    attemptsCheck: check(
      'workflow_dispatches_attempts_check',
      sql`${table.attempts} >= 0`,
    ),
    stateIndex: index('workflow_dispatches_state_idx').on(table.state, table.updatedAt),
    jobIndex: index('workflow_dispatches_job_idx').on(table.kind, table.jobId),
    openJobIndex: uniqueIndex('workflow_dispatches_open_job_idx')
      .on(table.kind, table.jobId)
      .where(sql`${table.state} IN ('pending', 'active')`),
  }),
);

export const canvasConnections = pgTable(
  'canvas_connections',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    clientId: text('client_id').notNull(),
    encryptedClientSecret: text('encrypted_client_secret').notNull(),
    credentialVersion: integer('credential_version').notNull(),
    lifecycleState: text('lifecycle_state').notNull().default('active'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantBaseUrlUnique: uniqueIndex('canvas_connections_tenant_base_url_idx').on(
      table.tenantId,
      table.baseUrl,
    ),
    identityTenantUnique: unique('canvas_connections_id_tenant_unique').on(
      table.id,
      table.tenantId,
    ),
    creatorMembershipForeignKey: foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [organizationMemberships.tenantId, organizationMemberships.userId],
      name: 'canvas_connections_creator_membership_fk',
    }),
    lifecycleStateCheck: check(
      'canvas_connections_lifecycle_state_check',
      sql`${table.lifecycleState} IN ('active', 'disabled')`,
    ),
    credentialVersionCheck: check(
      'canvas_connections_credential_version_check',
      sql`${table.credentialVersion} >= 1`,
    ),
  }),
);

export const canvasUserGrants = pgTable(
  'canvas_user_grants',
  {
    connectionId: uuid('connection_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
    canvasUserId: text('canvas_user_id'),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.connectionId, table.userId] }),
    connectionTenantForeignKey: foreignKey({
      columns: [table.connectionId, table.tenantId],
      foreignColumns: [canvasConnections.id, canvasConnections.tenantId],
      name: 'canvas_user_grants_connection_tenant_fk',
    }).onDelete('cascade'),
    userMembershipForeignKey: foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [organizationMemberships.tenantId, organizationMemberships.userId],
      name: 'canvas_user_grants_user_membership_fk',
    }).onDelete('cascade'),
    tenantUserIndex: index('canvas_user_grants_tenant_user_idx').on(
      table.tenantId,
      table.userId,
    ),
  }),
);

export const canvasOauthStates = pgTable(
  'canvas_oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    connectionId: uuid('connection_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    credentialVersion: integer('credential_version').notNull(),
    returnPath: text('return_path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    connectionTenantForeignKey: foreignKey({
      columns: [table.connectionId, table.tenantId],
      foreignColumns: [canvasConnections.id, canvasConnections.tenantId],
      name: 'canvas_oauth_states_connection_tenant_fk',
    }).onDelete('cascade'),
    userMembershipForeignKey: foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [organizationMemberships.tenantId, organizationMemberships.userId],
      name: 'canvas_oauth_states_user_membership_fk',
    }).onDelete('cascade'),
    expiryIndex: index('canvas_oauth_states_expiry_idx').on(table.expiresAt),
    credentialVersionCheck: check(
      'canvas_oauth_states_credential_version_check',
      sql`${table.credentialVersion} >= 1`,
    ),
    lifetimeCheck: check(
      'canvas_oauth_states_lifetime_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  }),
);

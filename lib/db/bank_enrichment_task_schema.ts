import { tenants } from './principal_schema.ts';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { enrichmentBudgets } from './bank_enrichment_usage_schema.ts';
import { enrichmentSchemeVersions } from './bank_enrichment_schema.ts';

/** A single dispatch identity distinguishes previews from full runs without duplicating their state. */
export const enrichmentTasks = pgTable('bank_enrichment_tasks', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  budgetId: uuid('budget_id'),
  kind: text('kind').notNull(),
}, (t) => ({
  identity: uniqueIndex('enrichment_task_identity_idx').on(t.id, t.tenantId),
  budget: foreignKey({
    columns: [t.budgetId, t.tenantId],
    foreignColumns: [enrichmentBudgets.id, enrichmentBudgets.tenantId],
  }),
  budgetIdentity: check(
    'enrichment_task_budget_identity',
    sql`(${t.kind} IN ('preview', 'classify')) = (${t.budgetId} IS NOT NULL) AND (${t.budgetId} IS NULL OR ${t.budgetId} = ${t.id})`,
  ),
  kind: check('enrichment_task_kind', sql`${t.kind} IN ('preview', 'classify', 'correct', 'undo')`),
}));

/** Durable setup work before an instructor saves a scheme version. */
export const enrichmentPreviews = pgTable('bank_enrichment_previews', {
  baseVersionId: uuid('base_version_id'),
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  seed: uuid('seed').notNull(),
  audience: text('audience').notNull(),
  definition: jsonb('definition').$type<unknown>(),
  state: text('state').notNull(),
  phase: text('phase').notNull(),
  proposal: jsonb('proposal').$type<unknown>(),
  attemptId: uuid('attempt_id'),
  attempts: integer('attempts').notNull().default(0),
  retriesRemaining: integer('retries_remaining').notNull().default(3),
  sample: jsonb('sample').$type<unknown>(),
  result: jsonb('result').$type<unknown>(),
  errorCode: text('error_code'),
  workflowExecutionId: uuid('workflow_execution_id').notNull(),
  leaseToken: uuid('lease_token'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  task: foreignKey({
    columns: [t.id, t.tenantId],
    foreignColumns: [enrichmentTasks.id, enrichmentTasks.tenantId],
  }),
  baseVersion: foreignKey({
    columns: [t.baseVersionId, t.tenantId],
    foreignColumns: [enrichmentSchemeVersions.id, enrichmentSchemeVersions.tenantId],
  }),
  state: check(
    'enrichment_preview_state',
    sql`${t.state} IN ('queued', 'running', 'completed', 'failed', 'cancelled')`,
  ),
  lease: check(
    'enrichment_preview_lease',
    sql`(${t.state} = 'running') = (${t.leaseToken} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`,
  ),
}));

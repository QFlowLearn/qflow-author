import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { enrichmentSnapshots } from './bank_enrichment_schema.ts';

/** One immutable spending limit for a preview or full-bank operation. */
export const enrichmentBudgets = pgTable('bank_enrichment_budgets', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  snapshotId: uuid('snapshot_id').notNull(),
  purpose: text('purpose').notNull(),
  configuration: jsonb('configuration').$type<unknown>().notNull(),
  limitMicros: integer('limit_micros').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  identity: uniqueIndex('enrichment_budget_identity_idx').on(t.id, t.tenantId),
  snapshot: foreignKey({
    columns: [t.snapshotId, t.tenantId],
    foreignColumns: [enrichmentSnapshots.id, enrichmentSnapshots.tenantId],
  }),
  limit: check('enrichment_budget_limit', sql`${t.limitMicros} > 0`),
  purpose: check('enrichment_budget_purpose', sql`${t.purpose} IN ('preview', 'run')`),
}));

/** A dispatched attempt consumes its reserve until a trustworthy usage receipt is stored. */
export const enrichmentUsageAttempts = pgTable('bank_enrichment_usage_attempts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  budgetId: uuid('budget_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  reservedMicros: bigint('reserved_micros', { mode: 'number' }).notNull(),
  chargedMicros: bigint('charged_micros', { mode: 'number' }),
  state: text('state').notNull(),
  receipt: jsonb('receipt').$type<unknown>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
}, (t) => ({
  budget: foreignKey({
    columns: [t.budgetId, t.tenantId],
    foreignColumns: [enrichmentBudgets.id, enrichmentBudgets.tenantId],
  }),
  state: check('enrichment_usage_state', sql`${t.state} IN ('dispatched', 'settled')`),
  receipt: check(
    'enrichment_usage_receipt',
    sql`(${t.state} = 'settled') = (${t.receipt} IS NOT NULL AND ${t.settledAt} IS NOT NULL AND ${t.chargedMicros} IS NOT NULL)`,
  ),
  amount: check(
    'enrichment_usage_amount',
    sql`${t.reservedMicros} > 0 AND (${t.chargedMicros} IS NULL OR ${t.chargedMicros} >= 0)`,
  ),
  fingerprint: check('enrichment_usage_fingerprint', sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
}));

import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './principal_schema.ts';

/** One actor-bound, immutable paper reservation and its complete candidate pair. */
export const assessmentPrintPacks = pgTable('assessment_print_packs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  operationId: uuid('operation_id').notNull(),
  sourceDigest: text('source_digest').notNull(),
  snapshot: jsonb('snapshot').$type<unknown>().notNull(),
  state: text('state').notNull(),
  workflowExecutionId: uuid('workflow_execution_id'),
  candidate: jsonb('candidate').$type<unknown>(),
  failureCode: text('failure_code'),
  confirmedBy: uuid('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  manifest: text('manifest'),
  manifestSha256: text('manifest_sha256'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (table) => ({
  operation: unique().on(table.tenantId, table.operationId),
  identity: unique().on(table.tenantId, table.id),
  state: check(
    'assessment_print_packs_state_check',
    sql`${table.state} IN ('preparing','queued','building','preview-ready','confirmed','failed')`,
  ),
  complete: check(
    'assessment_print_packs_complete_check',
    sql`(${table.state} IN ('preview-ready','confirmed') AND ${table.candidate} IS NOT NULL) OR (${table.state} NOT IN ('preview-ready','confirmed') AND ${table.candidate} IS NULL)`,
  ),
  confirmed: check(
    'assessment_print_packs_confirmed_check',
    sql`(${table.state} = 'confirmed' AND ${table.confirmedAt} IS NOT NULL AND ${table.confirmedBy} IS NOT NULL AND ${table.manifest} IS NOT NULL AND ${table.manifestSha256} IS NOT NULL) OR (${table.state} <> 'confirmed' AND ${table.confirmedAt} IS NULL AND ${table.confirmedBy} IS NULL AND ${table.manifest} IS NULL AND ${table.manifestSha256} IS NULL)`,
  ),
  assessment: index('assessment_print_packs_assessment_idx').on(
    table.tenantId,
    table.assessmentId,
    table.createdAt,
  ),
}));

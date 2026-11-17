import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { migrationRuns } from './migration_schema.ts';

export const aiUsageTable = pgTable('ai_usage', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  model: text('model').notNull(),
  generationMode: text('generation_mode').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  questionsGenerated: integer('questions_generated').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const aiGenerationJobsTable = pgTable(
  'ai_generation_jobs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    conversionRunId: uuid('conversion_run_id').notNull().references(() => migrationRuns.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id').notNull(),
    status: text('status').notNull(),
    progress: integer('progress').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    output: jsonb('output').$type<Record<string, unknown> | null>(),
    error: text('error'),
    attempts: integer('attempts').notNull(),
    maxAttempts: integer('max_attempts').notNull(),
    leaseToken: uuid('lease_token'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    oneActiveJobPerRun: uniqueIndex('ai_generation_jobs_one_active_run_idx')
      .on(table.conversionRunId)
      .where(sql`${table.status} IN ('queued', 'running')`),
    leaseStateCheck: check(
      'ai_generation_jobs_lease_state_check',
      sql`(${table.status} = 'queued' AND ${table.leaseToken} IS NULL AND ${table.startedAt} IS NULL AND ${table.completedAt} IS NULL) OR (${table.status} = 'running' AND ${table.leaseToken} IS NOT NULL AND ${table.startedAt} IS NOT NULL AND ${table.completedAt} IS NULL) OR (${table.status} IN ('completed', 'failed') AND ${table.leaseToken} IS NULL AND ${table.completedAt} IS NOT NULL)`,
    ),
  }),
);

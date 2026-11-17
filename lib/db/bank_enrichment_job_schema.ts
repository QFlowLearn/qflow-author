import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { enrichmentSchemeVersions, enrichmentSnapshots } from './bank_enrichment_schema.ts';
import { questionRevisions } from './question_schema.ts';

/** A full-bank operation fixes its input scope, scheme and overwrite policy before dispatch. */
export const enrichmentRuns = pgTable('bank_enrichment_runs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  snapshotId: uuid('snapshot_id').notNull(),
  schemeId: uuid('scheme_id').notNull(),
  versionId: uuid('version_id').notNull(),
  kind: text('kind').notNull(),
  state: text('state').notNull(),
  dimensions: jsonb('dimensions').$type<unknown>().notNull(),
  replacement: text('replacement').notNull(),
  configuration: jsonb('configuration').$type<unknown>(),
  result: jsonb('result').$type<unknown>(),
  sourceRunId: uuid('source_run_id'),
  workflowExecutionId: uuid('workflow_execution_id'),
  leaseToken: uuid('lease_token'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  identity: uniqueIndex('enrichment_run_identity_idx').on(t.id, t.tenantId, t.schemeId),
  snapshot: foreignKey({
    columns: [t.snapshotId, t.tenantId],
    foreignColumns: [enrichmentSnapshots.id, enrichmentSnapshots.tenantId],
  }),
  version: foreignKey({
    columns: [t.versionId, t.schemeId, t.tenantId],
    foreignColumns: [
      enrichmentSchemeVersions.id,
      enrichmentSchemeVersions.schemeId,
      enrichmentSchemeVersions.tenantId,
    ],
  }),
  source: foreignKey({
    columns: [t.sourceRunId, t.tenantId, t.schemeId],
    foreignColumns: [t.id, t.tenantId, t.schemeId],
  }),
  active: uniqueIndex('enrichment_one_active_scheme_idx').on(t.tenantId, t.schemeId).where(
    sql`${t.kind} = 'classify' AND ${t.state} IN ('queued', 'running')`,
  ),
  stateCheck: check(
    'enrichment_run_state',
    sql`${t.state} IN ('prepared', 'queued', 'running', 'completed', 'completed_with_issues', 'failed', 'cancelled')`,
  ),
  kindCheck: check('enrichment_run_kind', sql`${t.kind} IN ('classify', 'correct', 'undo')`),
  replacementCheck: check(
    'enrichment_run_replacement',
    sql`${t.replacement} IN ('preserve_manual', 'replace_captured')`,
  ),
  dimensionsCheck: check(
    'enrichment_run_dimensions',
    sql`jsonb_typeof(${t.dimensions}) = 'array' AND jsonb_array_length(${t.dimensions}) BETWEEN 1 AND 3`,
  ),
  leaseCheck: check(
    'enrichment_run_lease',
    sql`(${t.leaseToken} IS NULL) = (${t.leaseExpiresAt} IS NULL)`,
  ),
  runningLeaseCheck: check(
    'enrichment_running_lease',
    sql`(${t.state} = 'running') = (${t.leaseToken} IS NOT NULL)`,
  ),
  sourceCheck: check(
    'enrichment_undo_source',
    sql`(${t.kind} = 'undo') = (${t.sourceRunId} IS NOT NULL)`,
  ),
  configurationCheck: check(
    'enrichment_run_configuration',
    sql`${t.state} IN ('prepared', 'cancelled') OR (${t.configuration} IS NOT NULL AND jsonb_typeof(${t.configuration}) = 'object')`,
  ),
}));

/** Source revisions and per-dimension change tokens captured at the start of a full run. */
export const enrichmentRunItems = pgTable('bank_enrichment_run_items', {
  runId: uuid('run_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  schemeId: uuid('scheme_id').notNull(),
  questionId: uuid('question_id').notNull(),
  revisionId: uuid('revision_id').notNull(),
  baseline: jsonb('baseline').$type<unknown>().notNull(),
  state: text('state').notNull(),
  detail: jsonb('detail').$type<unknown>(),
}, (t) => ({
  identity: primaryKey({ columns: [t.runId, t.questionId] }),
  run: foreignKey({
    columns: [t.runId, t.tenantId, t.schemeId],
    foreignColumns: [enrichmentRuns.id, enrichmentRuns.tenantId, enrichmentRuns.schemeId],
  }),
  revision: foreignKey({
    columns: [t.revisionId, t.questionId, t.tenantId],
    foreignColumns: [
      questionRevisions.id,
      questionRevisions.questionId,
      questionRevisions.tenantId,
    ],
  }),
  bankLookup: index('enrichment_run_items_bank_lookup_idx').on(
    t.tenantId,
    t.schemeId,
    t.questionId,
  ),
  pending: index('enrichment_run_items_state_idx').on(t.runId, t.state, t.questionId),
  stateCheck: check(
    'enrichment_item_state',
    sql`${t.state} IN ('pending', 'classified', 'unassigned', 'protected', 'outdated', 'failed', 'cancelled')`,
  ),
  baselineCheck: check('enrichment_item_baseline', sql`jsonb_typeof(${t.baseline}) = 'object'`),
}));

/** Durable provider receipts keep successful responses out of repeated provider calls. */
export const enrichmentBatches = pgTable('bank_enrichment_batches', {
  runId: uuid('run_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  schemeId: uuid('scheme_id').notNull(),
  sequence: integer('sequence').notNull(),
  attemptId: uuid('attempt_id'),
  errorCode: text('error_code'),
  state: text('state').notNull(),
  questionIds: jsonb('question_ids').$type<unknown>().notNull(),
  response: jsonb('response').$type<unknown>(),
  attempts: integer('attempts').notNull(),
  retriesRemaining: integer('retries_remaining').notNull().default(3),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  identity: primaryKey({ columns: [t.runId, t.sequence] }),
  run: foreignKey({
    columns: [t.runId, t.tenantId, t.schemeId],
    foreignColumns: [enrichmentRuns.id, enrichmentRuns.tenantId, enrichmentRuns.schemeId],
  }),
  stateCheck: check(
    'enrichment_batch_state',
    sql`${t.state} IN ('reserved', 'received', 'applied', 'failed')`,
  ),
  countsCheck: check(
    'enrichment_batch_counts',
    sql`${t.sequence} >= 0 AND ${t.attempts} >= 0 AND ${t.inputTokens} >= 0 AND ${t.outputTokens} >= 0`,
  ),
  responseCheck: check(
    'enrichment_batch_response',
    sql`${t.state} NOT IN ('received', 'applied') OR ${t.response} IS NOT NULL`,
  ),
  selectionCheck: check(
    'enrichment_batch_selection',
    sql`jsonb_typeof(${t.questionIds}) = 'array'`,
  ),
}));

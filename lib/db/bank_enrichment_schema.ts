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
import { tenants } from './principal_schema.ts';
import { questionRevisions, questions } from './question_schema.ts';

/** Workspace vocabulary identity shared by its immutable versions. */
export const enrichmentSchemes = pgTable(
  'bank_enrichment_schemes',
  {
    portableId: uuid('portable_id').notNull().defaultRandom(),
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    identity: uniqueIndex('enrichment_scheme_tenant_idx').on(t.id, t.tenantId),
    portable: uniqueIndex('enrichment_scheme_portable_tenant_idx').on(t.tenantId, t.portableId),
  }),
);

/** Definition JSON is parsed at the persistence boundary; SQL forbids updating versions. */
export const enrichmentSchemeVersions = pgTable('bank_enrichment_scheme_versions', {
  portableId: uuid('portable_id').notNull().defaultRandom(),
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  schemeId: uuid('scheme_id').notNull(),
  version: integer('version').notNull(),
  definition: jsonb('definition').$type<unknown>().notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  portable: uniqueIndex('enrichment_version_portable_tenant_idx').on(t.tenantId, t.portableId),
  identity: uniqueIndex('enrichment_version_scheme_tenant_idx').on(t.id, t.schemeId, t.tenantId),
  tenantIdentity: uniqueIndex('enrichment_version_tenant_idx').on(t.id, t.tenantId),
  sequence: uniqueIndex('enrichment_version_sequence_idx').on(t.schemeId, t.version),
  scheme: foreignKey({
    columns: [t.schemeId, t.tenantId],
    foreignColumns: [enrichmentSchemes.id, enrichmentSchemes.tenantId],
  }),
  versionCheck: check('enrichment_version_positive', sql`${t.version} > 0`),
  definitionCheck: check(
    'enrichment_definition_object',
    sql`jsonb_typeof(${t.definition}) = 'object'`,
  ),
}));

/** A captured query or selection; the browser never supplies the full matching bank. */
export const enrichmentSnapshots = pgTable('bank_enrichment_snapshots', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  scope: jsonb('scope').$type<unknown>().notNull(),
  itemCount: integer('item_count').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  identity: uniqueIndex('enrichment_snapshot_tenant_idx').on(t.id, t.tenantId),
  countCheck: check('enrichment_snapshot_count_nonnegative', sql`${t.itemCount} >= 0`),
  scopeCheck: check('enrichment_snapshot_scope_object', sql`jsonb_typeof(${t.scope}) = 'object'`),
}));

/** Immutable question/revision references, independent of later content or filter changes. */
export const enrichmentSnapshotItems = pgTable('bank_enrichment_snapshot_items', {
  snapshotId: uuid('snapshot_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  questionId: uuid('question_id').notNull(),
  revisionId: uuid('revision_id').notNull(),
}, (t) => ({
  identity: primaryKey({ columns: [t.snapshotId, t.questionId] }),
  snapshot: foreignKey({
    columns: [t.snapshotId, t.tenantId],
    foreignColumns: [enrichmentSnapshots.id, enrichmentSnapshots.tenantId],
  }),
  revision: foreignKey({
    columns: [t.revisionId, t.questionId, t.tenantId],
    foreignColumns: [
      questionRevisions.id,
      questionRevisions.questionId,
      questionRevisions.tenantId,
    ],
  }),
}));

/** Append-only assignment values; current rows only point here, avoiding duplicate values. */
export const enrichmentChanges = pgTable('bank_enrichment_changes', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  questionId: uuid('question_id').notNull(),
  revisionId: uuid('revision_id').notNull(),
  schemeId: uuid('scheme_id').notNull(),
  versionId: uuid('version_id').notNull(),
  dimension: text('dimension').notNull(),
  value: jsonb('value').$type<unknown>().notNull(),
  origin: text('origin').notNull(),
  operationId: uuid('operation_id').notNull(),
  previousChangeId: uuid('previous_change_id'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  identity: uniqueIndex('enrichment_change_identity_idx').on(
    t.id,
    t.tenantId,
    t.schemeId,
    t.questionId,
    t.dimension,
  ),
  replay: uniqueIndex('enrichment_change_operation_idx').on(
    t.tenantId,
    t.operationId,
    t.schemeId,
    t.questionId,
    t.dimension,
  ),
  previous: foreignKey({
    columns: [t.previousChangeId, t.tenantId, t.schemeId, t.questionId, t.dimension],
    foreignColumns: [t.id, t.tenantId, t.schemeId, t.questionId, t.dimension],
  }),
  version: foreignKey({
    columns: [t.versionId, t.schemeId, t.tenantId],
    foreignColumns: [
      enrichmentSchemeVersions.id,
      enrichmentSchemeVersions.schemeId,
      enrichmentSchemeVersions.tenantId,
    ],
  }),
  revision: foreignKey({
    columns: [t.revisionId, t.questionId, t.tenantId],
    foreignColumns: [
      questionRevisions.id,
      questionRevisions.questionId,
      questionRevisions.tenantId,
    ],
  }),
  dimensionCheck: check(
    'enrichment_change_dimension',
    sql`${t.dimension} IN ('subject', 'topic', 'difficulty')`,
  ),
  originCheck: check(
    'enrichment_change_origin',
    sql`${t.origin} IN ('ai', 'human', 'undo', 'source')`,
  ),
  valueCheck: check('enrichment_change_value_object', sql`jsonb_typeof(${t.value}) = 'object'`),
  absenceCheck: check(
    'enrichment_absence_is_undo',
    sql`${t.value} ->> 'state' <> 'absent' OR (${t.value} = '{"state":"absent"}'::jsonb AND ${t.origin} = 'undo' AND ${t.previousChangeId} IS NOT NULL)`,
  ),
  operationLookup: index('enrichment_change_operation_lookup_idx').on(
    t.tenantId,
    t.operationId,
    t.questionId,
    t.dimension,
  ),
}));

/** Current classification identity is a compare-and-swap token, including same-value edits. */
export const enrichmentAssignments = pgTable('bank_enrichment_assignments', {
  tenantId: uuid('tenant_id').notNull(),
  schemeId: uuid('scheme_id').notNull(),
  questionId: uuid('question_id').notNull(),
  dimension: text('dimension').notNull(),
  changeId: uuid('change_id').notNull(),
}, (t) => ({
  identity: primaryKey({ columns: [t.tenantId, t.schemeId, t.questionId, t.dimension] }),
  change: foreignKey({
    columns: [t.changeId, t.tenantId, t.schemeId, t.questionId, t.dimension],
    foreignColumns: [
      enrichmentChanges.id,
      enrichmentChanges.tenantId,
      enrichmentChanges.schemeId,
      enrichmentChanges.questionId,
      enrichmentChanges.dimension,
    ],
  }),
  question: foreignKey({
    columns: [t.questionId, t.tenantId],
    foreignColumns: [questions.id, questions.tenantId],
  }),
}));

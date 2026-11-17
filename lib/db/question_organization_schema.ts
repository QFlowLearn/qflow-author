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
import { bankCollections } from './bank_schema.ts';
import { enrichmentSchemeVersions } from './bank_enrichment_schema.ts';
import { questionRevisions, questions } from './question_schema.ts';

/** Immutable saved policies. Activation selects the version used for future intake. */
export const organizationSetups = pgTable('question_organization_setups', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  collectionId: uuid('collection_id').notNull(),
  version: integer('version').notNull(),
  versionId: uuid('version_id').notNull(),
  policy: jsonb('policy').$type<unknown>().notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  identity: uniqueIndex('organization_setup_identity').on(t.id, t.tenantId),
  collectionIdentity: uniqueIndex('organization_setup_collection_identity').on(
    t.id,
    t.tenantId,
    t.collectionId,
  ),
  sequence: uniqueIndex('organization_setup_sequence').on(t.collectionId, t.version),
  collection: foreignKey({
    columns: [t.collectionId, t.tenantId],
    foreignColumns: [bankCollections.id, bankCollections.tenantId],
  }),
  vocabulary: foreignKey({
    columns: [t.versionId, t.tenantId],
    foreignColumns: [enrichmentSchemeVersions.id, enrichmentSchemeVersions.tenantId],
  }),
  versionCheck: check('organization_setup_version', sql`${t.version} > 0`),
  classifierKind: check(
    'organization_classifier_kind',
    sql`${t.policy} #>> '{classifier,kind}' IN ('source_only', 'clef')`,
  ),
}));

/** Explicit opt-in for future saves; a null setup disables future automatic work. */
export const organizationActivation = pgTable('question_organization_activation', {
  collectionId: uuid('collection_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  setupId: uuid('setup_id'),
  revision: integer('revision').notNull(),
  operationId: uuid('operation_id').notNull(),
  changedBy: uuid('changed_by').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
}, (t) => ({
  collection: foreignKey({
    columns: [t.collectionId, t.tenantId],
    foreignColumns: [bankCollections.id, bankCollections.tenantId],
  }).onDelete('cascade'),
  setup: foreignKey({
    columns: [t.setupId, t.tenantId, t.collectionId],
    foreignColumns: [
      organizationSetups.id,
      organizationSetups.tenantId,
      organizationSetups.collectionId,
    ],
  }),
  revisionCheck: check('organization_activation_revision', sql`${t.revision} > 0`),
}));

/** One owning collection determines automatic setup; additional filing never changes it. */
export const organizationOrigins = pgTable('question_organization_origins', {
  tenantId: uuid('tenant_id').notNull(),
  questionId: uuid('question_id').primaryKey(),
  collectionId: uuid('collection_id').notNull(),
  source: jsonb('source').$type<unknown>(),
}, (t) => ({
  question: foreignKey({
    columns: [t.questionId, t.tenantId],
    foreignColumns: [questions.id, questions.tenantId],
  }).onDelete('cascade'),
  collection: foreignKey({
    columns: [t.collectionId, t.tenantId],
    foreignColumns: [bankCollections.id, bankCollections.tenantId],
  }).onDelete('cascade'),
}));

/** A committed run and its outbox row share one transaction. */
export const organizationRuns = pgTable('question_organization_runs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  setupId: uuid('setup_id').notNull(),
  executionId: uuid('execution_id').notNull(),
  executionBy: uuid('execution_by').notNull(),
  mode: text('mode').$type<'preview' | 'apply'>().notNull(),
  createdBy: uuid('created_by').notNull(),
  state: text('state').notNull(),
  reservedMicros: integer('reserved_micros').notNull().default(0),
  undoBy: uuid('undo_by'),
  undoCursor: uuid('undo_cursor'),
  undoProcessed: integer('undo_processed').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  identity: uniqueIndex('organization_run_identity').on(t.id, t.tenantId),
  setup: foreignKey({
    columns: [t.setupId, t.tenantId],
    foreignColumns: [organizationSetups.id, organizationSetups.tenantId],
  }),
  stateCheck: check(
    'organization_run_state',
    sql`${t.state} IN ('queued', 'completed', 'failed', 'cancelled', 'undoing', 'undo_failed', 'undone')`,
  ),
  modeCheck: check('organization_run_mode', sql`${t.mode} IN ('preview','apply')`),
  budget: check('organization_run_budget', sql`${t.reservedMicros} >= 0`),
  undoProgress: check(
    'organization_undo_progress',
    sql`(${t.undoProcessed} = 0 AND ${t.undoCursor} IS NULL) OR (${t.undoProcessed} BETWEEN 1 AND 10000 AND ${t.undoCursor} IS NOT NULL)`,
  ),
  undoActor: check(
    'organization_undo_actor',
    sql`${t.state} NOT IN ('undoing','undo_failed') OR (${t.undoBy} IS NOT NULL AND ${t.mode} = 'apply')`,
  ),
}));

/** Durable receipts precede application so recovery never repeats a successful classification. */
export const organizationItems = pgTable('question_organization_items', {
  tenantId: uuid('tenant_id').notNull(),
  runId: uuid('run_id').notNull(),
  questionId: uuid('question_id').notNull(),
  revisionId: uuid('revision_id').notNull(),
  contentHash: text('content_hash').notNull(),
  baseline: jsonb('baseline').$type<unknown>().notNull(),
  source: jsonb('source').$type<unknown>(),
  state: text('state').notNull(),
  decision: jsonb('decision').$type<unknown>(),
  attempts: integer('attempts').notNull().default(0),
  leaseToken: uuid('lease_token'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  detail: text('detail'),
}, (t) => ({
  identity: primaryKey({ columns: [t.runId, t.questionId] }),
  run: foreignKey({
    columns: [t.runId, t.tenantId],
    foreignColumns: [organizationRuns.id, organizationRuns.tenantId],
  }),
  revision: foreignKey({
    columns: [t.revisionId, t.questionId, t.tenantId],
    foreignColumns: [
      questionRevisions.id,
      questionRevisions.questionId,
      questionRevisions.tenantId,
    ],
  }),
  pending: index('organization_item_pending').on(t.runId, t.state, t.questionId),
  stateCheck: check(
    'organization_item_state',
    sql`${t.state} IN ('pending','processing','received','previewed','applied','protected','outdated','unassigned','unsupported','failed','cancelled')`,
  ),
  lease: check(
    'organization_item_lease',
    sql`(${t.leaseToken} IS NULL) = (${t.leaseExpiresAt} IS NULL)`,
  ),
  attemptsCheck: check('organization_item_attempts', sql`${t.attempts} BETWEEN 0 AND 3`),
  decisionKind: check(
    'organization_decision_kind',
    sql`${t.decision} IS NULL OR ${t.decision}->>'kind' IN ('source','preserved','clef','unassigned','unsupported','protected')`,
  ),
}));

/** Tombstones retain deliberate removals and same-value human edits for precise undo. */
export const organizationFiling = pgTable('question_organization_memberships', {
  tenantId: uuid('tenant_id').notNull(),
  collectionId: uuid('collection_id').notNull(),
  questionId: uuid('question_id').notNull(),
  changeId: uuid('change_id').notNull(),
  origin: text('origin').notNull(),
  state: text('state').notNull(),
}, (t) => ({
  identity: primaryKey({ columns: [t.collectionId, t.questionId] }),
  question: foreignKey({
    columns: [t.questionId, t.tenantId],
    foreignColumns: [questions.id, questions.tenantId],
  }).onDelete('cascade'),
  collection: foreignKey({
    columns: [t.collectionId, t.tenantId],
    foreignColumns: [bankCollections.id, bankCollections.tenantId],
  }).onDelete('cascade'),
  originCheck: check(
    'organization_membership_origin',
    sql`${t.origin} IN ('human','organization','undo')`,
  ),
  stateCheck: check('organization_membership_state', sql`${t.state} IN ('present','removed')`),
}));

/** Every possible provider charge has a durable reservation before dispatch. */
export const organizationAttempts = pgTable('question_organization_attempts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  runId: uuid('run_id').notNull(),
  questionId: uuid('question_id').notNull(),
  reservedMicros: integer('reserved_micros').notNull(),
  chargedMicros: integer('charged_micros'),
  state: text('state').notNull(),
  code: text('code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  item: foreignKey({
    columns: [t.runId, t.questionId],
    foreignColumns: [organizationItems.runId, organizationItems.questionId],
  }),
  run: foreignKey({
    columns: [t.runId, t.tenantId],
    foreignColumns: [organizationRuns.id, organizationRuns.tenantId],
  }),
  amount: check(
    'organization_attempt_amount',
    sql`${t.reservedMicros} > 0 AND (${t.chargedMicros} IS NULL OR ${t.chargedMicros} BETWEEN 0 AND ${t.reservedMicros})`,
  ),
  stateCheck: check(
    'organization_attempt_state',
    sql`${t.state} IN ('reserved','received','uncertain','skipped')`,
  ),
}));

/** One durable completion notice per execution; its current actor receives the notice. */
export const organizationNotices = pgTable('question_organization_notices', {
  executionId: uuid('execution_id').primaryKey(),
  runId: uuid('run_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => ({
  run: foreignKey({
    columns: [t.runId, t.tenantId],
    foreignColumns: [organizationRuns.id, organizationRuns.tenantId],
  }).onDelete('cascade'),
  unread: index('organization_notice_unread').on(t.tenantId, t.createdAt.desc()).where(
    sql`${t.readAt} IS NULL`,
  ),
}));

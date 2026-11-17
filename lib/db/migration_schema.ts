import { bankCollections } from './bank_schema.ts';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AssessmentBlueprint } from '../assessment_blueprint.ts';

export const migrationBatches = pgTable('migration_batches', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdBySnapshot: jsonb('created_by_snapshot').$type<Record<string, unknown>>().notNull(),
  purpose: text('purpose').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  sourceCount: integer('source_count').notNull(),
  assignedReviewerId: uuid('assigned_reviewer_id'),
  assignedBy: uuid('assigned_by'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  tenantIdentityUnique: uniqueIndex('migration_batches_id_tenant_idx')
    .on(table.id, table.tenantId),
  tenantIdempotencyUnique: uniqueIndex('migration_batches_tenant_idempotency_idx')
    .on(table.tenantId, table.idempotencyKey),
  purposeCheck: check(
    'migration_batches_purpose_check',
    sql`${table.purpose} IN ('recover_existing', 'generate_new')`,
  ),
  fingerprintCheck: check(
    'migration_batches_request_fingerprint_check',
    sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
  ),
  sourceCountCheck: check(
    'migration_batches_source_count_check',
    sql`${table.sourceCount} BETWEEN 1 AND 10`,
  ),
  reviewerAssignmentCheck: check(
    'migration_batches_reviewer_assignment_check',
    sql`(${table.assignedReviewerId} IS NULL AND ${table.assignedBy} IS NULL AND ${table.assignedAt} IS NULL) OR (${table.assignedReviewerId} IS NOT NULL AND ${table.assignedBy} IS NOT NULL AND ${table.assignedAt} IS NOT NULL)`,
  ),
}));

export const migrationRuns = pgTable('migration_runs', {
  id: uuid('id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  batchPosition: integer('batch_position').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  sourceFilename: text('source_filename').notNull(),
  sourceMime: text('source_mime'),
  sourceSize: integer('source_size').notNull(),
  adapterId: text('adapter_id').notNull(),
  adapterLabel: text('adapter_label').notNull(),
  adapterVersion: text('adapter_version').notNull(),
  status: text('status').notNull(),
  parts: jsonb('parts').$type<Array<Record<string, unknown>>>().notNull(),
  organizationGroups: jsonb('organization_groups').$type<unknown>().notNull().default([]),
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
  destination: text('destination').notNull(),
  collectionId: uuid('collection_id'),
  blueprint: jsonb('blueprint').$type<AssessmentBlueprint>(),
  attempts: integer('attempts').notNull(),
  maxAttempts: integer('max_attempts').notNull(),
  leaseToken: uuid('lease_token'),
  lastError: text('last_error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  approvalStatus: text('approval_status').notNull(),
  submittedBy: uuid('submitted_by'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  approvalNote: text('approval_note'),
  assessmentId: uuid('assessment_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  committedAt: timestamp('committed_at', { withTimezone: true }),
}, (table) => ({
  collectionTenantForeignKey: foreignKey({
    columns: [table.collectionId, table.tenantId],
    foreignColumns: [bankCollections.id, bankCollections.tenantId],
    name: 'migration_runs_collection_tenant_fk',
  }),
  destinationCheck: check(
    'migration_runs_destination_check',
    sql`(${table.destination} = 'Assessment' AND ${table.blueprint} IS NOT NULL AND ${table.collectionId} IS NULL) OR (${table.destination} = 'WorkspaceBank' AND ${table.blueprint} IS NULL AND ${table.assessmentId} IS NULL)`,
  ),
  organizationGroupsCheck: check(
    'migration_runs_organization_groups_check',
    sql`jsonb_typeof(${table.organizationGroups}) = 'array'`,
  ),
  batchTenantForeignKey: foreignKey({
    columns: [table.batchId, table.tenantId],
    foreignColumns: [migrationBatches.id, migrationBatches.tenantId],
    name: 'migration_runs_batch_tenant_fk',
  }).onDelete('cascade'),
  batchPositionUnique: uniqueIndex('migration_runs_batch_position_idx')
    .on(table.batchId, table.batchPosition),
  claimIndex: index('migration_runs_claim_idx')
    .on(table.status, table.createdAt)
    .where(sql`${table.status} = 'queued'`),
  statusCheck: check(
    'migration_runs_status_check',
    sql`${table.status} IN ('queued', 'analyzing', 'analyzed', 'failed', 'committed')`,
  ),
  attemptsCheck: check(
    'migration_runs_attempts_check',
    sql`${table.attempts} >= 0 AND ${table.maxAttempts} >= 1 AND ${table.attempts} <= ${table.maxAttempts}`,
  ),
  leaseStateCheck: check(
    'migration_runs_lease_state_check',
    sql`(${table.status} = 'queued' AND ${table.leaseToken} IS NULL AND ${table.startedAt} IS NULL AND ${table.completedAt} IS NULL) OR (${table.status} = 'analyzing' AND ${table.leaseToken} IS NOT NULL AND ${table.lastError} IS NULL AND ${table.startedAt} IS NOT NULL AND ${table.completedAt} IS NULL) OR (${table.status} IN ('analyzed', 'committed') AND ${table.leaseToken} IS NULL AND ${table.lastError} IS NULL AND ${table.startedAt} IS NULL AND ${table.completedAt} IS NOT NULL) OR (${table.status} = 'failed' AND ${table.leaseToken} IS NULL AND ${table.lastError} IS NOT NULL AND ${table.startedAt} IS NULL AND ${table.completedAt} IS NOT NULL)`,
  ),
  approvalStatusCheck: check(
    'migration_runs_approval_status_check',
    sql`${table.approvalStatus} IN ('draft', 'submitted', 'approved', 'changes_requested')`,
  ),
  approvalStateCheck: check(
    'migration_runs_approval_state_check',
    sql`(${table.approvalStatus} = 'draft' AND ${table.submittedBy} IS NULL AND ${table.submittedAt} IS NULL AND ${table.decidedBy} IS NULL AND ${table.decidedAt} IS NULL AND ${table.approvalNote} IS NULL) OR (${table.approvalStatus} = 'submitted' AND ${table.submittedBy} IS NOT NULL AND ${table.submittedAt} IS NOT NULL AND ${table.decidedBy} IS NULL AND ${table.decidedAt} IS NULL AND ${table.approvalNote} IS NULL) OR (${table.approvalStatus} = 'approved' AND ${table.submittedBy} IS NOT NULL AND ${table.submittedAt} IS NOT NULL AND ${table.decidedBy} IS NOT NULL AND ${table.decidedAt} IS NOT NULL) OR (${table.approvalStatus} = 'changes_requested' AND ${table.submittedBy} IS NOT NULL AND ${table.submittedAt} IS NOT NULL AND ${table.decidedBy} IS NOT NULL AND ${table.decidedAt} IS NOT NULL AND ${table.approvalNote} IS NOT NULL)`,
  ),
  workflowStateCheck: check(
    'migration_runs_workflow_state_check',
    sql`(${table.status} IN ('queued', 'analyzing', 'failed') AND ${table.approvalStatus} = 'draft') OR ${table.status} = 'analyzed' OR (${table.status} = 'committed' AND ${table.approvalStatus} IN ('draft', 'approved'))`,
  ),
  terminalStateCheck: check(
    'migration_runs_terminal_state_check',
    sql`(${table.status} = 'committed' AND (${table.destination} = 'WorkspaceBank' OR ${table.assessmentId} IS NOT NULL) AND ${table.committedAt} IS NOT NULL) OR (${table.status} <> 'committed' AND ${table.assessmentId} IS NULL AND ${table.committedAt} IS NULL)`,
  ),
}));

export const migrationItems = pgTable('migration_items', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => migrationRuns.id, { onDelete: 'cascade' }),
  sourceHref: text('source_href').notNull(),
  sourceIdentifier: text('source_identifier').notNull(),
  title: text('title').notNull(),
  itemType: text('item_type').notNull(),
  position: integer('position').notNull(),
  readiness: text('readiness').notNull(),
  warnings: jsonb('warnings').$type<Array<Record<string, unknown>>>().notNull(),
  sourceXml: text('source_xml').notNull(),
  exactContentIdentity: text('exact_content_identity'),
  importedDraft: jsonb('imported_draft').$type<Record<string, unknown>>().notNull(),
  blueprintTargetId: text('blueprint_target_id'),
  reviewSuggestions: jsonb('review_suggestions').$type<Array<Record<string, unknown>>>().notNull(),
  createdQuestionId: uuid('created_question_id'),
  createdRevision: integer('created_revision'),
  decision: text('decision').notNull(),
  reviewNote: text('review_note'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  evidence: jsonb('evidence').$type<Array<Record<string, unknown>>>().notNull(),
  extractionUncertainties: jsonb('extraction_uncertainties').$type<
    Array<Record<string, unknown>>
  >().notNull(),
  contentHash: text('content_hash').notNull(),
  contextHash: text('context_hash').notNull(),
  acceptedSnapshot: jsonb('accepted_snapshot').$type<Record<string, unknown>>(),
  acceptedSnapshotHash: text('accepted_snapshot_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  readinessCheck: check(
    'migration_items_readiness_check',
    sql`${table.readiness} IN ('ready', 'minor_review', 'major_review', 'blocked')`,
  ),
  exactContentIdentityCheck: check(
    'migration_items_exact_content_identity_check',
    sql`${table.exactContentIdentity} IS NULL OR ${table.exactContentIdentity} ~ '^qti-self-contained-v1:[0-9a-f]{64}$'`,
  ),
  exactContentIndex: index('migration_items_run_exact_content_idx').on(
    table.runId,
    table.exactContentIdentity,
  ),
  decisionCheck: check(
    'migration_items_decision_check',
    sql`${table.decision} IN ('pending', 'accepted', 'rejected')`,
  ),
  contentHashCheck: check(
    'migration_items_content_hash_check',
    sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
  ),
  contextHashCheck: check(
    'migration_items_context_hash_check',
    sql`${table.contextHash} ~ '^[0-9a-f]{64}$'`,
  ),
  acceptedSnapshotHashCheck: check(
    'migration_items_accepted_snapshot_hash_check',
    sql`${table.acceptedSnapshotHash} IS NULL OR ${table.acceptedSnapshotHash} ~ '^[0-9a-f]{64}$'`,
  ),
  reviewStateCheck: check(
    'migration_items_review_state_check',
    sql`(${table.decision} = 'pending' AND ${table.reviewedBy} IS NULL AND ${table.reviewedAt} IS NULL AND ${table.acceptedSnapshot} IS NULL AND ${table.acceptedSnapshotHash} IS NULL) OR (${table.decision} = 'accepted' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.acceptedSnapshot} IS NOT NULL AND ${table.acceptedSnapshotHash} IS NOT NULL) OR (${table.decision} = 'rejected' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.acceptedSnapshot} IS NULL AND ${table.acceptedSnapshotHash} IS NULL)`,
  ),
  createdQuestionCheck: check(
    'migration_items_created_question_check',
    sql`(${table.createdQuestionId} IS NULL AND ${table.createdRevision} IS NULL) OR (${table.createdQuestionId} IS NOT NULL AND ${table.createdRevision} IS NOT NULL)`,
  ),
}));

export const migrationAssets = pgTable(
  'migration_assets',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id').notNull().references(() => migrationRuns.id, { onDelete: 'cascade' }),
    sourcePath: text('source_path').notNull(),
    name: text('name').notNull(),
    mimeType: text('mime_type'),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    dataBase64: text('data_base64').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    canonicalPathUnique: uniqueIndex('migration_assets_run_canonical_path_idx')
      .on(table.runId, sql`lower(${table.sourcePath})`),
  }),
);

export const conversionSourceArtifacts = pgTable('conversion_source_artifacts', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => migrationRuns.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull(),
  document: jsonb('document').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  kindDocumentCheck: check(
    'conversion_source_artifacts_kind_document_check',
    sql`(${table.kind} = 'original' AND ${table.document} IS NULL) OR (${table.kind} = 'normalized' AND ${table.document} IS NOT NULL)`,
  ),
}));

/** Frozen bank commit selection and durable progress; one job per reviewed run. */
export const migrationCommitJobs = pgTable('migration_commit_jobs', {
  id: uuid('id').primaryKey().references(() => migrationRuns.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  state: text('state').notNull(),
  total: integer('total').notNull(),
  completed: integer('completed').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  stateCheck: check(
    'migration_commit_jobs_state_check',
    sql`${table.state} in ('queued','running','complete','failed')`,
  ),
  progressCheck: check(
    'migration_commit_jobs_progress_check',
    sql`${table.completed} >= 0 and ${table.completed} <= ${table.total} and ${table.total} > 0`,
  ),
}));
export const migrationCommitSelections = pgTable('migration_commit_selections', {
  itemId: uuid('item_id').primaryKey().references(() => migrationItems.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => migrationCommitJobs.id, { onDelete: 'cascade' }),
  snapshotHash: text('snapshot_hash').notNull(),
  position: integer('position').notNull(),
});

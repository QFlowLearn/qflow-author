import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
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
import { tenants, users } from './principal_schema.ts';

export const assessments = pgTable('assessments', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  createdBy: uuid('created_by').notNull(),
  brief: text('brief'),
  gradeLevel: text('grade_level'),
  targetCount: integer('target_count').default(0),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  blueprint: jsonb('blueprint').$type<AssessmentBlueprint>().notNull(),
  attachmentId: text('attachment_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const assessmentParts = pgTable('assessment_parts', {
  id: uuid('id').primaryKey(),
  assessmentId: uuid('assessment_id').notNull(),
  title: text('title').notNull(),
  position: integer('position').notNull(),
  options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const assessmentPlacements = pgTable('assessment_placements', {
  id: uuid('id').primaryKey(),
  assessmentPartId: uuid('assessment_part_id').notNull(),
  questionId: uuid('question_id'),
  content: jsonb('content').$type<unknown>(),
  pinnedRevision: integer('pinned_revision'),
  blueprintTargetId: text('blueprint_target_id'),
  fixed: boolean('fixed').notNull().default(false),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  contentOwnerCheck: check(
    'assessment_placements_content_owner_check',
    sql`((${table.questionId} IS NOT NULL AND ${table.content} IS NULL)
  OR (
    ${table.questionId} IS NULL AND ${table.content} IS NOT NULL
    AND ${table.pinnedRevision} IS NULL AND ${table.blueprintTargetId} IS NULL AND ${table.fixed} = true
    AND jsonb_typeof(${table.content}) = 'object'
    AND (
      (
        ${table.content}->>'kind' = 'text'
        AND jsonb_typeof(${table.content}->'text') = 'string'
        AND length(${table.content}->>'text') BETWEEN 1 AND 100000
        AND ${table.content}->>'text' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'text', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND ${table.content} - 'kind' - 'text' = '{}'::jsonb
      )
      OR
      (
        ${table.content}->>'kind' = 'image'
        AND jsonb_typeof(${table.content}->'src') = 'string'
        AND length(${table.content}->>'src') BETWEEN 1 AND 2048
        AND ${table.content}->>'src' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'src', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND jsonb_typeof(${table.content}->'alt') = 'string'
        AND length(${table.content}->>'alt') BETWEEN 1 AND 2000
        AND ${table.content}->>'alt' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'alt', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND jsonb_typeof(${table.content}->'longDescription') = 'string'
        AND length(${table.content}->>'longDescription') BETWEEN 0 AND 100000
        AND ${table.content}->>'longDescription' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND (length(${table.content}->>'longDescription') = 0 OR length(btrim(${table.content}->>'longDescription', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0)
        AND ${table.content}->>'src' ~ '/uploads/[0-9a-fA-F-]{36}$'
        AND ${table.content} - 'kind' - 'src' - 'alt' - 'longDescription' = '{}'::jsonb
      )
      OR
      (
        ${table.content}->>'kind' = 'video'
        AND jsonb_typeof(${table.content}->'src') = 'string'
        AND length(${table.content}->>'src') BETWEEN 1 AND 2048
        AND ${table.content}->>'src' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'src', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND jsonb_typeof(${table.content}->'mimeType') = 'string'
        AND length(${table.content}->>'mimeType') BETWEEN 1 AND 100
        AND ${table.content}->>'mimeType' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'mimeType', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND jsonb_typeof(${table.content}->'title') = 'string'
        AND length(${table.content}->>'title') BETWEEN 1 AND 2000
        AND ${table.content}->>'title' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'title', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND jsonb_typeof(${table.content}->'captionSrc') = 'string'
        AND length(${table.content}->>'captionSrc') BETWEEN 1 AND 2048
        AND ${table.content}->>'captionSrc' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'captionSrc', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND jsonb_typeof(${table.content}->'captionLanguage') = 'string'
        AND length(${table.content}->>'captionLanguage') BETWEEN 1 AND 100
        AND ${table.content}->>'captionLanguage' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'captionLanguage', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND jsonb_typeof(${table.content}->'transcript') = 'string'
        AND length(${table.content}->>'transcript') BETWEEN 1 AND 100000
        AND ${table.content}->>'transcript' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'transcript', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND ${table.content}->>'src' ~ '/uploads/[0-9a-fA-F-]{36}$'
        AND ${table.content}->>'captionSrc' ~ '/uploads/[0-9a-fA-F-]{36}$'
        AND ${table.content}->>'mimeType' IN ('video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-m4v')
        AND ${table.content}->>'captionLanguage' ~ '^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$'
        AND ${table.content} - 'kind' - 'src' - 'mimeType' - 'title' - 'captionSrc' - 'captionLanguage' - 'transcript' = '{}'::jsonb
      )
      OR
      (
        ${table.content}->>'kind' = 'video-link'
        AND jsonb_typeof(${table.content}->'url') = 'string'
        AND length(${table.content}->>'url') BETWEEN 1 AND 2048
        AND ${table.content}->>'url' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'url', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND jsonb_typeof(${table.content}->'title') = 'string'
        AND length(${table.content}->>'title') BETWEEN 1 AND 2000
        AND ${table.content}->>'title' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'title', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND jsonb_typeof(${table.content}->'transcript') = 'string'
        AND length(${table.content}->>'transcript') BETWEEN 1 AND 100000
        AND ${table.content}->>'transcript' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'transcript', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND jsonb_typeof(${table.content}->'networkNotice') = 'string'
        AND length(${table.content}->>'networkNotice') BETWEEN 1 AND 2000
        AND ${table.content}->>'networkNotice' !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\uFFFE\\uFFFF]'
        AND length(btrim(${table.content}->>'networkNotice', E' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff')) > 0
        AND ${table.content}->>'url' ~* '^https://((www\\.)?(youtube\\.com|vimeo\\.com)|youtu\\.be)/[^[:space:]]*$'
        AND ${table.content} - 'kind' - 'url' - 'title' - 'transcript' - 'networkNotice' = '{}'::jsonb
      )
    )
  )) IS TRUE`,
  ),
}));

/** Durable recovery of one removed placement; part/question deletion leaves an unavailable receipt. */
export const assessmentPlacementRemovals = pgTable('assessment_placement_removals', {
  id: uuid('id').primaryKey(),
  removalSequence: bigint('removal_sequence', { mode: 'bigint' }).generatedAlwaysAsIdentity()
    .notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, {
    onDelete: 'cascade',
  }),
  removedBy: uuid('removed_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  placementId: uuid('placement_id').notNull(),
  partId: uuid('part_id').notNull(),
  questionId: uuid('question_id').notNull(),
  pinnedRevision: integer('pinned_revision'),
  blueprintTargetId: text('blueprint_target_id'),
  fixed: boolean('fixed').notNull().default(false),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  expectedRevision: integer('expected_revision').notNull(),
  remainingOrder: jsonb('remaining_order').$type<unknown>().notNull(),
  placementCreatedAt: timestamp('placement_created_at', { withTimezone: true }),
  placementUpdatedAt: timestamp('placement_updated_at', { withTimezone: true }),
  removedAt: timestamp('removed_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  restoredAt: timestamp('restored_at', { withTimezone: true }),
});

/** One validated adaptive recipe owns the generated membership of an assessment draft. */
export const assessmentAdaptivePlans = pgTable('assessment_adaptive_plans', {
  assessmentId: uuid('assessment_id').primaryKey().references(() => assessments.id, {
    onDelete: 'cascade',
  }),
  document: jsonb('document').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const assessmentExportReceipts = pgTable(
  'assessment_export_receipts',
  {
    id: text('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    assessmentId: uuid('assessment_id').notNull(),
    createdBy: uuid('created_by').notNull(),
    authorizedBy: uuid('authorized_by').notNull(),
    preflightId: text('preflight_id').notNull(),
    targetId: text('target_id').notNull(),
    scoringSelection: text('scoring_selection').notNull(),
    interactionSelection: text('interaction_selection').notNull(),
    acknowledgementToken: text('acknowledgement_token'),
    schema: text('schema').notNull(),
    receipt: text('receipt').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    tenantAssessmentCreatedIndex: index(
      'assessment_export_receipts_tenant_assessment_created_idx',
    ).on(table.tenantId, table.assessmentId, table.createdAt),
    receiptIdCheck: check(
      'assessment_export_receipts_id_check',
      sql`${table.id} ~ '^[0-9a-f]{64}$'`,
    ),
    preflightIdCheck: check(
      'assessment_export_receipts_preflight_id_check',
      sql`${table.preflightId} ~ '^[0-9a-f]{64}$'`,
    ),
    acknowledgementTokenCheck: check(
      'assessment_export_receipts_acknowledgement_token_check',
      sql`${table.acknowledgementToken} IS NULL OR ${table.acknowledgementToken} ~ '^[0-9a-f]{64}$'`,
    ),
    scoringSelectionCheck: check(
      'assessment_export_receipts_scoring_selection_check',
      sql`${table.scoringSelection} IN ('automatic', 'manual-accepted')`,
    ),
    interactionSelectionCheck: check(
      'assessment_export_receipts_interaction_selection_check',
      sql`${table.interactionSelection} IN ('preserve', 'fallback-accepted')`,
    ),
    schemaCheck: check(
      'assessment_export_receipts_schema_check',
      sql`${table.schema} = 'qflow.export-receipt.v1'`,
    ),
    receiptIdentityCheck: check(
      'assessment_export_receipts_document_check',
      sql`(${table.receipt}::jsonb ->> 'receiptId') = ${table.id} AND (${table.receipt}::jsonb ->> 'schema') = ${table.schema} AND (${table.receipt}::jsonb ->> 'authorizedBy') = ${table.authorizedBy}::text AND (${table.receipt}::jsonb ->> 'preflightId') = ${table.preflightId} AND (${table.receipt}::jsonb -> 'assessment' ->> 'id') = ${table.assessmentId}::text AND (${table.receipt}::jsonb -> 'target' ->> 'destinationId') = ${table.targetId} AND ((${table.scoringSelection} = 'automatic' AND (${table.receipt}::jsonb -> 'requirements' -> 'scoring' ->> '_tag') = 'AutomaticScoringRequired') OR (${table.scoringSelection} = 'manual-accepted' AND (${table.receipt}::jsonb -> 'requirements' -> 'scoring' ->> '_tag') = 'ManualScoringAccepted')) AND ((${table.interactionSelection} = 'preserve' AND (${table.receipt}::jsonb -> 'requirements' -> 'interaction' ->> '_tag') = 'BehaviorMustBePreserved') OR (${table.interactionSelection} = 'fallback-accepted' AND (${table.receipt}::jsonb -> 'requirements' -> 'interaction' ->> '_tag') = 'DiagnosedFallbackAccepted')) AND ((${table.acknowledgementToken} IS NULL AND jsonb_array_length(${table.receipt}::jsonb -> 'acknowledgements') = 0) OR (${table.acknowledgementToken} IS NOT NULL AND (${table.receipt}::jsonb -> 'acknowledgements' -> 0 ->> 'token') = ${table.acknowledgementToken}))`,
    ),
  }),
);

export const assessmentDeliveryPublishAttempts = pgTable(
  'assessment_delivery_publish_attempts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, {
      onDelete: 'cascade',
    }),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    exportReceiptId: text('export_receipt_id').notNull().references(
      () => assessmentExportReceipts.id,
    ),
    preflightId: text('preflight_id').notNull(),
    request: jsonb('request').$type<Record<string, unknown>>().notNull(),
    phase: text('phase').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    response: jsonb('response').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => ({
    preflightUnique: uniqueIndex(
      'delivery_publish_attempts_preflight_unique_idx',
    ).on(table.tenantId, table.assessmentId, table.preflightId),
    tenantAssessmentCreatedIndex: index(
      'delivery_publish_attempts_tenant_assessment_created_idx',
    ).on(table.tenantId, table.assessmentId, table.createdAt),
    phaseCheck: check(
      'assessment_delivery_publish_attempts_phase_check',
      sql`${table.phase} IN ('prepared', 'publishing', 'retryable', 'published')`,
    ),
    preflightIdCheck: check(
      'assessment_delivery_publish_attempts_preflight_id_check',
      sql`${table.preflightId} ~ '^[0-9a-f]{64}$'`,
    ),
    requestCheck: check(
      'assessment_delivery_publish_attempts_request_check',
      sql`jsonb_typeof(${table.request}) = 'object' AND ${table.request} ? 'publishId' AND ${table.request} ? 'qflowTenantId' AND ${table.request} ? 'qflowAssessmentId' AND ${table.request} ? 'packageUrl' AND (${table.request} ->> 'publishId') = 'qflow-' || ${table.id}::text AND (${table.request} ->> 'qflowTenantId') = ${table.tenantId}::text AND (${table.request} ->> 'qflowAssessmentId') = ${table.assessmentId}::text AND char_length(${table.request} ->> 'packageUrl') > 0`,
    ),
    stateCheck: check(
      'assessment_delivery_publish_attempts_state_check',
      sql`(${table.phase} = 'prepared' AND ${table.attemptCount} = 0 AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL AND ${table.failureCode} IS NULL AND ${table.failureMessage} IS NULL AND ${table.response} IS NULL AND ${table.publishedAt} IS NULL) OR (${table.phase} = 'publishing' AND ${table.attemptCount} >= 1 AND ${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL AND ${table.failureCode} IS NULL AND ${table.failureMessage} IS NULL AND ${table.response} IS NULL AND ${table.publishedAt} IS NULL) OR (${table.phase} = 'retryable' AND ${table.attemptCount} >= 1 AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL AND ${table.failureCode} IS NOT NULL AND ${table.failureMessage} IS NOT NULL AND char_length(${table.failureCode}) BETWEEN 1 AND 120 AND char_length(${table.failureMessage}) BETWEEN 1 AND 1000 AND ${table.response} IS NULL AND ${table.publishedAt} IS NULL) OR (${table.phase} = 'published' AND ${table.attemptCount} >= 1 AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL AND ${table.failureCode} IS NULL AND ${table.failureMessage} IS NULL AND ${table.response} IS NOT NULL AND jsonb_typeof(${table.response}) = 'object' AND ${table.response} ? 'publishId' AND ${table.response} ? 'status' AND (${table.response} ->> 'publishId') = (${table.request} ->> 'publishId') AND (${table.response} ->> 'status') = 'published' AND ${table.publishedAt} IS NOT NULL)`,
    ),
  }),
);

export const assessmentCanvasPublishAttempts = pgTable(
  'assessment_canvas_publish_attempts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, {
      onDelete: 'cascade',
    }),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    connectionId: uuid('connection_id').notNull(),
    connectionName: text('connection_name').notNull(),
    connectionBaseUrl: text('connection_base_url').notNull(),
    targetId: text('target_id').notNull(),
    destinationKind: text('destination_kind').notNull(),
    courseId: text('course_id').notNull(),
    questionBankId: text('question_bank_id'),
    questionBankName: text('question_bank_name'),
    requestFingerprint: text('request_fingerprint').notNull(),
    exportReceiptId: text('export_receipt_id').notNull().references(
      () => assessmentExportReceipts.id,
    ),
    artifactStorageKey: text('artifact_storage_key').notNull(),
    artifactFilename: text('artifact_filename').notNull(),
    artifactMediaType: text('artifact_media_type').notNull(),
    artifactSha256: text('artifact_sha256').notNull(),
    artifactByteLength: integer('artifact_byte_length').notNull(),
    phase: text('phase').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    remoteCreationStartedAt: timestamp('remote_creation_started_at', { withTimezone: true }),
    remoteMigrationId: text('remote_migration_id'),
    remoteProgressUrl: text('remote_progress_url'),
    remoteWorkflowState: text('remote_workflow_state'),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    remoteIdentityResolution: text('remote_identity_resolution'),
    remoteIdentityResolvedBy: uuid('remote_identity_resolved_by').references(() => users.id),
    remoteIdentityResolvedAt: timestamp('remote_identity_resolved_at', { withTimezone: true }),
    receiptSchema: text('receipt_schema'),
    receipt: text('receipt'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => ({
    tenantAssessmentCreatedIndex: index(
      'canvas_publish_attempts_tenant_assessment_created_idx',
    ).on(table.tenantId, table.assessmentId, table.createdAt),
    tenantConnectionCreatedIndex: index(
      'canvas_publish_attempts_tenant_connection_created_idx',
    ).on(table.tenantId, table.connectionId, table.createdAt),
    recoveryIndex: index(
      'canvas_publish_attempts_recovery_idx',
    ).on(
      table.tenantId,
      table.assessmentId,
      table.targetId,
      table.phase,
      table.createdAt,
      table.id,
    ),
    connectionCheck: check(
      'assessment_canvas_publish_attempts_connection_check',
      sql`char_length(${table.connectionName}) > 0 AND ${table.connectionBaseUrl} ~ '^https://[^/]+$'`,
    ),
    targetCheck: check(
      'assessment_canvas_publish_attempts_target_check',
      sql`${table.targetId} IN ('canvas-classic', 'canvas-new-quizzes')`,
    ),
    destinationCheck: check(
      'assessment_canvas_publish_attempts_destination_check',
      sql`(
        char_length(${table.courseId}) BETWEEN 1 AND 255 AND ${table.courseId} = btrim(${table.courseId}) AND ${table.courseId} !~ '[[:cntrl:]]' AND (
          (${table.destinationKind} = 'course' AND ${table.questionBankId} IS NULL AND ${table.questionBankName} IS NULL)
          OR
          (${table.destinationKind} = 'question-bank' AND ${table.targetId} = 'canvas-classic' AND (
            (${table.questionBankId} ~ '^[0-9]{1,30}$' AND ${table.questionBankName} IS NULL)
            OR
            (${table.questionBankId} IS NULL AND char_length(${table.questionBankName}) BETWEEN 1 AND 255 AND ${table.questionBankName} = btrim(${table.questionBankName}) AND ${table.questionBankName} !~ '[[:cntrl:]]')
          ))
        )
      )`,
    ),
    fingerprintCheck: check(
      'assessment_canvas_publish_attempts_fingerprint_check',
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    artifactCheck: check(
      'assessment_canvas_publish_attempts_artifact_check',
      sql`${table.artifactSha256} ~ '^[0-9a-f]{64}$' AND ${table.artifactByteLength} >= 0 AND char_length(${table.artifactStorageKey}) > 0 AND char_length(${table.artifactFilename}) > 0 AND char_length(${table.artifactMediaType}) > 0`,
    ),
    phaseCheck: check(
      'assessment_canvas_publish_attempts_phase_check',
      sql`${table.phase} IN ('prepared', 'claiming-create', 'creating', 'uploading', 'observing', 'processing', 'retry-create', 'retry-upload', 'retry-observe', 'remote-identity-unknown', 'remote-identity-resolved', 'published', 'failed')`,
    ),
    attemptCountCheck: check(
      'assessment_canvas_publish_attempts_attempt_count_check',
      sql`(${table.phase} = 'prepared' AND ${table.attemptCount} = 0) OR (${table.phase} <> 'prepared' AND ${table.attemptCount} >= 1)`,
    ),
    leaseCheck: check(
      'assessment_canvas_publish_attempts_lease_check',
      sql`(
        (${table.phase} IN ('claiming-create', 'creating', 'uploading', 'observing') AND ${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)
        OR
        (${table.phase} NOT IN ('claiming-create', 'creating', 'uploading', 'observing') AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL)
      )`,
    ),
    remoteIdentityCheck: check(
      'assessment_canvas_publish_attempts_remote_identity_check',
      sql`(
        (${table.remoteMigrationId} IS NULL AND ${table.remoteProgressUrl} IS NULL)
        OR
        (${table.remoteMigrationId} IS NOT NULL AND ${table.remoteProgressUrl} IS NOT NULL)
      ) AND (${table.remoteMigrationId} IS NULL OR ${table.remoteCreationStartedAt} IS NOT NULL)
      AND (${table.remoteMigrationId} IS NULL OR char_length(${table.remoteMigrationId}) > 0)
      AND (${table.remoteProgressUrl} IS NULL OR char_length(${table.remoteProgressUrl}) > 0)
      AND (${table.phase} NOT IN ('uploading', 'observing', 'processing', 'retry-upload', 'retry-observe', 'published') OR ${table.remoteMigrationId} IS NOT NULL)
      AND (${table.phase} NOT IN ('prepared', 'claiming-create', 'creating', 'retry-create', 'remote-identity-unknown', 'remote-identity-resolved') OR ${table.remoteMigrationId} IS NULL)
      AND (${table.phase} NOT IN ('creating', 'uploading', 'observing', 'processing', 'retry-upload', 'retry-observe', 'remote-identity-unknown', 'remote-identity-resolved', 'published') OR ${table.remoteCreationStartedAt} IS NOT NULL)
      AND (${table.phase} NOT IN ('prepared', 'claiming-create', 'retry-create') OR ${table.remoteCreationStartedAt} IS NULL)`,
    ),
    failureCheck: check(
      'assessment_canvas_publish_attempts_failure_check',
      sql`(
        (${table.phase} IN ('retry-create', 'retry-upload', 'retry-observe', 'remote-identity-unknown', 'remote-identity-resolved', 'failed') AND ${table.failureCode} IS NOT NULL AND ${table.failureMessage} IS NOT NULL AND char_length(${table.failureCode}) > 0 AND char_length(${table.failureMessage}) > 0)
        OR
        (${table.phase} NOT IN ('retry-create', 'retry-upload', 'retry-observe', 'remote-identity-unknown', 'remote-identity-resolved', 'failed') AND ${table.failureCode} IS NULL AND ${table.failureMessage} IS NULL)
      )`,
    ),
    remoteIdentityResolutionCheck: check(
      'canvas_publish_remote_identity_resolution_check',
      sql`(
        (${table.phase} = 'remote-identity-resolved' AND ${table.remoteIdentityResolution} IN ('import-found', 'import-not-found') AND ${table.remoteIdentityResolvedBy} IS NOT NULL AND ${table.remoteIdentityResolvedAt} IS NOT NULL)
        OR
        (${table.phase} <> 'remote-identity-resolved' AND ${table.remoteIdentityResolution} IS NULL AND ${table.remoteIdentityResolvedBy} IS NULL AND ${table.remoteIdentityResolvedAt} IS NULL)
      )`,
    ),
    receiptCheck: check(
      'assessment_canvas_publish_attempts_receipt_check',
      sql`(
        (${table.phase} = 'published' AND ${table.publishedAt} IS NOT NULL AND ${table.receiptSchema} = 'qflow.canvas-publish-receipt.v1' AND ${table.receipt} IS NOT NULL AND (${table.receipt}::jsonb ->> 'schema') = ${table.receiptSchema} AND (${table.receipt}::jsonb ->> 'publishId') = ${table.id}::text AND (${table.receipt}::jsonb ->> 'exportReceiptId') = ${table.exportReceiptId} AND (${table.receipt}::jsonb ->> 'publishedBy') = ${table.createdBy}::text AND (${table.receipt}::jsonb -> 'connection' ->> 'id') = ${table.connectionId}::text AND (${table.receipt}::jsonb -> 'connection' ->> 'name') = ${table.connectionName} AND (${table.receipt}::jsonb -> 'connection' ->> 'baseUrl') = ${table.connectionBaseUrl} AND (${table.receipt}::jsonb ->> 'targetId') = ${table.targetId} AND (${table.receipt}::jsonb -> 'artifact' ->> 'sha256') = ${table.artifactSha256} AND (${table.receipt}::jsonb -> 'remote' ->> 'contentMigrationId') = ${table.remoteMigrationId})
        OR
        (${table.phase} <> 'published' AND ${table.publishedAt} IS NULL AND ${table.receiptSchema} IS NULL AND ${table.receipt} IS NULL)
      )`,
    ),
  }),
);

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

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  stableKey: text('stable_key').notNull(),
  title: text('title').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  ownerUserId: uuid('owner_user_id').notNull(),
  lifecycleState: text('lifecycle_state').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: uuid('archived_by'),
  latestRevisionId: uuid('latest_revision_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  lifecycleStateCheck: check(
    'questions_lifecycle_state_check',
    sql`${table.lifecycleState} IN ('active', 'archived')`,
  ),
  archiveStateCheck: check(
    'questions_archive_state_check',
    sql`(
      (${table.lifecycleState} = 'active' AND ${table.archivedAt} IS NULL AND ${table.archivedBy} IS NULL)
      OR
      (${table.lifecycleState} = 'archived' AND ${table.archivedAt} IS NOT NULL AND ${table.archivedBy} IS NOT NULL)
    )`,
  ),
  tenantLifecycleUpdatedIndex: index('questions_tenant_lifecycle_updated_idx').on(
    table.tenantId,
    table.lifecycleState,
    table.updatedAt,
  ),
  tagsIndex: index('questions_tags_gin_idx').using('gin', table.tags),
  identityTenantUnique: uniqueIndex('questions_id_tenant_idx').on(table.id, table.tenantId),
}));

export const questionRevisions = pgTable(
  'question_revisions',
  {
    id: uuid('id').primaryKey(),
    questionId: uuid('question_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    draftState: text('draft_state').notNull(),
    revision: integer('revision').notNull(),
    body: jsonb('body').$type<Record<string, unknown>>().notNull().default({}),
    rubric: jsonb('rubric').$type<Record<string, unknown> | null>().default(null),
    scoring: jsonb('scoring').$type<Record<string, unknown> | null>().default(null),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>().default(null),
    reviewSuggestions: jsonb('review_suggestions').$type<Array<Record<string, unknown>>>()
      .notNull(),
    provenance: jsonb('provenance').$type<Record<string, unknown>>().notNull(),
    contentHash: text('content_hash').notNull(),
    searchText: text('search_text').notNull(),
    compatibility: jsonb('compatibility').$type<Array<Record<string, unknown>>>().notNull(),
    qtiXml: text('qti_xml').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => ({
    draftState: check(
      'question_revisions_draft_state_check',
      sql`${table.draftState} IN ('draft', 'ready', 'published')`,
    ),
    publicationTimestamp: check(
      'question_revisions_publication_timestamp_check',
      sql`(
        (${table.draftState} = 'published' AND ${table.publishedAt} IS NOT NULL)
        OR (${table.draftState} IN ('draft', 'ready') AND ${table.publishedAt} IS NULL)
      )`,
    ),
    contentHashCheck: check(
      'question_revisions_content_hash_check',
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
    compatibilityCheck: check(
      'question_revisions_compatibility_check',
      sql`jsonb_typeof(${table.compatibility}) = 'array'`,
    ),
    tenantContentHashIndex: index('question_revisions_tenant_content_hash_idx').on(
      table.tenantId,
      table.contentHash,
    ),
    searchTextIndex: index('question_revisions_search_text_trgm_idx').using(
      'gin',
      sql`${table.searchText} gin_trgm_ops`,
    ),
    bodyIndex: index('question_revisions_body_gin_idx').using('gin', table.body),
    compatibilityIndex: index('question_revisions_compatibility_gin_idx').using(
      'gin',
      table.compatibility,
    ),
    identityQuestionTenantUnique: uniqueIndex('question_revisions_identity_tenant_idx').on(
      table.id,
      table.questionId,
      table.tenantId,
    ),
    identityTenantUnique: uniqueIndex('question_revisions_id_tenant_idx').on(
      table.id,
      table.tenantId,
    ),
  }),
);

export const questionReviewRequests = pgTable(
  'question_review_requests',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    questionId: uuid('question_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    requestedBy: uuid('requested_by').notNull(),
    reviewerUserId: uuid('reviewer_user_id').notNull(),
    state: text('state').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by'),
    decisionNote: text('decision_note'),
    changeReason: text('change_reason'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    changeReasonCheck: check(
      'question_review_change_reason_check',
      sql`${table.changeReason} IS NULL OR length(btrim(${table.changeReason})) BETWEEN 1 AND 4000`,
    ),
    revisionUnique: uniqueIndex('question_review_requests_revision_id_key').on(table.revisionId),
    identityTenantUnique: uniqueIndex('question_review_requests_id_tenant_key').on(
      table.id,
      table.tenantId,
    ),
    questionTenantForeignKey: foreignKey({
      columns: [table.questionId, table.tenantId],
      foreignColumns: [questions.id, questions.tenantId],
      name: 'question_review_requests_question_tenant_fk',
    }),
    revisionQuestionTenantForeignKey: foreignKey({
      columns: [table.revisionId, table.questionId, table.tenantId],
      foreignColumns: [
        questionRevisions.id,
        questionRevisions.questionId,
        questionRevisions.tenantId,
      ],
      name: 'question_review_requests_revision_question_tenant_fk',
    }),
    stateCheck: check(
      'question_review_requests_state_check',
      sql`${table.state} IN ('open', 'approved', 'changes_requested')`,
    ),
    decisionCheck: check(
      'question_review_requests_decision_check',
      sql`(
        (${table.state} = 'open' AND ${table.decidedAt} IS NULL AND ${table.decidedBy} IS NULL AND ${table.decisionNote} IS NULL)
        OR
        (${table.state} = 'approved' AND ${table.decidedAt} IS NOT NULL AND ${table.decidedBy} IS NOT NULL)
        OR
        (${table.state} = 'changes_requested' AND ${table.decidedAt} IS NOT NULL AND ${table.decidedBy} IS NOT NULL AND ${table.decisionNote} IS NOT NULL)
      )`,
    ),
    decisionNoteCheck: check(
      'question_review_requests_decision_note_check',
      sql`${table.decisionNote} IS NULL OR char_length(btrim(${table.decisionNote})) BETWEEN 1 AND 4000`,
    ),
    tenantQuestionIndex: index('question_review_requests_tenant_question_idx').on(
      table.tenantId,
      table.questionId,
      table.requestedAt,
    ),
    tenantReviewerStateIndex: index('question_review_requests_tenant_reviewer_state_idx').on(
      table.tenantId,
      table.reviewerUserId,
      table.state,
    ),
  }),
);

export const questionReviewComments = pgTable(
  'question_review_comments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    reviewRequestId: uuid('review_request_id').notNull(),
    authorUserId: uuid('author_user_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bodyCheck: check(
      'question_review_comments_body_check',
      sql`char_length(btrim(${table.body})) BETWEEN 1 AND 4000`,
    ),
    requestCreatedIndex: index('question_review_comments_request_created_idx').on(
      table.tenantId,
      table.reviewRequestId,
      table.createdAt,
      table.id,
    ),
    requestTenantForeignKey: foreignKey({
      columns: [table.reviewRequestId, table.tenantId],
      foreignColumns: [questionReviewRequests.id, questionReviewRequests.tenantId],
      name: 'question_review_comments_request_tenant_fk',
    }),
  }),
);

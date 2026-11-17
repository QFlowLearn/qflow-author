import { sql } from 'drizzle-orm';
import { bankCollections } from './bank_schema.ts';
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { questionRevisions, questions } from './question_schema.ts';

export const draftSessions = pgTable('draft_sessions', {
  id: uuid('id').primaryKey(),
  kind: text('kind').notNull(),
  questionRevisionId: uuid('question_revision_id'),
  collectionId: uuid('collection_id'),
  publishedQuestionId: uuid('published_question_id'),
  tenantId: uuid('tenant_id').notNull(),
  authorId: uuid('author_id').notNull(),
  clientState: jsonb('client_state').$type<Record<string, unknown>>().notNull().default({}),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }).defaultNow(),
}, (table) => ({
  bindingCheck: check(
    'draft_sessions_binding_check',
    sql`(${table.kind} = 'Revision' AND ${table.questionRevisionId} IS NOT NULL AND ${table.collectionId} IS NULL AND ${table.publishedQuestionId} IS NULL) OR (${table.kind} = 'Bank' AND ${table.questionRevisionId} IS NULL)`,
  ),
  collectionTenantForeignKey: foreignKey({
    columns: [table.collectionId, table.tenantId],
    foreignColumns: [bankCollections.id, bankCollections.tenantId],
    name: 'draft_sessions_collection_tenant_fk',
  }),
  publishedQuestionTenantForeignKey: foreignKey({
    columns: [table.publishedQuestionId, table.tenantId],
    foreignColumns: [questions.id, questions.tenantId],
    name: 'draft_sessions_published_question_tenant_fk',
  }),
  authorRevisionUnique: uniqueIndex('draft_sessions_author_revision_idx').on(
    table.tenantId,
    table.authorId,
    table.questionRevisionId,
  ),
  revisionTenantForeignKey: foreignKey({
    columns: [table.questionRevisionId, table.tenantId],
    foreignColumns: [questionRevisions.id, questionRevisions.tenantId],
    name: 'draft_sessions_question_revision_tenant_fk',
  }),
}));

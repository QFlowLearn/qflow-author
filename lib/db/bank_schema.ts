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
import { questions } from './question_schema.ts';

/** Flat, workspace-visible collections referencing the existing question pool. */
export const bankCollections = pgTable('bank_collections', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  description: text('description').notNull(),
  position: integer('position').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  identityTenant: uniqueIndex('bank_collections_id_tenant_idx').on(t.id, t.tenantId),
  ordering: index('bank_collections_tenant_position_idx').on(t.tenantId, t.position, t.id),
  nameCheck: check(
    'bank_collections_name_check',
    sql`char_length(btrim(${t.name})) BETWEEN 1 AND 160`,
  ),
  descriptionCheck: check(
    'bank_collections_description_check',
    sql`char_length(${t.description}) <= 4000`,
  ),
  positionCheck: check('bank_collections_position_check', sql`${t.position} >= 0`),
}));

/** Filing never copies or deletes questions; composite references enforce workspace ownership. */
export const bankCollectionItems = pgTable('bank_collection_items', {
  tenantId: uuid('tenant_id').notNull(),
  collectionId: uuid('collection_id').notNull(),
  questionId: uuid('question_id').notNull(),
  position: integer('position').notNull(),
}, (t) => ({
  identity: primaryKey({ columns: [t.collectionId, t.questionId] }),
  collectionTenant: foreignKey({
    columns: [t.collectionId, t.tenantId],
    foreignColumns: [bankCollections.id, bankCollections.tenantId],
  }),
  questionTenant: foreignKey({
    columns: [t.questionId, t.tenantId],
    foreignColumns: [questions.id, questions.tenantId],
  }),
  question: index('bank_collection_items_question_idx').on(t.tenantId, t.questionId),
  ordering: index('bank_collection_items_position_idx').on(
    t.collectionId,
    t.position,
    t.questionId,
  ),
  positionCheck: check('bank_collection_items_position_check', sql`${t.position} >= 0`),
}));

/** Immutable mutation receipts retain attribution after membership removal and fence retries. */
export const editorialEvents = pgTable('editorial_events', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  operationId: uuid('operation_id').notNull(),
  actorUserId: uuid('actor_user_id').notNull(),
  actorLabel: text('actor_label').notNull(),
  action: text('action').notNull(),
  collectionId: uuid('collection_id').notNull(),
  command: jsonb('command').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  identity: primaryKey({ columns: [t.tenantId, t.operationId] }),
  collectionTenant: foreignKey({
    columns: [t.collectionId, t.tenantId],
    foreignColumns: [bankCollections.id, bankCollections.tenantId],
  }),
  history: index('editorial_events_collection_idx').on(t.tenantId, t.collectionId, t.createdAt),
  actionCheck: check(
    'editorial_events_action_check',
    sql`${t.action} IN ('Create', 'Update', 'Archive', 'Restore', 'AddItems', 'RemoveItems', 'ReorderItems')`,
  ),
  commandCheck: check('editorial_events_command_check', sql`jsonb_typeof(${t.command}) = 'object'`),
}));

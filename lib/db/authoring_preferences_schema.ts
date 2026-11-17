import { jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { assessments } from './assessment_schema.ts';
import { tenants, users } from './principal_schema.ts';

/** Personal defaults are isolated by workspace, assessment and interaction type. */
export const authoringPreferences = pgTable('assessment_authoring_preferences', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, {
    onDelete: 'cascade',
  }),
  typeId: text('type_id').notNull(),
  settings: jsonb('settings').$type<unknown>().notNull(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.userId, t.assessmentId, t.typeId] })]);

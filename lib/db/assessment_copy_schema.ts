import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { assessments } from './assessment_schema.ts';
import { tenants, users } from './principal_schema.ts';

/** One committed copy per logical authoring request, retained until its assessment is deleted. */
export const assessmentQuestionCopies = pgTable('assessment_question_copies', {
  requestId: uuid('request_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, {
    onDelete: 'cascade',
  }),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  command: text('command').notNull(),
  result: jsonb('result').$type<unknown>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

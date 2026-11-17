import { sql } from 'drizzle-orm';
import { check, doublePrecision, pgTable, uuid } from 'drizzle-orm/pg-core';
import { assessments } from './assessment_schema.ts';

/** One shared, opt-in new-question policy; an absent row explicitly means no assessment override. */
export const assessmentQuestionDefaults = pgTable('assessment_question_defaults', {
  assessmentId: uuid('assessment_id').primaryKey().references(() => assessments.id, {
    onDelete: 'cascade',
  }),
  maximumScore: doublePrecision('maximum_score').notNull(),
}, (table) => [
  check(
    'assessment_question_defaults_points_finite',
    sql`${table.maximumScore} >= 0 AND ${table.maximumScore} < 'Infinity'::double precision`,
  ),
]);

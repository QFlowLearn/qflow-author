import { check, doublePrecision, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, users } from './principal_schema.ts';

/** Opt-in defaults for new questions; existing assessment defaults retain their own scope. */
export const instructorDefaultsTable = pgTable('instructor_authoring_defaults', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  answerChoiceOrder: text('answer_choice_order'),
  maximumScore: doublePrecision('maximum_score'),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.userId] }),
  check(
    'instructor_defaults_nonempty',
    sql`${t.answerChoiceOrder} IS NOT NULL OR ${t.maximumScore} IS NOT NULL`,
  ),
  check(
    'instructor_defaults_points_finite',
    sql`${t.maximumScore} IS NULL OR (${t.maximumScore} >= 0 AND ${t.maximumScore} < 'Infinity'::double precision)`,
  ),
]);

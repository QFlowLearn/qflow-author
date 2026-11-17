import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Counts active tenant items whose latest revision shares one semantic content hash. */
export function questionDuplicateCountSql(
  tenantId: string,
  contentHashColumn: AnyPgColumn,
): ReturnType<typeof sql<number>> {
  return sql<number>`(
    SELECT COUNT(*)::int
    FROM questions duplicate_question
    JOIN question_revisions duplicate_revision
      ON duplicate_revision.id = duplicate_question.latest_revision_id
    WHERE duplicate_question.tenant_id = ${tenantId}
      AND duplicate_question.lifecycle_state = 'active'
      AND duplicate_revision.content_hash = ${contentHashColumn}
  )`;
}

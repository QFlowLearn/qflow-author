import { eq, type SQL, sql } from 'drizzle-orm';
import type { DbReadConnection } from '../db.ts';
import { organizationItems } from '../db/question_organization_schema.ts';
import { parseOrganizationDecision } from './question_organization_decision.ts';
import type { OrganizationRun } from './question_organization_read.ts';
import { selectOrganizationReview } from '../organization_preview_sample.ts';

/** Source sections are explicit; unsectioned imports use immutable artifact identity, authored work its own group. */
export function organizationSampleSource(questionId: SQL, source: SQL): SQL<string> {
  return sql<string>`COALESCE(
    'section:' || (${source})::text,
    (SELECT 'artifact:' || (r.provenance #>> '{origin,artifact,sha256}') FROM question_revisions r WHERE r.question_id = ${questionId} AND r.revision = 1),
    'unsectioned')`;
}

/** Rank only bounded frozen receipt metadata; bodies are loaded for the selected twenty afterward. */
export async function loadOrganizationReview(
  tx: DbReadConnection,
  context: OrganizationRun,
) {
  const rows = await tx.select({
    questionId: organizationItems.questionId,
    sourceKey: organizationSampleSource(
      sql`${organizationItems.questionId}`,
      sql`${organizationItems.source}`,
    ),
    orderKey: sql<string>`md5(${context.run.id} || ${organizationItems.questionId}::text)`,
    state: organizationItems.state,
    decision: organizationItems.decision,
  }).from(organizationItems).where(eq(organizationItems.runId, context.run.id));
  return selectOrganizationReview(rows.map((row) => {
    const decision = row.decision === null
      ? null
      : parseOrganizationDecision(row.decision, context.definition, context.policy);
    if (row.decision !== null && !decision) throw new Error('Invalid organization sample receipt.');
    return { ...row, decision };
  }));
}

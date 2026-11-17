import { eq } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { assessmentAdaptivePlans } from '../db/assessment_schema.ts';

/** Check after locking the authorized assessment; only its adaptive builder may replace its pool. */
export async function isAdaptiveAssessment(
  tx: QflowDatabaseTransaction,
  assessmentId: string,
): Promise<boolean> {
  const rows = await tx.select({ id: assessmentAdaptivePlans.assessmentId }).from(
    assessmentAdaptivePlans,
  )
    .where(eq(assessmentAdaptivePlans.assessmentId, assessmentId)).limit(1);
  return rows.length === 1;
}

export class AdaptiveAssessmentMembershipError extends Error {
  readonly code = 'adaptive_managed';
  readonly status = 422;
  constructor() {
    super('Rebuild this adaptive assessment to change its questions.');
  }
}

/** Guard every generic placement mutation, including revision changes and arrangement. */
export async function requireManualAssessmentMembership(
  tx: QflowDatabaseTransaction,
  assessmentId: string,
): Promise<void> {
  if (await isAdaptiveAssessment(tx, assessmentId)) throw new AdaptiveAssessmentMembershipError();
}

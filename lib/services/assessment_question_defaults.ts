import { and, eq, sql } from 'drizzle-orm';
import { db, type DbReadConnection, type QflowDatabase } from '../db.ts';
import { assessments } from '../db/assessment_schema.ts';
import { assessmentQuestionDefaults } from '../db/assessment_question_defaults_schema.ts';
import {
  type AssessmentQuestionPointDefault,
  type AssessmentQuestionPointDefaultCommand,
  parseStoredAssessmentQuestionPointDefault,
} from '../assessment_question_defaults.ts';
import type { RequestContext } from '../tenants.ts';
import { isAdaptiveAssessment } from './assessment_membership.ts';
import { lockWorkspaceAndRequireAuthority } from './workspace_authorization.ts';

/** Assessment absence is distinct from a valid assessment with no shared default. */
export type AssessmentQuestionPointDefaultReadResult =
  | { readonly _tag: 'Found'; readonly value: AssessmentQuestionPointDefault }
  | { readonly _tag: 'NotFound' };

/** Expected rejections retain the caller's proposed point text and confirmed policy. */
export type AssessmentQuestionPointDefaultSaveResult =
  | { readonly _tag: 'Saved'; readonly value: AssessmentQuestionPointDefault }
  | {
    readonly _tag: 'Rejected';
    readonly code: 'forbidden' | 'assessment_not_found' | 'adaptive_managed' | 'stale_default';
  };

/** Read one tenant-authorized canonical projection, including the explicit unset policy. */
export async function readAssessmentQuestionPointDefault(
  ctx: RequestContext,
  assessmentId: string,
  database: DbReadConnection = db,
): Promise<AssessmentQuestionPointDefaultReadResult> {
  const [row] = await database.select({ value: assessmentQuestionDefaults.maximumScore })
    .from(assessments).leftJoin(
      assessmentQuestionDefaults,
      eq(assessmentQuestionDefaults.assessmentId, assessments.id),
    ).where(and(eq(assessments.id, assessmentId), eq(assessments.tenantId, ctx.tenantId)));
  if (!row) return { _tag: 'NotFound' };
  return { _tag: 'Found', value: parseStoredAssessmentQuestionPointDefault(row.value) };
}

/** Serialize policy writes with workspace authority and the existing assessment lock. */
export async function saveAssessmentQuestionPointDefault(
  ctx: RequestContext,
  assessmentId: string,
  command: AssessmentQuestionPointDefaultCommand,
  database: QflowDatabase = db,
): Promise<AssessmentQuestionPointDefaultSaveResult> {
  return await database.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
      return { _tag: 'Rejected', code: 'forbidden' };
    }
    const [assessment] = await tx.select({ id: assessments.id }).from(assessments).where(and(
      eq(assessments.id, assessmentId),
      eq(assessments.tenantId, ctx.tenantId),
    )).for('update');
    if (!assessment) return { _tag: 'Rejected', code: 'assessment_not_found' };
    if (await isAdaptiveAssessment(tx, assessmentId)) {
      return { _tag: 'Rejected', code: 'adaptive_managed' };
    }
    const current = await readAssessmentQuestionPointDefault(ctx, assessmentId, tx);
    if (current._tag !== 'Found') throw new Error('Locked assessment disappeared.');
    if (current.value === command.desired) return { _tag: 'Saved', value: current.value };
    if (current.value !== command.expected) return { _tag: 'Rejected', code: 'stale_default' };
    if (command.desired === null) {
      await tx.delete(assessmentQuestionDefaults).where(
        eq(assessmentQuestionDefaults.assessmentId, assessmentId),
      );
    } else {
      await tx.insert(assessmentQuestionDefaults).values({
        assessmentId,
        maximumScore: command.desired,
      }).onConflictDoUpdate({
        target: assessmentQuestionDefaults.assessmentId,
        set: { maximumScore: command.desired },
      });
    }
    await tx.update(assessments).set({ updatedAt: sql`now()` }).where(
      and(eq(assessments.id, assessmentId), eq(assessments.tenantId, ctx.tenantId)),
    );
    return { _tag: 'Saved', value: command.desired };
  });
}

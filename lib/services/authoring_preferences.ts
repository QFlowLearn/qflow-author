import { and, eq, sql } from 'drizzle-orm';
import { db, type QflowDatabase, type QflowDatabaseTransaction } from '../db.ts';
import { authoringPreferences } from '../db/authoring_preferences_schema.ts';
import { assessments } from '../db/assessment_schema.ts';
import type { RequestContext } from '../tenants.ts';
import type { QuestionTypeId } from '../types/registry.ts';
import {
  authoringPreferenceUpdates,
  type AuthoringSettingsPatch,
  parseAuthoringPreferences,
} from '../authoring_preferences.ts';

/** Persistence boundary for one author’s assessment-local defaults. */
export class AuthoringPreferencesService {
  constructor(private readonly database: QflowDatabase) {}
  /** Read only the authenticated author's preferences for this assessment. */
  async read(
    ctx: RequestContext,
    assessmentId: string,
  ) {
    const rows = await this.database.select({
      typeId: authoringPreferences.typeId,
      settings: authoringPreferences.settings,
    })
      .from(authoringPreferences).where(scope(ctx, assessmentId));
    const parsed = parseAuthoringPreferences(rows);
    if (!parsed) throw new Error('Stored authoring preferences are invalid');
    return parsed;
  }
  /** Idempotently reset one type without changing any question or another author's preferences. */
  async reset(
    ctx: RequestContext,
    assessmentId: string,
    type: QuestionTypeId,
  ): Promise<boolean> {
    return await this.database.transaction(async (tx) => {
      const found = await tx.select({ id: assessments.id }).from(assessments).where(
        and(eq(assessments.id, assessmentId), eq(assessments.tenantId, ctx.tenantId)),
      ).for('update').limit(1);
      if (!found.length) return false;
      await tx.delete(authoringPreferences).where(
        and(scope(ctx, assessmentId), eq(authoringPreferences.typeId, type)),
      );
      return true;
    });
  }
}

/** Composition used by authenticated routes. */
export const authoringPreferencesService = new AuthoringPreferencesService(db);

/** Commit a patch within the question-save transaction; SQL merges protect unrelated concurrent changes. */
export async function rememberAuthoringSettings(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  assessmentId: string,
  type: QuestionTypeId,
  patch: AuthoringSettingsPatch,
): Promise<void> {
  for (const update of authoringPreferenceUpdates(type, patch)) {
    if (!Object.keys(update.settings).length) continue;
    await tx.insert(authoringPreferences).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      assessmentId,
      typeId: update.typeId,
      settings: update.settings,
    })
      .onConflictDoUpdate({
        target: [
          authoringPreferences.tenantId,
          authoringPreferences.userId,
          authoringPreferences.assessmentId,
          authoringPreferences.typeId,
        ],
        set: {
          settings: sql`${authoringPreferences.settings} || ${
            JSON.stringify(update.settings)
          }::jsonb`,
        },
      });
  }
}
function scope(ctx: RequestContext, assessmentId: string) {
  return and(
    eq(authoringPreferences.tenantId, ctx.tenantId),
    eq(authoringPreferences.userId, ctx.userId),
    eq(authoringPreferences.assessmentId, assessmentId),
  );
}

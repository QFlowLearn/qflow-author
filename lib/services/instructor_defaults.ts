import { and, eq } from 'drizzle-orm';
import { db, type DbReadConnection, type QflowDatabaseTransaction } from '../db.ts';
import { instructorDefaultsTable } from '../db/instructor_defaults_schema.ts';
import { type InstructorDefaults, parseInstructorDefaults } from '../instructor_defaults.ts';
import type { RequestContext } from '../tenants.ts';
import { getUserSettings, saveUserSettings } from './user_settings.ts';

/** Commit account editor settings and workspace defaults together through the service boundary. */
export async function saveEditorPreferences(
  ctx: RequestContext,
  preferences: {
    readonly choiceRichText: boolean;
    readonly instructorDefaults: InstructorDefaults;
  },
): Promise<void> {
  const settings = await getUserSettings(ctx.userId);
  await db.transaction(async (tx) => {
    await saveUserSettings(
      ctx.userId,
      { ...settings, choiceRichText: preferences.choiceRichText },
      tx,
    );
    await saveInstructorDefaults(tx, ctx, preferences.instructorDefaults);
  });
}

/** Load only the authenticated instructor's explicit defaults in the current workspace. */
export async function readInstructorDefaults(
  ctx: RequestContext,
  database: DbReadConnection = db,
): Promise<InstructorDefaults> {
  const [row] = await database.select({
    answerChoiceOrder: instructorDefaultsTable.answerChoiceOrder,
    maximumScore: instructorDefaultsTable.maximumScore,
  })
    .from(instructorDefaultsTable).where(scope(ctx)).limit(1);
  return parseInstructorDefaults(row ?? null);
}

/** Save or reset the opt-in policy inside the editor-preferences transaction. */
export async function saveInstructorDefaults(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  defaults: InstructorDefaults,
): Promise<void> {
  if (defaults === null) {
    await tx.delete(instructorDefaultsTable).where(scope(ctx));
    return;
  }
  await tx.insert(instructorDefaultsTable).values({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    answerChoiceOrder: defaults.answerChoiceOrder,
    maximumScore: defaults.maximumScore,
  }).onConflictDoUpdate({
    target: [instructorDefaultsTable.tenantId, instructorDefaultsTable.userId],
    set: { answerChoiceOrder: defaults.answerChoiceOrder, maximumScore: defaults.maximumScore },
  });
}

function scope(ctx: RequestContext) {
  return and(
    eq(instructorDefaultsTable.tenantId, ctx.tenantId),
    eq(instructorDefaultsTable.userId, ctx.userId),
  );
}

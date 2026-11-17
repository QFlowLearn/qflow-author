import { eq } from 'drizzle-orm';
import { db, type QflowDatabaseTransaction } from '../db.ts';
import { userSettingsTable } from '../db/schema.ts';
import { parseUserSettings, type UserSettings } from '../settings.ts';

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const row = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId))
    .limit(1);
  if (!row.length) throw new Error('User settings row is missing.');
  return parseUserSettings(row[0].settings);
}

export async function saveUserSettings(
  userId: string,
  settings: UserSettings,
  database: Pick<QflowDatabaseTransaction, 'insert'> = db,
) {
  await database.insert(userSettingsTable).values({
    userId,
    settings,
  }).onConflictDoUpdate({
    target: userSettingsTable.userId,
    set: {
      settings,
      updatedAt: new Date(),
    },
  });
}

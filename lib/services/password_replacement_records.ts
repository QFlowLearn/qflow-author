import { eq } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { users } from '../db/schema.ts';
import { revokeActiveAuthSessions } from './auth_session_records.ts';

/** Apply the account and session postconditions shared by every password replacement. */
export async function finalizePasswordReplacement(
  tx: QflowDatabaseTransaction,
  userId: string,
  now: Date,
): Promise<void> {
  await tx.update(users).set({ mustChangePassword: false, updatedAt: now }).where(
    eq(users.id, userId),
  );
  await revokeActiveAuthSessions(tx, userId, now);
}

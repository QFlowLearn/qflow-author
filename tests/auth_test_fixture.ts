import { eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import {
  auditLogs,
  authIdentities,
  authLoginAttempts,
  authSessions,
  organizationMemberships,
  passwordResetEmailDeliveries,
  passwordResetTokens,
  tenants,
  userPasswords,
  users,
} from '../lib/db/schema.ts';

/** Remove records created by an authentication integration test without masking its assertions. */
export async function cleanupAuthTestAccount(input: {
  readonly tenantId: string;
  readonly userId: string | null;
  readonly loginAttemptKeys?: ReadonlyArray<string>;
}): Promise<void> {
  const loginAttemptKeys = input.loginAttemptKeys;
  if (loginAttemptKeys?.length) {
    await safelyDelete(() =>
      db.delete(authLoginAttempts).where(
        inArray(authLoginAttempts.attemptKey, [...loginAttemptKeys]),
      )
    );
  }

  const userId = input.userId;
  if (userId) {
    await safelyDelete(() => db.delete(auditLogs).where(eq(auditLogs.targetUserId, userId)));
    await safelyDelete(() =>
      db.delete(passwordResetEmailDeliveries).where(
        eq(passwordResetEmailDeliveries.userId, userId),
      )
    );
    await safelyDelete(() =>
      db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId))
    );
    await safelyDelete(() => db.delete(authSessions).where(eq(authSessions.userId, userId)));
    await safelyDelete(() =>
      db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId))
    );
    await safelyDelete(() => db.delete(authIdentities).where(eq(authIdentities.userId, userId)));
    await safelyDelete(() => db.delete(userPasswords).where(eq(userPasswords.userId, userId)));
    await safelyDelete(() => db.delete(users).where(eq(users.id, userId)));
  }

  await safelyDelete(() => db.delete(tenants).where(eq(tenants.id, input.tenantId)));
}

async function safelyDelete(operation: () => PromiseLike<unknown>): Promise<void> {
  try {
    await operation();
  } catch (_cause: unknown) {
    // Cleanup is best-effort after the behavior assertions have completed.
  }
}

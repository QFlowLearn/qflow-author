import { and, eq } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { userPasswords } from '../db/schema.ts';
import { recordAuditEventInTransaction } from './audit_logs.ts';
import { insertPreparedAuthSession, type PreparedAuthSession } from './auth_session_records.ts';
import { passwordIssues } from './auth_crypto.ts';
import { finalizePasswordReplacement } from './password_replacement_records.ts';

/** Typed outcome of replacing a signed-in user's password. */
export type ChangePasswordResult =
  | { readonly ok: true; readonly token: string; readonly expiresAt: Date }
  | { readonly ok: false; readonly code: 'invalid_current_password' }
  | {
    readonly ok: false;
    readonly code: 'invalid_new_password';
    readonly issues: ReadonlyArray<string>;
  };

/** Parsed signed-in password-change command received from an HTTP adapter. */
export type ChangePasswordInput = {
  readonly userId: string;
  readonly tenantId: string;
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly userAgent?: string | null;
  readonly ipAddress?: string | null;
  readonly now?: Date;
};

/** Persistence capability used by the signed-in password-change workflow. */
export type PasswordChangeRecords = {
  findPasswordHash(userId: string): Promise<string | null>;
  replacePasswordAndRotateSession(input: {
    readonly userId: string;
    readonly tenantId: string;
    readonly expectedPasswordHash: string;
    readonly passwordHash: string;
    readonly session: PreparedAuthSession;
    readonly userAgent: string | null;
    readonly ipAddress: string | null;
    readonly now: Date;
  }): Promise<boolean>;
};

/** Explicit capabilities used by the signed-in password-change workflow. */
export type ChangePasswordDependencies = {
  readonly clock: { readonly now: () => Date };
  readonly hashPassword: (password: string) => Promise<string>;
  readonly prepareSession: (input: {
    readonly userId: string;
    readonly tenantId: string;
    readonly userAgent?: string | null;
    readonly ipAddress?: string | null;
    readonly now?: Date;
  }) => Promise<PreparedAuthSession>;
  readonly records: PasswordChangeRecords;
  readonly verifyPassword: (password: string, storedHash: string) => Promise<boolean>;
};

/** Verify and replace a signed-in user's password while atomically rotating their session. */
export async function changePassword(
  input: ChangePasswordInput,
  dependencies: ChangePasswordDependencies,
): Promise<ChangePasswordResult> {
  const issues = passwordIssues(input.newPassword);
  if (issues.length) return { ok: false, code: 'invalid_new_password', issues };

  const currentPasswordHash = await dependencies.records.findPasswordHash(input.userId);
  if (!currentPasswordHash) return { ok: false, code: 'invalid_current_password' };
  if (!await dependencies.verifyPassword(input.currentPassword, currentPasswordHash)) {
    return { ok: false, code: 'invalid_current_password' };
  }

  const now = input.now ?? dependencies.clock.now();
  const [passwordHash, session] = await Promise.all([
    dependencies.hashPassword(input.newPassword),
    dependencies.prepareSession({
      userId: input.userId,
      tenantId: input.tenantId,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      now,
    }),
  ]);
  const changed = await dependencies.records.replacePasswordAndRotateSession({
    userId: input.userId,
    tenantId: input.tenantId,
    expectedPasswordHash: currentPasswordHash,
    passwordHash,
    session,
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null,
    now,
  });

  if (!changed) return { ok: false, code: 'invalid_current_password' };
  return { ok: true, token: session.token, expiresAt: session.expiresAt };
}

/** Build the Postgres adapter for atomic password replacement and session rotation. */
export function createPostgresPasswordChangeRecords(
  database: QflowDatabase,
): PasswordChangeRecords {
  return {
    async findPasswordHash(userId): Promise<string | null> {
      const rows = await database.select({ passwordHash: userPasswords.passwordHash })
        .from(userPasswords)
        .where(eq(userPasswords.userId, userId))
        .limit(1);
      return rows[0]?.passwordHash ?? null;
    },
    async replacePasswordAndRotateSession(input): Promise<boolean> {
      return await database.transaction(async (tx): Promise<boolean> => {
        const updated = await tx.update(userPasswords).set({
          passwordHash: input.passwordHash,
          updatedAt: input.now,
        }).where(and(
          eq(userPasswords.userId, input.userId),
          eq(userPasswords.passwordHash, input.expectedPasswordHash),
        )).returning({ userId: userPasswords.userId });
        if (!updated.length) return false;

        await finalizePasswordReplacement(tx, input.userId, input.now);
        await insertPreparedAuthSession(tx, input.session);
        await recordAuditEventInTransaction(tx, {
          tenantId: input.tenantId,
          action: 'password_changed',
          actorUserId: input.userId,
          targetUserId: input.userId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        });
        return true;
      });
    },
  };
}

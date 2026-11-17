import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import {
  authIdentities,
  passwordResetEmailDeliveries,
  passwordResetTokens,
  tenants,
  userPasswords,
} from '../db/schema.ts';
import { recordAuditEventInTransaction } from './audit_logs.ts';
import { passwordIssues } from './auth_crypto.ts';
import { finalizePasswordReplacement } from './password_replacement_records.ts';

/** Typed outcome of consuming one password-reset token. */
export type ResetPasswordWithTokenResult =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly code: 'invalid_or_expired' }
  | {
    readonly ok: false;
    readonly code: 'invalid_password';
    readonly issues: ReadonlyArray<string>;
  };

/** Parsed reset-confirmation command received from an HTTP adapter. */
export type ResetPasswordWithTokenInput = {
  readonly token: string;
  readonly password: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly now?: Date;
};

/** Persistence capabilities for guarded and atomic password-reset confirmation. */
export type PasswordResetConfirmationRecords = {
  /**
   * Advisory abuse-control lookup used only to avoid hashing a password for an invalid token.
   * Final authorization belongs to consumeAndReplace, which repeats the predicates atomically.
   */
  isTokenEligibleForPasswordHash(input: {
    readonly tokenHash: string;
    readonly now: Date;
  }): Promise<boolean>;
  consumeAndReplace(input: {
    readonly tokenHash: string;
    readonly passwordHash: string;
    readonly ipAddress: string | null;
    readonly userAgent: string | null;
    readonly now: Date;
  }): Promise<{ readonly userId: string } | null>;
};

/** Explicit capabilities used by the password-reset confirmation workflow. */
export type ResetPasswordWithTokenDependencies = {
  readonly clock: { readonly now: () => Date };
  readonly hashPassword: (password: string) => Promise<string>;
  readonly hashToken: (token: string) => Promise<string>;
  readonly records: PasswordResetConfirmationRecords;
};

/** Validate, atomically consume, and replace the password for one reset token. */
export async function resetPasswordWithToken(
  input: ResetPasswordWithTokenInput,
  dependencies: ResetPasswordWithTokenDependencies,
): Promise<ResetPasswordWithTokenResult> {
  const issues = passwordIssues(input.password);
  if (issues.length) return { ok: false, code: 'invalid_password', issues };
  if (!input.token) return { ok: false, code: 'invalid_or_expired' };

  const now = input.now ?? dependencies.clock.now();
  const tokenHash = await dependencies.hashToken(input.token);
  if (!await dependencies.records.isTokenEligibleForPasswordHash({ tokenHash, now })) {
    return { ok: false, code: 'invalid_or_expired' };
  }

  const passwordHash = await dependencies.hashPassword(input.password);
  const consumed = await dependencies.records.consumeAndReplace({
    tokenHash,
    passwordHash,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    now,
  });
  return consumed
    ? { ok: true, userId: consumed.userId }
    : { ok: false, code: 'invalid_or_expired' };
}

/** Build the Postgres adapter that guards final reset-token consumption in one transaction. */
export function createPostgresPasswordResetConfirmationRecords(
  database: QflowDatabase,
): PasswordResetConfirmationRecords {
  return {
    async isTokenEligibleForPasswordHash(input): Promise<boolean> {
      const rows = await database.select({ id: passwordResetTokens.id })
        .from(passwordResetTokens)
        .innerJoin(userPasswords, eq(userPasswords.userId, passwordResetTokens.userId))
        .innerJoin(
          authIdentities,
          and(
            eq(authIdentities.userId, passwordResetTokens.userId),
            eq(authIdentities.provider, 'local'),
          ),
        )
        .innerJoin(
          passwordResetEmailDeliveries,
          eq(passwordResetEmailDeliveries.resetTokenId, passwordResetTokens.id),
        )
        .innerJoin(tenants, eq(tenants.id, passwordResetEmailDeliveries.tenantId))
        .where(and(
          eq(passwordResetTokens.tokenHash, input.tokenHash),
          isNull(passwordResetTokens.consumedAt),
          gt(passwordResetTokens.expiresAt, input.now),
          ne(tenants.loginPolicy, 'require_sso'),
        ))
        .limit(1);
      return rows.length > 0;
    },
    async consumeAndReplace(input): Promise<{ readonly userId: string } | null> {
      return await database.transaction(async (tx) => {
        const eligible = await tx.select({
          userId: passwordResetTokens.userId,
          tenantId: passwordResetEmailDeliveries.tenantId,
        })
          .from(passwordResetTokens)
          .innerJoin(userPasswords, eq(userPasswords.userId, passwordResetTokens.userId))
          .innerJoin(
            authIdentities,
            and(
              eq(authIdentities.userId, passwordResetTokens.userId),
              eq(authIdentities.provider, 'local'),
            ),
          )
          .innerJoin(
            passwordResetEmailDeliveries,
            eq(passwordResetEmailDeliveries.resetTokenId, passwordResetTokens.id),
          )
          .innerJoin(tenants, eq(tenants.id, passwordResetEmailDeliveries.tenantId))
          .where(and(
            eq(passwordResetTokens.tokenHash, input.tokenHash),
            isNull(passwordResetTokens.consumedAt),
            gt(passwordResetTokens.expiresAt, input.now),
            ne(tenants.loginPolicy, 'require_sso'),
          ))
          .limit(1)
          .for('update');
        const candidate = eligible[0];
        if (!candidate) return null;
        if (!candidate.tenantId) {
          throw new Error('Eligible password-reset token has no tenant.');
        }

        const consumed = await tx.update(passwordResetTokens).set({ consumedAt: input.now }).where(
          and(
            eq(passwordResetTokens.tokenHash, input.tokenHash),
            eq(passwordResetTokens.userId, candidate.userId),
            isNull(passwordResetTokens.consumedAt),
            gt(passwordResetTokens.expiresAt, input.now),
          ),
        ).returning({ userId: passwordResetTokens.userId });
        const token = consumed[0];
        if (!token) return null;

        const updated = await tx.update(userPasswords).set({
          passwordHash: input.passwordHash,
          updatedAt: input.now,
        }).where(eq(userPasswords.userId, token.userId)).returning({
          userId: userPasswords.userId,
        });
        if (!updated.length) {
          throw new Error('Eligible password-reset account lost its local credential.');
        }
        await finalizePasswordReplacement(tx, token.userId, input.now);

        await recordAuditEventInTransaction(tx, {
          tenantId: candidate.tenantId,
          action: 'password_reset_completed',
          actorUserId: token.userId,
          targetUserId: token.userId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        });

        return { userId: token.userId };
      });
    },
  };
}

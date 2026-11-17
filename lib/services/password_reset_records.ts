import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import {
  authIdentities,
  passwordResetEmailDeliveries,
  passwordResetTokens,
  userPasswords,
  users,
  userSettingsTable,
} from '../db/schema.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { resolveAccountTenant } from './account_tenant.ts';
import type { EmailAddress } from './email_address.ts';
import { recordAuditEventInTransaction } from './audit_logs.ts';
import { type InterfaceLocale, parseInterfaceLocale } from '../i18n/locale.ts';
import { parseUserSettings } from '../settings.ts';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const RESET_REQUEST_COOLDOWN_MS = 15 * 60 * 1000;

/** Successful reset-token issuance persisted together with its encrypted email delivery. */
export type IssuedPasswordReset = {
  readonly deliveryId: string;
};

/** Typed result of issuing one registered account's reset token and delivery record. */
export type IssuePasswordResetResult =
  | { readonly ok: true; readonly value: IssuedPasswordReset }
  | {
    readonly ok: false;
    readonly code:
      | 'account_not_found'
      | 'cooldown_active'
      | 'encryption_unavailable'
      | 'persistence_unavailable';
  };

/** Input for atomically creating a reset token and durable email-delivery record. */
export type IssuePasswordResetInput = {
  readonly email: EmailAddress;
  readonly hostTenantId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly now: Date;
};

/** Encrypted delivery claimed by one sender lease. */
export type ClaimedPasswordResetDelivery = {
  readonly id: string;
  readonly resetTokenId: string;
  readonly userId: string;
  readonly tenantId: string | null;
  readonly email: string;
  readonly encryptedToken: string;
  readonly interfaceLocale: InterfaceLocale;
};

/** Persistence contract used by password-reset request and delivery Service Modules. */
export type PasswordResetRecords = {
  issue(input: IssuePasswordResetInput): Promise<IssuePasswordResetResult>;
  listPendingDeliveryIds(input: {
    readonly now: Date;
    readonly limit: number;
  }): Promise<
    | { readonly ok: true; readonly deliveryIds: ReadonlyArray<string> }
    | { readonly ok: false; readonly code: 'persistence_unavailable' }
  >;
  claimDelivery(input: {
    readonly deliveryId: string;
    readonly leaseToken: string;
    readonly now: Date;
    readonly leasedUntil: Date;
  }): Promise<
    | { readonly ok: true; readonly delivery: ClaimedPasswordResetDelivery }
    | { readonly ok: false; readonly code: 'not_available' | 'persistence_unavailable' }
  >;
  completeDelivery(input: {
    readonly deliveryId: string;
    readonly leaseToken: string;
    readonly deliveredAt: Date;
  }): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly code: 'not_available' | 'persistence_unavailable' }
  >;
  releaseDelivery(input: {
    readonly deliveryId: string;
    readonly leaseToken: string;
  }): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly code: 'not_available' | 'persistence_unavailable' }
  >;
  invalidateDelivery(input: {
    readonly deliveryId: string;
    readonly leaseToken: string;
    readonly invalidatedAt: Date;
  }): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly code: 'not_available' | 'persistence_unavailable' }
  >;
};

/** Build the Postgres adapter for atomic reset issuance and leased email delivery. */
export function createPostgresPasswordResetRecords(input: {
  readonly database: QflowDatabase;
  readonly generateId: () => string;
  readonly generateToken: () => string;
  readonly hashToken: (token: string) => Promise<string>;
  readonly encryptToken: (input: {
    readonly token: string;
    readonly resetTokenId: string;
    readonly userId: string;
  }) => Promise<string>;
}): PasswordResetRecords {
  return {
    async issue(issueInput): Promise<IssuePasswordResetResult> {
      try {
        return await input.database.transaction(async (tx): Promise<IssuePasswordResetResult> => {
          const rows = await tx.select({
            id: users.id,
            email: users.email,
          })
            .from(users)
            .innerJoin(userPasswords, eq(userPasswords.userId, users.id))
            .innerJoin(
              authIdentities,
              and(
                eq(authIdentities.userId, users.id),
                eq(authIdentities.provider, 'local'),
              ),
            )
            .where(eq(users.emailNormalized, issueInput.email))
            .limit(1)
            .for('update');
          const account = rows[0];
          if (!account) return { ok: false, code: 'account_not_found' };
          const settingRows = await tx.select({ settings: userSettingsTable.settings })
            .from(userSettingsTable)
            .where(eq(userSettingsTable.userId, account.id))
            .limit(1)
            .for('update');
          if (!settingRows[0]) throw new Error('User settings row is missing.');
          const interfaceLocale = parseUserSettings(settingRows[0].settings).interfaceLocale;
          const tenant = await resolveAccountTenant(tx, {
            userId: account.id,
            hostTenantId: issueInput.hostTenantId,
          });
          if (!tenant.ok || tenant.value.loginPolicy === 'require_sso') {
            return { ok: false, code: 'account_not_found' };
          }

          const cooldownCutoff = new Date(
            issueInput.now.getTime() - RESET_REQUEST_COOLDOWN_MS,
          );
          const activeRows = await tx.select({ id: passwordResetTokens.id })
            .from(passwordResetTokens)
            .where(and(
              eq(passwordResetTokens.userId, account.id),
              isNull(passwordResetTokens.consumedAt),
              gt(passwordResetTokens.expiresAt, issueInput.now),
              gt(passwordResetTokens.createdAt, cooldownCutoff),
            ))
            .limit(1);
          if (activeRows.length) return { ok: false, code: 'cooldown_active' };

          const token = input.generateToken();
          const resetTokenId = input.generateId();
          let tokenHash: string;
          let encryptedToken: string;
          try {
            [tokenHash, encryptedToken] = await Promise.all([
              input.hashToken(token),
              input.encryptToken({ token, resetTokenId, userId: account.id }),
            ]);
          } catch (cause: unknown) {
            console.error(JSON.stringify({
              event: 'password_reset_token_encryption_failed',
              cause: safeErrorSummary(cause),
            }));
            return { ok: false, code: 'encryption_unavailable' };
          }

          const consumed = await tx.update(passwordResetTokens).set({
            consumedAt: issueInput.now,
          }).where(and(
            eq(passwordResetTokens.userId, account.id),
            isNull(passwordResetTokens.consumedAt),
          )).returning({ id: passwordResetTokens.id });
          if (consumed.length) {
            await tx.update(passwordResetEmailDeliveries).set({
              encryptedToken: null,
              invalidatedAt: issueInput.now,
              leaseToken: null,
              leasedUntil: null,
            }).where(and(
              inArray(passwordResetEmailDeliveries.resetTokenId, consumed.map((row) => row.id)),
              isNull(passwordResetEmailDeliveries.deliveredAt),
              isNull(passwordResetEmailDeliveries.invalidatedAt),
            ));
          }

          const expiresAt = new Date(issueInput.now.getTime() + RESET_TOKEN_TTL_MS);
          await tx.insert(passwordResetTokens).values({
            id: resetTokenId,
            userId: account.id,
            tokenHash,
            createdAt: issueInput.now,
            expiresAt,
          });

          const tenantId = tenant.value.tenantId;
          const deliveryId = input.generateId();
          await tx.insert(passwordResetEmailDeliveries).values({
            id: deliveryId,
            resetTokenId,
            userId: account.id,
            tenantId,
            email: account.email,
            encryptedToken,
            interfaceLocale,
            createdAt: issueInput.now,
          });

          if (tenantId) {
            await recordAuditEventInTransaction(tx, {
              tenantId,
              action: 'password_reset_requested',
              actorUserId: null,
              targetUserId: account.id,
              ipAddress: issueInput.ipAddress,
              userAgent: issueInput.userAgent,
            });
          }

          return { ok: true, value: { deliveryId } };
        });
      } catch (cause: unknown) {
        logPersistenceFailure('issue', cause);
        return { ok: false, code: 'persistence_unavailable' };
      }
    },

    async listPendingDeliveryIds(listInput) {
      try {
        const rows = await input.database.select({ id: passwordResetEmailDeliveries.id })
          .from(passwordResetEmailDeliveries)
          .where(and(
            isNull(passwordResetEmailDeliveries.deliveredAt),
            isNull(passwordResetEmailDeliveries.invalidatedAt),
            isNotNull(passwordResetEmailDeliveries.encryptedToken),
            or(
              isNull(passwordResetEmailDeliveries.leasedUntil),
              lte(passwordResetEmailDeliveries.leasedUntil, listInput.now),
            ),
            activeTokenExists(listInput.now),
          ))
          .orderBy(asc(passwordResetEmailDeliveries.createdAt))
          .limit(listInput.limit);
        return { ok: true, deliveryIds: rows.map((row) => row.id) };
      } catch (cause: unknown) {
        logPersistenceFailure('list_pending_deliveries', cause);
        return { ok: false, code: 'persistence_unavailable' };
      }
    },

    async claimDelivery(claimInput) {
      try {
        const rows = await input.database.update(passwordResetEmailDeliveries).set({
          attempts: sql`${passwordResetEmailDeliveries.attempts} + 1`,
          leaseToken: claimInput.leaseToken,
          leasedUntil: claimInput.leasedUntil,
          lastAttemptAt: claimInput.now,
        }).where(and(
          eq(passwordResetEmailDeliveries.id, claimInput.deliveryId),
          isNull(passwordResetEmailDeliveries.deliveredAt),
          isNull(passwordResetEmailDeliveries.invalidatedAt),
          isNotNull(passwordResetEmailDeliveries.encryptedToken),
          or(
            isNull(passwordResetEmailDeliveries.leasedUntil),
            lte(passwordResetEmailDeliveries.leasedUntil, claimInput.now),
          ),
          activeTokenExists(claimInput.now),
        )).returning({
          id: passwordResetEmailDeliveries.id,
          resetTokenId: passwordResetEmailDeliveries.resetTokenId,
          userId: passwordResetEmailDeliveries.userId,
          tenantId: passwordResetEmailDeliveries.tenantId,
          email: passwordResetEmailDeliveries.email,
          encryptedToken: passwordResetEmailDeliveries.encryptedToken,
          interfaceLocale: passwordResetEmailDeliveries.interfaceLocale,
        });
        const delivery = rows[0];
        if (!delivery?.encryptedToken) return { ok: false, code: 'not_available' };
        const interfaceLocale = parseInterfaceLocale(delivery.interfaceLocale);
        if (!interfaceLocale) return { ok: false, code: 'persistence_unavailable' };
        return {
          ok: true,
          delivery: { ...delivery, interfaceLocale, encryptedToken: delivery.encryptedToken },
        };
      } catch (cause: unknown) {
        logPersistenceFailure('claim_delivery', cause);
        return { ok: false, code: 'persistence_unavailable' };
      }
    },

    async completeDelivery(completeInput) {
      try {
        const rows = await input.database.update(passwordResetEmailDeliveries).set({
          deliveredAt: completeInput.deliveredAt,
          encryptedToken: null,
          leaseToken: null,
          leasedUntil: null,
        }).where(and(
          eq(passwordResetEmailDeliveries.id, completeInput.deliveryId),
          eq(passwordResetEmailDeliveries.leaseToken, completeInput.leaseToken),
          isNull(passwordResetEmailDeliveries.deliveredAt),
          isNull(passwordResetEmailDeliveries.invalidatedAt),
        )).returning({ id: passwordResetEmailDeliveries.id });
        return rows.length ? { ok: true } : { ok: false, code: 'not_available' };
      } catch (cause: unknown) {
        logPersistenceFailure('complete_delivery', cause);
        return { ok: false, code: 'persistence_unavailable' };
      }
    },

    async releaseDelivery(releaseInput) {
      try {
        const rows = await input.database.update(passwordResetEmailDeliveries).set({
          leaseToken: null,
          leasedUntil: null,
        }).where(and(
          eq(passwordResetEmailDeliveries.id, releaseInput.deliveryId),
          eq(passwordResetEmailDeliveries.leaseToken, releaseInput.leaseToken),
          isNull(passwordResetEmailDeliveries.deliveredAt),
          isNull(passwordResetEmailDeliveries.invalidatedAt),
        )).returning({ id: passwordResetEmailDeliveries.id });
        return rows.length ? { ok: true } : { ok: false, code: 'not_available' };
      } catch (cause: unknown) {
        logPersistenceFailure('release_delivery', cause);
        return { ok: false, code: 'persistence_unavailable' };
      }
    },

    async invalidateDelivery(invalidateInput) {
      try {
        return await input.database.transaction(async (tx) => {
          const rows = await tx.update(passwordResetEmailDeliveries).set({
            invalidatedAt: invalidateInput.invalidatedAt,
            encryptedToken: null,
            leaseToken: null,
            leasedUntil: null,
          }).where(and(
            eq(passwordResetEmailDeliveries.id, invalidateInput.deliveryId),
            eq(passwordResetEmailDeliveries.leaseToken, invalidateInput.leaseToken),
            isNull(passwordResetEmailDeliveries.deliveredAt),
            isNull(passwordResetEmailDeliveries.invalidatedAt),
          )).returning({ resetTokenId: passwordResetEmailDeliveries.resetTokenId });
          const invalidated = rows[0];
          if (!invalidated) return { ok: false, code: 'not_available' } as const;

          await tx.update(passwordResetTokens).set({
            consumedAt: invalidateInput.invalidatedAt,
          }).where(and(
            eq(passwordResetTokens.id, invalidated.resetTokenId),
            isNull(passwordResetTokens.consumedAt),
          ));
          return { ok: true } as const;
        });
      } catch (cause: unknown) {
        logPersistenceFailure('invalidate_delivery', cause);
        return { ok: false, code: 'persistence_unavailable' };
      }
    },
  };
}

function activeTokenExists(now: Date) {
  return sql`EXISTS (
    SELECT 1
    FROM ${passwordResetTokens}
    WHERE ${passwordResetTokens.id} = ${passwordResetEmailDeliveries.resetTokenId}
      AND ${passwordResetTokens.consumedAt} IS NULL
      AND ${passwordResetTokens.expiresAt} > ${sql.param(now, passwordResetTokens.expiresAt)}
  )`;
}

function logPersistenceFailure(operation: string, cause: unknown): void {
  console.error(JSON.stringify({
    event: 'password_reset_persistence_failed',
    operation,
    cause: safeErrorSummary(cause),
    databaseCode: safeDatabaseCode(cause),
  }));
}

function safeDatabaseCode(cause: unknown): string | null {
  let current = cause;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = Reflect.get(current, 'code');
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/u.test(code)) return code;
    current = Reflect.get(current, 'cause');
  }
  return null;
}

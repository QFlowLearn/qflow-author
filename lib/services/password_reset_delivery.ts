import { safeErrorSummary } from '../error_summary.ts';
import type { Redacted } from '../redacted.ts';
import { reveal } from '../redacted.ts';
import type { TransactionalEmailSender } from './email.ts';
import type { PasswordResetRecords } from './password_reset_records.ts';

const DELIVERY_LEASE_MS = 5 * 60 * 1000;
const DELIVERY_RECOVERY_BATCH_SIZE = 10;

type PasswordResetDeliveryRecords = Pick<
  PasswordResetRecords,
  | 'listPendingDeliveryIds'
  | 'claimDelivery'
  | 'completeDelivery'
  | 'releaseDelivery'
  | 'invalidateDelivery'
>;

/** Typed outcome of trying to deliver one durable password-reset email. */
export type PasswordResetDeliveryResult =
  | { readonly ok: true; readonly code: 'delivered' | 'not_available' }
  | {
    readonly ok: false;
    readonly code: 'email_delivery_failed' | 'encryption_unavailable' | 'persistence_unavailable';
  };

/** Summary returned by one bounded recovery pass over pending reset emails. */
export type PasswordResetDeliveryBatchResult =
  | {
    readonly ok: true;
    readonly attempted: number;
    readonly delivered: number;
  }
  | {
    readonly ok: false;
    readonly attempted: number;
    readonly delivered: number;
    readonly failed: number;
  };

/** Delivers encrypted reset-token records through the transactional-email capability. */
export class PasswordResetEmailDeliveries {
  readonly #appOrigin: URL;
  readonly #clock: { readonly now: () => Date };
  readonly #decryptToken: (input: {
    readonly encryptedToken: string;
    readonly resetTokenId: string;
    readonly userId: string;
  }) => Promise<Redacted<string>>;
  readonly #email: TransactionalEmailSender;
  readonly #generateId: () => string;
  readonly #records: PasswordResetDeliveryRecords;

  constructor(input: {
    readonly appOrigin: URL;
    readonly clock: { readonly now: () => Date };
    readonly decryptToken: (input: {
      readonly encryptedToken: string;
      readonly resetTokenId: string;
      readonly userId: string;
    }) => Promise<Redacted<string>>;
    readonly email: TransactionalEmailSender;
    readonly generateId: () => string;
    readonly records: PasswordResetDeliveryRecords;
  }) {
    this.#appOrigin = input.appOrigin;
    this.#clock = input.clock;
    this.#decryptToken = input.decryptToken;
    this.#email = input.email;
    this.#generateId = input.generateId;
    this.#records = input.records;
  }

  /** Deliver one record, either invalidating a known failure or leaving it retryable. */
  async deliver(input: {
    readonly deliveryId: string;
    readonly onEmailFailure: 'invalidate' | 'retry';
  }): Promise<PasswordResetDeliveryResult> {
    const now = this.#clock.now();
    const leaseToken = this.#generateId();
    const claim = await this.#records.claimDelivery({
      deliveryId: input.deliveryId,
      leaseToken,
      now,
      leasedUntil: new Date(now.getTime() + DELIVERY_LEASE_MS),
    });
    if (!claim.ok) {
      return claim.code === 'not_available'
        ? { ok: true, code: 'not_available' }
        : { ok: false, code: 'persistence_unavailable' };
    }

    const delivery = claim.delivery;
    let token: Redacted<string>;
    try {
      token = await this.#decryptToken({
        encryptedToken: delivery.encryptedToken,
        resetTokenId: delivery.resetTokenId,
        userId: delivery.userId,
      });
    } catch (cause: unknown) {
      console.error(JSON.stringify({
        event: 'password_reset_token_decryption_failed',
        deliveryId: delivery.id,
        cause: safeErrorSummary(cause),
      }));
      const invalidated = await this.#records.invalidateDelivery({
        deliveryId: delivery.id,
        leaseToken,
        invalidatedAt: this.#clock.now(),
      });
      return invalidated.ok
        ? { ok: false, code: 'encryption_unavailable' }
        : { ok: false, code: 'persistence_unavailable' };
    }

    const resetUrl = new URL('/password/reset', this.#appOrigin);
    resetUrl.searchParams.set('token', reveal(token));
    let sent: Awaited<ReturnType<TransactionalEmailSender['sendPasswordResetEmail']>>;
    try {
      sent = await this.#email.sendPasswordResetEmail({
        email: delivery.email,
        resetUrl: resetUrl.toString(),
        userId: delivery.userId,
        tenantId: delivery.tenantId,
        interfaceLocale: delivery.interfaceLocale,
      });
    } catch (cause: unknown) {
      console.error(JSON.stringify({
        event: 'password_reset_email_adapter_failed',
        deliveryId: delivery.id,
        cause: safeErrorSummary(cause),
      }));
      sent = { ok: false, code: 'send_failed' };
    }

    if (!sent.ok) {
      const reconciled = input.onEmailFailure === 'invalidate'
        ? await this.#records.invalidateDelivery({
          deliveryId: delivery.id,
          leaseToken,
          invalidatedAt: this.#clock.now(),
        })
        : await this.#records.releaseDelivery({ deliveryId: delivery.id, leaseToken });
      return reconciled.ok
        ? { ok: false, code: 'email_delivery_failed' }
        : { ok: false, code: 'persistence_unavailable' };
    }

    const completed = await this.#records.completeDelivery({
      deliveryId: delivery.id,
      leaseToken,
      deliveredAt: this.#clock.now(),
    });
    return completed.ok
      ? { ok: true, code: 'delivered' }
      : { ok: false, code: 'persistence_unavailable' };
  }

  /** Recover a bounded batch of committed deliveries left pending by crashes or restarts. */
  async deliverPending(): Promise<PasswordResetDeliveryBatchResult> {
    const pending = await this.#records.listPendingDeliveryIds({
      now: this.#clock.now(),
      limit: DELIVERY_RECOVERY_BATCH_SIZE,
    });
    if (!pending.ok) return { ok: false, attempted: 0, delivered: 0, failed: 1 };

    const results = await Promise.allSettled(
      pending.deliveryIds.map((deliveryId) =>
        this.deliver({ deliveryId, onEmailFailure: 'retry' })
      ),
    );
    let delivered = 0;
    let failed = 0;
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.ok) {
        if (result.value.code === 'delivered') delivered += 1;
      } else {
        failed += 1;
      }
    }
    return failed === 0
      ? { ok: true, attempted: results.length, delivered }
      : { ok: false, attempted: results.length, delivered, failed };
  }
}

import { getEnv } from '../config.ts';
import {
  decryptCredential,
  encryptCredential,
  validateCredentialCipherRuntime,
} from '../credential_cipher.ts';
import { getDb, type QflowDatabase } from '../db.ts';
import { redact } from '../redacted.ts';
import {
  createCloudflarePasswordResetRateLimits,
  createLocalPasswordResetRateLimits,
  type PasswordResetRateLimits,
} from './auth_rate_limit.ts';
import {
  createCloudflareTransactionalEmailSender,
  createLocalDisabledTransactionalEmailSender,
  isLocalTransactionalEmailDisabled,
} from './email.ts';
import type { EmailAddress } from './email_address.ts';
import {
  changePassword,
  type ChangePasswordInput,
  type ChangePasswordResult,
  createPostgresPasswordChangeRecords,
} from './password_change.ts';
import {
  createPostgresPasswordResetConfirmationRecords,
  resetPasswordWithToken,
  type ResetPasswordWithTokenInput,
  type ResetPasswordWithTokenResult,
} from './password_reset_confirmation.ts';
import {
  type PasswordResetDeliveryBatchResult,
  PasswordResetEmailDeliveries,
} from './password_reset_delivery.ts';
import {
  createPostgresPasswordResetRecords,
  type PasswordResetRecords,
} from './password_reset_records.ts';
import { prepareAuthSession } from './auth_session_records.ts';
import { generateAuthToken, hashAuthToken, hashPassword, verifyPassword } from './auth_crypto.ts';
import type { RuntimeSource } from '../runtime.ts';

const systemClock = { now: () => new Date() };

/** Registration-neutral result returned to password-reset protocol adapters. */
export type RequestPasswordResetResult =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly code:
      | 'rate_limit_unavailable'
      | 'email_delivery_failed'
      | 'encryption_unavailable'
      | 'persistence_unavailable';
  };

/** Registration-neutral response copy for every accepted reset request. */
export const PASSWORD_RESET_REQUEST_MESSAGE =
  "If an account is registered for that email address, we'll send a password reset link. " +
  'Check your inbox and spam folder. You can request another link after 15 minutes.';

/** Input accepted after the HTTP adapter has parsed the reset request. */
export type RequestPasswordResetInput = {
  readonly email: EmailAddress;
  readonly hostTenantId: string | null;
  readonly clientIp: string | null;
  readonly userAgent: string | null;
};

/** Explicit capabilities used by the password-reset request workflow. */
export type PasswordResetRequestDependencies = {
  readonly clock: { readonly now: () => Date };
  readonly deliveries: Pick<PasswordResetEmailDeliveries, 'deliver'>;
  readonly rateLimits: PasswordResetRateLimits;
  readonly records: Pick<PasswordResetRecords, 'issue'>;
};

type PasswordResetCapabilities = {
  readonly deliveries: PasswordResetEmailDeliveries;
  readonly localEmailDisabled: boolean;
  readonly records: PasswordResetRecords;
};

/** Request one rate-limited email without revealing account existence to the caller. */
export async function requestPasswordReset(
  input: RequestPasswordResetInput,
  dependencies: PasswordResetRequestDependencies,
): Promise<RequestPasswordResetResult> {
  const rateLimit = await dependencies.rateLimits.check({
    emailNormalized: input.email,
    clientIp: input.clientIp,
  });
  if (!rateLimit.ok) {
    if (rateLimit.code === 'limited') return { ok: true };
    return { ok: false, code: 'rate_limit_unavailable' };
  }

  const reset = await dependencies.records.issue({
    email: input.email,
    hostTenantId: input.hostTenantId,
    ipAddress: input.clientIp,
    userAgent: input.userAgent,
    now: dependencies.clock.now(),
  });
  if (!reset.ok) {
    if (reset.code === 'account_not_found' || reset.code === 'cooldown_active') {
      return { ok: true };
    }
    return { ok: false, code: reset.code };
  }

  const delivery = await dependencies.deliveries.deliver({
    deliveryId: reset.value.deliveryId,
    onEmailFailure: 'invalidate',
  });
  if (!delivery.ok) return delivery;

  return { ok: true };
}

/** Password workflows composed from one request or scheduled-event runtime boundary. */
export type PasswordServices = {
  readonly requestReset: (
    input: RequestPasswordResetInput,
  ) => Promise<RequestPasswordResetResult>;
  readonly confirmReset: (
    input: ResetPasswordWithTokenInput,
  ) => Promise<ResetPasswordWithTokenResult>;
  readonly changePassword: (input: ChangePasswordInput) => Promise<ChangePasswordResult>;
  readonly deliverPendingResetEmails: () => Promise<PasswordResetDeliveryBatchResult>;
};

/** Compose all password workflows from the same explicit runtime boundary. */
export function createPasswordServices(runtime: RuntimeSource): PasswordServices {
  const database = getDb(runtime);
  const resetCapabilities = createPasswordResetCapabilities(runtime, database);
  const requestDependencies = createPasswordResetRequestDependencies(runtime, resetCapabilities);
  const confirmationDependencies = {
    clock: systemClock,
    hashPassword,
    hashToken: hashAuthToken,
    records: createPostgresPasswordResetConfirmationRecords(database),
  };
  const changeDependencies = {
    clock: systemClock,
    hashPassword,
    prepareSession: prepareAuthSession,
    records: createPostgresPasswordChangeRecords(database),
    verifyPassword,
  };

  return {
    requestReset(input) {
      return requestPasswordReset(input, requestDependencies);
    },
    confirmReset(input) {
      return resetPasswordWithToken(input, confirmationDependencies);
    },
    changePassword(input) {
      return changePassword(input, changeDependencies);
    },
    deliverPendingResetEmails() {
      return resetCapabilities.deliveries.deliverPending();
    },
  };
}

/** Validate every production capability required by the Cloudflare password-reset workflow. */
export function validatePasswordResetRuntime(runtime: RuntimeSource): void {
  readAppOrigin(runtime);
  validateCredentialCipherRuntime(runtime);
  createCloudflareTransactionalEmailSender(runtime);
  createCloudflarePasswordResetRateLimits(runtime);
}

function createPasswordResetRequestDependencies(
  runtime: RuntimeSource,
  capabilities: PasswordResetCapabilities,
): PasswordResetRequestDependencies {
  return {
    clock: systemClock,
    deliveries: capabilities.deliveries,
    rateLimits: capabilities.localEmailDisabled
      ? createLocalPasswordResetRateLimits()
      : createCloudflarePasswordResetRateLimits(runtime),
    records: capabilities.records,
  };
}

function createPasswordResetCapabilities(
  runtime: RuntimeSource,
  database: QflowDatabase,
): PasswordResetCapabilities {
  const localEmailDisabled = isLocalTransactionalEmailDisabled(runtime);
  const records = createPostgresPasswordResetRecords({
    database,
    generateId: () => crypto.randomUUID(),
    generateToken: generateAuthToken,
    hashToken: hashAuthToken,
    encryptToken: async ({ token, resetTokenId, userId }) =>
      await encryptCredential(runtime, redact(token), {
        purpose: 'password-reset-token',
        resetTokenId,
        userId,
      }),
  });
  const email = localEmailDisabled
    ? createLocalDisabledTransactionalEmailSender()
    : createCloudflareTransactionalEmailSender(runtime);
  const deliveries = new PasswordResetEmailDeliveries({
    appOrigin: readAppOrigin(runtime),
    clock: systemClock,
    decryptToken: ({ encryptedToken, resetTokenId, userId }) =>
      decryptCredential(runtime, encryptedToken, {
        purpose: 'password-reset-token',
        resetTokenId,
        userId,
      }),
    email,
    generateId: () => crypto.randomUUID(),
    records,
  });
  return { deliveries, localEmailDisabled, records };
}

function readAppOrigin(runtime: RuntimeSource): URL {
  const configured = getEnv('QFLOW_APP_ORIGIN', runtime);
  if (!configured) throw new Error('Missing required env var QFLOW_APP_ORIGIN');

  let url: URL;
  try {
    url = new URL(configured);
  } catch (_cause: unknown) {
    throw new Error('QFLOW_APP_ORIGIN must be an absolute HTTPS origin');
  }
  if (
    url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' ||
    url.search || url.hash
  ) {
    throw new Error('QFLOW_APP_ORIGIN must be an absolute HTTPS origin');
  }
  return url;
}

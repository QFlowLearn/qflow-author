import { eq, sql } from 'drizzle-orm';
import { db } from '../db.ts';
import { authLoginAttempts } from '../db/schema.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { getRuntimeBinding, type RuntimeSource } from '../runtime.ts';
import { hashAuthToken } from './auth_crypto.ts';

const MAX_ACCOUNT_LOGIN_ATTEMPTS = 5;
const MAX_ORIGIN_LOGIN_ATTEMPTS = 50;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;
const RESET_ACCOUNT_RATE_LIMIT_BINDING = 'QFLOW_PASSWORD_RESET_ACCOUNT_RATE_LIMIT';
const RESET_ORIGIN_RATE_LIMIT_BINDING = 'QFLOW_PASSWORD_RESET_ORIGIN_RATE_LIMIT';

type RateLimitBinding = {
  limit(input: { readonly key: string }): Promise<{ readonly success: boolean }>;
};

/** Opaque persistence keys for one password-login attempt. */
export type PasswordLoginAttempt = {
  readonly accountKey: string;
  readonly originKey: string;
};

/** Resolve opaque attempt keys and report whether account and origin limits allow a login. */
export async function preparePasswordLoginAttempt(input: {
  readonly emailNormalized: string;
  readonly attemptOrigin: string;
}): Promise<{ readonly allowed: boolean; readonly attempt: PasswordLoginAttempt }> {
  const attemptOrigin = input.attemptOrigin.trim() || 'unknown';
  const [accountKey, originKey] = await Promise.all([
    hashAuthToken(`${input.emailNormalized}\u0000${attemptOrigin}`),
    hashAuthToken(`login-origin\u0000${attemptOrigin}`),
  ]);
  const attempt = { accountKey, originKey };
  const [accountAllowed, originAllowed] = await Promise.all([
    isPasswordLoginAttemptAllowed(accountKey),
    isPasswordLoginAttemptAllowed(originKey),
  ]);
  return { allowed: accountAllowed && originAllowed, attempt };
}

/** Atomically record one rejected password login against account and origin limits. */
export async function recordPasswordLoginFailure(attempt: PasswordLoginAttempt): Promise<void> {
  await Promise.all([
    recordPasswordLoginAttempt(attempt.accountKey, MAX_ACCOUNT_LOGIN_ATTEMPTS),
    recordPasswordLoginAttempt(attempt.originKey, MAX_ORIGIN_LOGIN_ATTEMPTS),
  ]);
}

/** Clear the account attempt state after a successful password login. */
export async function clearPasswordLoginFailures(attempt: PasswordLoginAttempt): Promise<void> {
  await db.delete(authLoginAttempts).where(eq(authLoginAttempts.attemptKey, attempt.accountKey));
}

/** Result of applying both password-reset edge limits. */
export type PasswordResetRateLimitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'limited' | 'unavailable' };

/** Service-facing capability for password-reset edge throttling. */
export type PasswordResetRateLimits = {
  check(input: {
    readonly emailNormalized: string;
    readonly clientIp: string | null;
  }): Promise<PasswordResetRateLimitResult>;
};

/** Build password-reset throttling from the required Cloudflare rate-limit bindings. */
export function createCloudflarePasswordResetRateLimits(
  runtime: RuntimeSource,
): PasswordResetRateLimits {
  const accountLimiter = requireRateLimitBinding(runtime, RESET_ACCOUNT_RATE_LIMIT_BINDING);
  const originLimiter = requireRateLimitBinding(runtime, RESET_ORIGIN_RATE_LIMIT_BINDING);

  return {
    async check(input): Promise<PasswordResetRateLimitResult> {
      const [accountKey, originKey] = await Promise.all([
        opaqueRateLimitKey('password-reset-account', input.emailNormalized),
        opaqueRateLimitKey('password-reset-origin', input.clientIp ?? 'unknown'),
      ]);

      try {
        const [accountResult, originResult] = await Promise.all([
          accountLimiter.limit({ key: accountKey }),
          originLimiter.limit({ key: originKey }),
        ]);
        if (!accountResult.success || !originResult.success) {
          return { ok: false, code: 'limited' };
        }
        return { ok: true };
      } catch (cause: unknown) {
        console.error(JSON.stringify({
          event: 'password_reset_rate_limit_failed',
          cause: safeErrorSummary(cause),
        }));
        return { ok: false, code: 'unavailable' };
      }
    },
  };
}

/** Build the explicit local-only rate-limit adapter used when email delivery is disabled. */
export function createLocalPasswordResetRateLimits(): PasswordResetRateLimits {
  return {
    check(): Promise<PasswordResetRateLimitResult> {
      return Promise.resolve({ ok: true });
    },
  };
}

function requireRateLimitBinding(runtime: RuntimeSource, key: string): RateLimitBinding {
  const candidate = getRuntimeBinding(runtime, key);
  if (!candidate || typeof candidate !== 'object') {
    throw new Error(`Missing required Cloudflare binding ${key}`);
  }
  const limit = Reflect.get(candidate, 'limit');
  if (typeof limit !== 'function') {
    throw new Error(`Missing required Cloudflare binding ${key}`);
  }
  // SAFETY: the Cloudflare boundary was refined to an object with a callable limit capability.
  return candidate as RateLimitBinding;
}

async function opaqueRateLimitKey(scope: string, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${scope}\u0000${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function isPasswordLoginAttemptAllowed(attemptKey: string): Promise<boolean> {
  const rows = await db.select({ lockedUntil: authLoginAttempts.lockedUntil })
    .from(authLoginAttempts)
    .where(eq(authLoginAttempts.attemptKey, attemptKey))
    .limit(1);
  const lockedUntil = rows[0]?.lockedUntil;
  return !lockedUntil || lockedUntil.getTime() <= Date.now();
}

async function recordPasswordLoginAttempt(
  attemptKey: string,
  maximumAttempts: number,
): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - LOGIN_ATTEMPT_WINDOW_MS);
  const lockedUntil = new Date(now.getTime() + LOGIN_LOCK_DURATION_MS);
  const withinWindow = sql`${authLoginAttempts.firstAttemptAt} >= ${
    sql.param(windowStart, authLoginAttempts.firstAttemptAt)
  }`;
  await db.insert(authLoginAttempts).values({
    attemptKey,
    attempts: 1,
    firstAttemptAt: now,
    lastAttemptAt: now,
    lockedUntil: null,
  }).onConflictDoUpdate({
    target: authLoginAttempts.attemptKey,
    set: {
      attempts: sql`CASE WHEN ${withinWindow} THEN ${authLoginAttempts.attempts} + 1 ELSE 1 END`,
      firstAttemptAt: sql`CASE WHEN ${withinWindow} THEN ${authLoginAttempts.firstAttemptAt} ELSE ${
        sql.param(now, authLoginAttempts.firstAttemptAt)
      } END`,
      lastAttemptAt: now,
      lockedUntil:
        sql`CASE WHEN ${withinWindow} AND ${authLoginAttempts.attempts} + 1 >= ${maximumAttempts} THEN ${
          sql.param(lockedUntil, authLoginAttempts.lockedUntil)
        }::timestamptz ELSE NULL END`,
    },
  });
}

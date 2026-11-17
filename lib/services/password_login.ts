import { authenticateWithPassword, resolveTenantForEmail } from './auth.ts';
import { createSession } from './auth_sessions.ts';
import { recordAuditEvent } from './audit_logs.ts';
import { parseEmailAddress } from './email_address.ts';

/** Complete typed outcome of a password-login attempt before HTTP projection. */
export type CompletePasswordLoginResult =
  | {
    readonly ok: true;
    readonly userId: string;
    readonly tenantId: string;
    readonly mustChangePassword: boolean;
    readonly sessionToken: string;
    readonly sessionExpiresAt: Date;
  }
  | {
    readonly ok: false;
    readonly code:
      | 'invalid_email'
      | 'invalid'
      | 'locked'
      | 'no_membership'
      | 'tenant_mismatch'
      | 'ambiguous_membership'
      | 'unknown';
  }
  | { readonly ok: false; readonly code: 'sso_required'; readonly tenantId: string };

/**
 * Validate credentials, select the request tenant, audit the attempt, and create a session.
 *
 * HTTP adapters remain responsible only for parsing their protocol and projecting this result.
 */
export async function completePasswordLogin(input: {
  readonly email: string;
  readonly password: string;
  readonly hostTenantId: string | null;
  readonly attemptOrigin: string;
  readonly clientIp: string | null;
  readonly userAgent: string | null;
  readonly replaceToken: string | null;
}): Promise<CompletePasswordLoginResult> {
  const email = parseEmailAddress(input.email);
  if (!email) return { ok: false, code: 'invalid_email' };

  const authentication = await authenticateWithPassword({
    email,
    password: input.password,
    attemptOrigin: input.attemptOrigin,
    hostTenantId: input.hostTenantId,
  });
  if (!authentication.ok) {
    const auditTarget = await resolveTenantForEmail(email, input.hostTenantId);
    if (auditTarget.ok) {
      await recordAuditEvent({
        tenantId: auditTarget.tenantId,
        action: 'login_failed',
        actorUserId: auditTarget.userId,
        targetUserId: auditTarget.userId,
        ipAddress: input.clientIp,
        userAgent: input.userAgent,
        metadata: { reason: authentication.code },
      });
    }
    return authentication;
  }

  const session = await createSession({
    userId: authentication.userId,
    tenantId: authentication.tenantId,
    userAgent: input.userAgent,
    ipAddress: input.clientIp,
    replaceToken: input.replaceToken,
  });
  await recordAuditEvent({
    tenantId: authentication.tenantId,
    action: 'login_success',
    actorUserId: authentication.userId,
    targetUserId: authentication.userId,
    ipAddress: input.clientIp,
    userAgent: input.userAgent,
  });

  return {
    ok: true,
    userId: authentication.userId,
    tenantId: authentication.tenantId,
    mustChangePassword: authentication.mustChangePassword,
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAt,
  };
}

import { safeErrorSummary } from '../error_summary.ts';
import {
  provisionLocalUser,
  type ProvisionLocalUserWithWorkspaceResult,
} from './account_provisioning.ts';
import type { SignupWelcomeEmailInput, TransactionalEmailDeliveryResult } from './email.ts';
import { parseEmailAddress } from './email_address.ts';
import type { InterfaceLocale } from '../i18n/locale.ts';

/** Complete typed outcome of public password signup before HTTP projection. */
export type CompletePasswordSignupResult =
  | {
    readonly ok: true;
    readonly code: 'account_created';
    readonly userId: string;
    readonly tenantId: string;
    readonly session: {
      readonly token: string;
      readonly expiresAt: Date;
    };
  }
  | {
    readonly ok: true;
    readonly code: 'account_created_session_failed';
    readonly userId: string;
    readonly tenantId: string;
  }
  | {
    readonly ok: false;
    readonly code: 'invite_required' | 'invalid_email' | 'email_exists' | 'unavailable';
  }
  | {
    readonly ok: false;
    readonly code: 'invalid_password';
    readonly issues: ReadonlyArray<string>;
  };

/** Post-provisioning capabilities required to finish a password signup. */
export type PasswordSignupDependencies = {
  readonly createSession: (input: {
    readonly userId: string;
    readonly tenantId: string;
    readonly userAgent: string | null;
    readonly ipAddress: string | null;
    readonly replaceToken: string | null;
  }) => Promise<{ readonly token: string; readonly expiresAt: Date }>;
  readonly sendWelcomeEmail: (
    input: SignupWelcomeEmailInput,
  ) => Promise<TransactionalEmailDeliveryResult>;
};

/**
 * Validate and provision public password signup, then attempt session creation and welcome email.
 *
 * Session failure is returned as an explicit partial-success result after account creation.
 */
export async function completePasswordSignup(
  input: {
    readonly email: string;
    readonly password: string;
    readonly displayName: string | null;
    readonly hostTenantId: string | null;
    readonly userAgent: string | null;
    readonly clientIp: string | null;
    readonly replaceToken: string | null;
    readonly welcomeSource: SignupWelcomeEmailInput['source'];
    readonly interfaceLocale: InterfaceLocale;
  },
  dependencies: PasswordSignupDependencies,
): Promise<CompletePasswordSignupResult> {
  if (input.hostTenantId) return { ok: false, code: 'invite_required' };
  const email = parseEmailAddress(input.email);
  if (!email) return { ok: false, code: 'invalid_email' };

  let created: ProvisionLocalUserWithWorkspaceResult;
  try {
    created = await provisionLocalUser({
      email,
      password: input.password,
      displayName: input.displayName,
      workspace: { name: 'Workspace', role: 'owner' },
      interfaceLocale: input.interfaceLocale,
    });
  } catch (cause: unknown) {
    console.error(JSON.stringify({
      event: 'signup_account_provisioning_failed',
      cause: safeErrorSummary(cause),
    }));
    return { ok: false, code: 'unavailable' };
  }
  if (!created.ok) return created;

  let session: { readonly token: string; readonly expiresAt: Date };
  try {
    session = await dependencies.createSession({
      userId: created.userId,
      tenantId: created.tenantId,
      userAgent: input.userAgent,
      ipAddress: input.clientIp,
      replaceToken: input.replaceToken,
    });
  } catch (cause: unknown) {
    console.error(JSON.stringify({
      event: 'signup_session_creation_failed',
      userId: created.userId,
      tenantId: created.tenantId,
      cause: safeErrorSummary(cause),
    }));
    await sendWelcomeEmail(dependencies, input, email, created);
    return {
      ok: true,
      code: 'account_created_session_failed',
      userId: created.userId,
      tenantId: created.tenantId,
    };
  }

  await sendWelcomeEmail(dependencies, input, email, created);
  return {
    ok: true,
    code: 'account_created',
    userId: created.userId,
    tenantId: created.tenantId,
    session,
  };
}

async function sendWelcomeEmail(
  dependencies: PasswordSignupDependencies,
  input: {
    readonly displayName: string | null;
    readonly welcomeSource: SignupWelcomeEmailInput['source'];
    readonly interfaceLocale: InterfaceLocale;
  },
  email: string,
  created: Extract<ProvisionLocalUserWithWorkspaceResult, { readonly ok: true }>,
): Promise<void> {
  try {
    await dependencies.sendWelcomeEmail({
      email,
      displayName: input.displayName,
      userId: created.userId,
      tenantId: created.tenantId,
      source: input.welcomeSource,
      interfaceLocale: input.interfaceLocale,
    });
  } catch (cause: unknown) {
    console.error(JSON.stringify({
      event: 'signup_welcome_email_failed',
      userId: created.userId,
      tenantId: created.tenantId,
      cause: safeErrorSummary(cause),
    }));
  }
}

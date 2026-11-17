import { getSessionByToken } from './auth_sessions.ts';
import { parseEmailAddress } from './email_address.ts';
import { getMembershipRole } from './memberships.ts';
import type { OidcProviderOption } from '../oidc_provider.ts';
import type { SsoLoginPolicy, SsoRouteProvider } from '../sso_policy.ts';
import { listConfiguredOidcProvidersForPublicLogin } from './oidc.ts';
import { listConfiguredOidcProvidersForTenant } from './oidc_tenant_configs.ts';
import { completePasswordLogin } from './password_login.ts';
import { getTenantSsoSettings, resolveSsoProviderForEmail } from './sso_policy.ts';
import { resolveTenantIdForHost } from './tenants.ts';
import type { LoginErrorCode } from '../http/auth_feedback.ts';

/** Supported browser login form actions after HTTP boundary parsing. */
export type BrowserLoginAction = 'password' | 'sso';

/** Existing browser-session evidence supplied by the login HTTP adapter. */
export type BrowserLoginSession =
  | { readonly kind: 'absent' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'present'; readonly token: string };

/** Complete view model rendered by the browser login page. */
export type LoginPageData = {
  readonly error:
    | 'credentials_invalid'
    | 'email_invalid'
    | 'too_many_attempts'
    | 'workspace_unassigned'
    | 'workspace_mismatch'
    | 'workspace_address_required'
    | 'password_disabled'
    | 'sign_in_unavailable'
    | 'account_creation_failed'
    | 'account_workspace_mismatch'
    | 'authorization_failed'
    | 'email_required'
    | 'identity_conflict'
    | 'identity_verification_failed'
    | 'login_state_expired'
    | 'missing_authorization_response'
    | 'provider_not_configured'
    | 'token_exchange_failed'
    | null;
  readonly errorField: 'credentials' | 'email' | 'form' | null;
  readonly email: string;
  readonly next: string | null;
  readonly oidcProviders: ReadonlyArray<OidcProviderOption>;
  readonly loginPolicy: SsoLoginPolicy;
  readonly signInUnavailable: boolean;
};

/** Browser-neutral login decision projected to HTML, a redirect, or a session cookie by HTTP. */
export type BrowserLoginResult =
  | {
    readonly kind: 'page';
    readonly data: LoginPageData;
    readonly clearSession: boolean;
  }
  | { readonly kind: 'redirect'; readonly location: string }
  | {
    readonly kind: 'authenticated_redirect';
    readonly location: string;
    readonly sessionToken: string;
    readonly sessionExpiresAt: Date;
  };

/** Parsed browser login submission passed inward from the HTTP route. */
export type BrowserLoginSubmission = {
  readonly action: BrowserLoginAction;
  readonly email: string;
  readonly password: string;
  readonly next: string | null;
  readonly hostname: string;
  readonly attemptOrigin: string;
  readonly clientIp: string | null;
  readonly userAgent: string | null;
  readonly replaceToken: string | null;
};

type LoginPageContext = {
  readonly oidcProviders: ReadonlyArray<OidcProviderOption>;
  readonly loginPolicy: SsoLoginPolicy;
};

type LoginPageState = {
  readonly error: LoginPageData['error'];
  readonly errorField: LoginPageData['errorField'];
  readonly email: string;
  readonly next: string | null;
  readonly signInUnavailable: boolean;
};

/** Parse the submitted login action into the only two supported browser behaviors. */
export function parseBrowserLoginAction(value: FormDataEntryValue | null): BrowserLoginAction {
  return value === 'sso' ? 'sso' : 'password';
}

/** Resolve an initial login-page request, including an existing authenticated session. */
export async function loadBrowserLogin(input: {
  readonly hostname: string;
  readonly error: LoginErrorCode | null;
  readonly next: string | null;
  readonly session: BrowserLoginSession;
}): Promise<BrowserLoginResult> {
  let clearSession = input.session.kind === 'malformed';
  if (input.session.kind === 'present') {
    const session = await getSessionByToken(input.session.token);
    if (!session) {
      clearSession = true;
    } else {
      const role = await getMembershipRole(session.userId, session.tenantId);
      if (role) {
        return {
          kind: 'redirect',
          location: authenticatedLocation(session.mustChangePassword, input.next),
        };
      }
    }
  }

  const context = await resolveLoginPageContext(
    await resolveTenantIdForHost(input.hostname),
  );
  return pageResult(context, {
    error: input.error,
    errorField: input.error ? 'form' : null,
    email: '',
    next: input.next,
    signInUnavailable: false,
  }, clearSession);
}

/** Apply browser login policy and return one complete render or redirect decision. */
export async function submitBrowserLogin(
  input: BrowserLoginSubmission,
): Promise<BrowserLoginResult> {
  const hostTenantId = await resolveTenantIdForHost(input.hostname);
  const context = await resolveLoginPageContext(hostTenantId);
  const submittedEmail = input.email.trim();
  const email = parseEmailAddress(submittedEmail);

  if (input.action === 'sso') {
    return await submitSsoAction(
      context,
      hostTenantId,
      submittedEmail,
      email,
      input.next,
    );
  }

  if (context.loginPolicy === 'require_sso') {
    return await submitRequiredSsoAction(
      context,
      hostTenantId,
      submittedEmail,
      email,
      input.next,
    );
  }

  return await submitPasswordAction(input, context, hostTenantId, submittedEmail, email);
}

/** Build the single unavailable-state page returned after an unexpected login-route failure. */
export function unavailableBrowserLogin(
  next: string | null,
): Extract<BrowserLoginResult, { readonly kind: 'page' }> {
  return {
    kind: 'page',
    clearSession: false,
    data: {
      error: 'sign_in_unavailable',
      errorField: 'form',
      email: '',
      next,
      oidcProviders: [],
      loginPolicy: 'allow_password',
      signInUnavailable: true,
    },
  };
}

async function submitSsoAction(
  context: LoginPageContext,
  tenantId: string | null,
  submittedEmail: string,
  email: string | null,
  next: string | null,
): Promise<BrowserLoginResult> {
  if (!email) {
    return loginErrorPage(
      context,
      submittedEmail,
      next,
      'email_invalid',
      'email',
    );
  }
  const location = await resolveSsoLocation(tenantId, email, next);
  if (location) return { kind: 'redirect', location };
  return loginErrorPage(
    context,
    submittedEmail,
    next,
    'provider_not_configured',
    'email',
  );
}

async function submitRequiredSsoAction(
  context: LoginPageContext,
  tenantId: string | null,
  submittedEmail: string,
  email: string | null,
  next: string | null,
): Promise<BrowserLoginResult> {
  if (!email) {
    return loginErrorPage(
      context,
      submittedEmail,
      next,
      'email_invalid',
      'email',
    );
  }
  const location = await resolveSsoLocation(tenantId, email, next);
  return location
    ? { kind: 'redirect', location }
    : passwordDisabledPage(context, submittedEmail, next);
}

async function submitPasswordAction(
  input: BrowserLoginSubmission,
  context: LoginPageContext,
  hostTenantId: string | null,
  submittedEmail: string,
  email: string | null,
): Promise<BrowserLoginResult> {
  const result = await completePasswordLogin({
    email: submittedEmail,
    password: input.password,
    attemptOrigin: input.attemptOrigin,
    clientIp: input.clientIp,
    hostTenantId,
    replaceToken: input.replaceToken,
    userAgent: input.userAgent,
  });
  if (result.ok) {
    return {
      kind: 'authenticated_redirect',
      location: authenticatedLocation(result.mustChangePassword, input.next),
      sessionToken: result.sessionToken,
      sessionExpiresAt: result.sessionExpiresAt,
    };
  }

  if (result.code === 'sso_required') {
    const tenantContext: LoginPageContext = {
      oidcProviders: await listConfiguredOidcProvidersForTenant(result.tenantId),
      loginPolicy: 'require_sso',
    };
    if (email) {
      const location = await resolveSsoLocation(result.tenantId, email, input.next);
      if (location) return { kind: 'redirect', location };
    }
    return passwordDisabledPage(tenantContext, submittedEmail, input.next);
  }

  const presentation = passwordFailurePresentation(result.code);
  return loginErrorPage(
    context,
    submittedEmail,
    input.next,
    presentation.error,
    presentation.errorField,
  );
}

function passwordFailurePresentation(
  code:
    | 'invalid_email'
    | 'invalid'
    | 'locked'
    | 'no_membership'
    | 'tenant_mismatch'
    | 'ambiguous_membership'
    | 'unknown',
): {
  readonly error: LoginPageData['error'];
  readonly errorField: NonNullable<LoginPageData['errorField']>;
} {
  switch (code) {
    case 'invalid_email':
      return { error: 'email_invalid', errorField: 'email' };
    case 'invalid':
      return { error: 'credentials_invalid', errorField: 'credentials' };
    case 'locked':
      return { error: 'too_many_attempts', errorField: 'form' };
    case 'no_membership':
      return { error: 'workspace_unassigned', errorField: 'form' };
    case 'tenant_mismatch':
      return { error: 'workspace_mismatch', errorField: 'form' };
    case 'ambiguous_membership':
      return { error: 'workspace_address_required', errorField: 'form' };
    case 'unknown':
      return { error: 'credentials_invalid', errorField: 'form' };
  }
}

async function resolveLoginPageContext(tenantId: string | null): Promise<LoginPageContext> {
  if (!tenantId) {
    return {
      oidcProviders: await listConfiguredOidcProvidersForPublicLogin(),
      loginPolicy: 'allow_password',
    };
  }

  const [oidcProviders, ssoSettings] = await Promise.all([
    listConfiguredOidcProvidersForTenant(tenantId),
    getTenantSsoSettings(tenantId),
  ]);
  return { oidcProviders, loginPolicy: ssoSettings.loginPolicy };
}

function loginErrorPage(
  context: LoginPageContext,
  email: string,
  next: string | null,
  error: LoginPageData['error'],
  errorField: NonNullable<LoginPageData['errorField']>,
): BrowserLoginResult {
  return pageResult(context, {
    error,
    errorField,
    email,
    next,
    signInUnavailable: false,
  }, false);
}

function passwordDisabledPage(
  context: LoginPageContext,
  email: string,
  next: string | null,
): BrowserLoginResult {
  return loginErrorPage(
    context,
    email,
    next,
    'password_disabled',
    'form',
  );
}

function pageResult(
  context: LoginPageContext,
  state: LoginPageState,
  clearSession: boolean,
): Extract<BrowserLoginResult, { readonly kind: 'page' }> {
  return {
    kind: 'page',
    clearSession,
    data: {
      ...state,
      oidcProviders: context.oidcProviders,
      loginPolicy: context.loginPolicy,
    },
  };
}

async function resolveSsoLocation(
  tenantId: string | null,
  email: string,
  next: string | null,
): Promise<string | null> {
  if (!tenantId) return null;
  const provider = await resolveSsoProviderForEmail(tenantId, email);
  return provider ? ssoProviderLocation(provider, next) : null;
}

function ssoProviderLocation(provider: SsoRouteProvider, next: string | null): string {
  const suffix = next ? `?next=${encodeURIComponent(next)}` : '';
  return `/auth/oidc/${provider}${suffix}`;
}

function authenticatedLocation(mustChangePassword: boolean, next: string | null): string {
  return mustChangePassword ? '/settings/password?force=1' : next ?? '/assessments';
}

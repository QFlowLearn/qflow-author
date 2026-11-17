import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import type { LoginErrorCode } from '../../auth_feedback.ts';
import { buildSessionCookie, readCookieValue, SESSION_COOKIE_NAME } from '../../cookies.ts';
import { ensureTenantForUser, resolveTenantForUser } from '../../../services/auth.ts';
import { createSession } from '../../../services/auth_sessions.ts';
import { linkExternalIdentity } from '../../../services/identity_linking.ts';
import { recordAuditEvent } from '../../../services/audit_logs.ts';
import { createTransactionalEmailSender } from '../../../services/email.ts';
import {
  exchangeOidcCode,
  type VerifiedOidcIdentity,
  verifyOidcIdToken,
} from '../../../oidc_protocol.ts';
import {
  consumeOidcLoginState,
  getOidcProviderConfigForTenant,
  getPublicOidcTenantId,
} from '../../../services/oidc.ts';
import { parseAuthReturnPath } from '../../auth_return_path.ts';
import { resolveTenantIdForHost } from '../../../services/tenants.ts';
import { getUserSettings } from '../../../services/user_settings.ts';
import { buildLocaleCookie } from '../../../i18n/locale.ts';

/** Shared HTTP contract and implementation for this authentication endpoint. */
export const oidcCallbackAuthRoute = defineHttpRoute('/auth/oidc/callback', { 'GET': handle });

async function handleOidcCallback(ctx: HttpRequest): Promise<Response> {
  const url = ctx.url;
  const state = url.searchParams.get('state');
  if (!state) {
    return redirectWithError(ctx.url, 'missing_authorization_response');
  }

  const loginState = await consumeOidcLoginState(state);
  if (!loginState) {
    return redirectWithError(ctx.url, 'login_state_expired');
  }
  const nextPath = loginState.redirectPath ?? undefined;
  if (url.searchParams.has('error')) {
    return redirectWithError(ctx.url, 'authorization_failed', nextPath);
  }

  const code = url.searchParams.get('code');
  if (!code) {
    return redirectWithError(ctx.url, 'missing_authorization_response', nextPath);
  }

  const hostTenantId = await resolveTenantIdForHost(ctx.url.hostname);
  if (hostTenantId && hostTenantId !== loginState.tenantId) {
    return redirectWithError(ctx.url, 'workspace_mismatch', nextPath);
  }
  const publicOidcTenantId = hostTenantId ? null : await getPublicOidcTenantId();
  const isPublicLogin = !hostTenantId && publicOidcTenantId === loginState.tenantId;

  const config = await getOidcProviderConfigForTenant(
    loginState.tenantId,
    loginState.provider,
    ctx.runtime,
  );
  if (!config) {
    return redirectWithError(ctx.url, 'provider_not_configured', nextPath);
  }

  const redirectUri = new URL('/auth/oidc/callback', ctx.url).toString();

  let tokens: { idToken: string; accessToken?: string };
  try {
    tokens = await exchangeOidcCode({
      config,
      code,
      redirectUri,
    });
  } catch (cause: unknown) {
    console.error(JSON.stringify({
      event: 'oidc_token_exchange_failed',
      cause: safeErrorSummary(cause),
    }));
    return redirectWithError(ctx.url, 'token_exchange_failed', nextPath);
  }

  let claims: VerifiedOidcIdentity;
  try {
    claims = await verifyOidcIdToken({
      config,
      token: tokens.idToken,
      nonce: loginState.nonce,
    });
  } catch (cause: unknown) {
    console.error(JSON.stringify({
      event: 'oidc_identity_verification_failed',
      cause: safeErrorSummary(cause),
    }));
    return redirectWithError(ctx.url, 'identity_verification_failed', nextPath);
  }

  const providerId = `${claims.issuer}|${claims.subject}`;
  const linkResult = await linkExternalIdentity({
    tenantId: isPublicLogin ? null : loginState.tenantId,
    provider: config.id,
    providerId,
    email: claims.email,
    displayName: claims.displayName,
    interfaceLocale: ctx.state.interfaceLocale,
  });

  if (linkResult._tag === 'StoreUnavailable') {
    console.error(JSON.stringify({
      event: 'oidc_identity_store_unavailable',
      operation: linkResult.operation,
      cause: safeErrorSummary(linkResult.cause),
    }));
    return redirectWithError(ctx.url, 'account_creation_failed', nextPath);
  }
  if (linkResult._tag === 'Rejected') {
    const errorCode: LoginErrorCode = linkResult.reason === 'tenant_mismatch'
      ? 'account_workspace_mismatch'
      : linkResult.reason === 'identity_conflict'
      ? 'identity_conflict'
      : linkResult.reason === 'email_required'
      ? 'email_required'
      : 'account_creation_failed';
    return redirectWithError(ctx.url, errorCode, nextPath);
  }
  const userId = linkResult.userId;
  const userSettings = await getUserSettings(userId);

  let sessionTenantId = loginState.tenantId;
  let createdWorkspace = false;
  if (isPublicLogin) {
    const tenant = await resolveTenantForUser(userId, null);
    if (tenant.ok) {
      sessionTenantId = tenant.value.tenantId;
    } else if (tenant.code === 'no_membership') {
      sessionTenantId = await ensureTenantForUser(userId, 'Workspace');
      createdWorkspace = true;
    } else {
      return redirectWithError(ctx.url, 'account_workspace_mismatch', nextPath);
    }
  }

  const existingToken = readCookieValue(
    ctx.req.headers.get('cookie') || '',
    SESSION_COOKIE_NAME,
  ).value;
  const clientIp = ctx.clientIp;

  const session = await createSession({
    userId,
    tenantId: sessionTenantId,
    userAgent: ctx.req.headers.get('user-agent'),
    ipAddress: clientIp,
    replaceToken: existingToken,
  });

  await recordAuditEvent({
    tenantId: sessionTenantId,
    action: 'login_success',
    actorUserId: userId,
    targetUserId: userId,
    ipAddress: clientIp,
    userAgent: ctx.req.headers.get('user-agent'),
    metadata: { provider: config.id, publicLogin: isPublicLogin },
  });

  if (createdWorkspace && claims.email) {
    await createTransactionalEmailSender(ctx.runtime).sendSignupWelcomeEmail({
      email: claims.email.address,
      displayName: claims.displayName,
      userId,
      tenantId: sessionTenantId,
      source: 'public_oidc',
      interfaceLocale: userSettings.interfaceLocale,
    });
  }

  const location = parseAuthReturnPath(loginState.redirectPath) ??
    (createdWorkspace ? '/onboarding' : '/assessments');
  const res = new Response(null, { status: 302, headers: { location } });
  res.headers.append('set-cookie', buildSessionCookie(ctx.url, session.token, session.expiresAt));
  res.headers.append('set-cookie', buildLocaleCookie(ctx.url, userSettings.interfaceLocale));
  return res;
}

function redirectWithError(url: URL, code: LoginErrorCode, next?: string): Response {
  const redirect = new URL('/login', url.origin);
  redirect.searchParams.set('error', code);
  const returnPath = parseAuthReturnPath(next);
  if (returnPath) {
    redirect.searchParams.set('next', returnPath);
  }
  return new Response(null, {
    status: 302,
    headers: { location: redirect.pathname + redirect.search },
  });
}

async function handle(ctx: HttpRequest) {
  try {
    return await handleOidcCallback(ctx);
  } catch (cause: unknown) {
    console.error(JSON.stringify({
      event: 'oidc_callback_error',
      hostname: ctx.url.hostname,
      cause: safeErrorSummary(cause),
    }));
    return redirectWithError(ctx.url, 'sign_in_unavailable');
  }
}

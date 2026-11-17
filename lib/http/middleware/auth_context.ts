import { getEnv } from '../../config.ts';
import { getAssessmentTenantId } from '../../services/assessment_records.ts';
import { getSessionByToken } from '../../services/auth_sessions.ts';
import { getMembershipRole } from '../../services/memberships.ts';
import { resolveTenantIdForHost } from '../../services/tenants.ts';
import type { RuntimeSource } from '../../runtime.ts';
import { type RequestContext, SYSTEM_USER_ID } from '../../tenants.ts';
import { buildSessionClearCookie, readCookieValue, SESSION_COOKIE_NAME } from '../cookies.ts';
import type { AuthRequest } from '../auth_request.ts';
import { resolveInterfaceLocale } from '../../i18n/locale.ts';
import { catalogForLocale } from '../../i18n/catalogs.ts';
import { createI18n, type I18n } from '../../i18n/messages.ts';
import { getUserSettings } from '../../services/user_settings.ts';
import { requestErrorResponse } from '../request_error_response.ts';

type AuthFailure =
  | 'unauthorized'
  | 'tenant_mismatch'
  | 'membership_required'
  | 'password_change_required';

type AuthResult =
  | { ok: true; auth: RequestContext }
  | { ok: false; response: Response };

export async function resolveAuthContext(
  ctx: AuthRequest,
  opts: { allowPasswordChangeRequired: boolean },
): Promise<AuthResult> {
  const runner = await resolveRunnerContext(ctx);
  if (runner.response) return { ok: false, response: runner.response };

  const sessionCookie = readCookieValue(
    ctx.req.headers.get('cookie') || '',
    SESSION_COOKIE_NAME,
  );
  const sessionToken = sessionCookie.value;
  if (!sessionToken) {
    if (runner.auth) {
      return { ok: true, auth: runner.auth };
    }
    const response = authFailureResponse(ctx, 'unauthorized');
    if (sessionCookie.kind === 'malformed') {
      response.headers.append('set-cookie', buildSessionClearCookie(ctx.url));
    }
    return { ok: false, response };
  }

  const session = await getSessionByToken(sessionToken);
  if (!session) {
    if (runner.auth) {
      return { ok: true, auth: runner.auth };
    }
    const res = authFailureResponse(ctx, 'unauthorized');
    res.headers.append('set-cookie', buildSessionClearCookie(ctx.url));
    return { ok: false, response: res };
  }

  if (runner.auth) {
    return { ok: true, auth: runner.auth };
  }

  const hostTenantId = await resolveTenantIdForHost(ctx.url.hostname);
  if (hostTenantId && hostTenantId !== session.tenantId) {
    const i18n = ctx.url.pathname.startsWith('/api/') ? undefined : await humanI18n(session.userId);
    return { ok: false, response: authFailureResponse(ctx, 'tenant_mismatch', i18n) };
  }

  const role = await getMembershipRole(session.userId, session.tenantId);
  if (!role) {
    const i18n = ctx.url.pathname.startsWith('/api/') ? undefined : await humanI18n(session.userId);
    return { ok: false, response: authFailureResponse(ctx, 'membership_required', i18n) };
  }

  if (session.mustChangePassword && !opts.allowPasswordChangeRequired) {
    return {
      ok: false,
      response: authFailureResponse(ctx, 'password_change_required'),
    };
  }

  return { ok: true, auth: { tenantId: session.tenantId, userId: session.userId, role } };
}

async function humanI18n(userId: string): Promise<I18n> {
  const locale = (await getUserSettings(userId)).interfaceLocale;
  return createI18n(locale, catalogForLocale(locale));
}

export function parseRunnerAssessmentId(pathname: string): string | null {
  const match = pathname.match(/^\/api\/assessments\/([^/]+)\/package\/?$/);
  if (!match) return null;
  const rawId = match[1] || '';
  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
}

export function runnerPskIsValid(
  req: Request,
  assessmentId: string | null,
  runtime?: RuntimeSource,
): boolean {
  if (!assessmentId) return false;
  const header = req.headers.get('x-runner-key')?.trim();
  const expected = getEnv('QFLOW_RUNNER_KEY', runtime);
  return Boolean(header && expected && header === expected);
}

function authFailureResponse(ctx: AuthRequest, failure: AuthFailure, i18n?: I18n): Response {
  if (failure === 'password_change_required') return passwordChangeRequiredResponse(ctx.url);
  if (failure === 'tenant_mismatch') return tenantMismatchResponse(ctx, i18n);
  if (failure === 'membership_required') return membershipMissingResponse(ctx, i18n);
  return unauthorizedResponse(ctx.url);
}

async function resolveRunnerContext(
  ctx: AuthRequest,
): Promise<{ auth?: RequestContext; response?: Response }> {
  const assessmentId = parseRunnerAssessmentId(ctx.url.pathname);
  if (!assessmentId) return {};
  if (!runnerPskIsValid(ctx.req, assessmentId, ctx.runtime)) return {};

  const hostTenantId = await resolveTenantIdForHost(ctx.url.hostname);
  const tenantId = await getAssessmentTenantId(assessmentId);
  if (!tenantId) return { response: unauthorizedResponse(ctx.url) };
  if (hostTenantId && hostTenantId !== tenantId) {
    return { response: tenantMismatchResponse(ctx) };
  }
  return {
    auth: { tenantId, userId: SYSTEM_USER_ID, role: 'teaching_assistant' },
  };
}

function unauthorizedResponse(url: URL): Response {
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  const loginUrl = new URL('/login', url.origin);
  loginUrl.searchParams.set('next', url.pathname + url.search);
  return new Response(null, {
    status: 302,
    headers: { location: loginUrl.pathname + loginUrl.search },
  });
}

function tenantMismatchResponse(ctx: AuthRequest, i18n?: I18n): Response {
  if (ctx.url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'tenant_mismatch' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }
  return requestErrorResponse(i18n ?? fallbackI18n(ctx), 'workspace_mismatch', 403);
}

function membershipMissingResponse(ctx: AuthRequest, i18n?: I18n): Response {
  if (ctx.url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'membership_required' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }
  return requestErrorResponse(i18n ?? fallbackI18n(ctx), 'membership_required', 403);
}

function fallbackI18n(ctx: AuthRequest): I18n {
  const locale = resolveInterfaceLocale(
    null,
    ctx.req.headers.get('cookie'),
    ctx.req.headers.get('accept-language'),
  );
  return createI18n(locale, catalogForLocale(locale));
}

function passwordChangeRequiredResponse(url: URL): Response {
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'password_change_required' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }
  const redirect = new URL('/settings/password', url.origin);
  redirect.searchParams.set('force', '1');
  return new Response(null, {
    status: 302,
    headers: { location: redirect.pathname + redirect.search },
  });
}

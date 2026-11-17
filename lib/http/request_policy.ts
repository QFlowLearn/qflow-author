import type { AuthRequest } from './auth_request.ts';
import type { AppState } from './app_state.ts';
import type { QflowRuntimeState } from '../runtime.ts';
import {
  parseRunnerAssessmentId,
  resolveAuthContext,
  runnerPskIsValid,
} from './middleware/auth_context.ts';
import { shouldRejectCsrf } from './middleware/csrf.ts';
import {
  isPasswordChangeAllowedPath,
  isPublicPath,
  requiresContentWriteRole,
} from './middleware/route_policy.ts';
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
} from './middleware/response_security.ts';
import { requireContentWrite } from '../services/roles.ts';
import { type RequestContext, SYSTEM_USER_ID } from '../tenants.ts';
import { getUserSettings } from '../services/user_settings.ts';
import {
  buildLocaleCookie,
  type InterfaceLocale,
  matchAcceptLanguage,
  resolveInterfaceLocale,
} from '../i18n/locale.ts';
import { catalogForLocale } from '../i18n/catalogs.ts';
import { createI18n } from '../i18n/messages.ts';

type RequestResolution =
  | { readonly kind: 'respond'; readonly response: Response; readonly locale: InterfaceLocale }
  | { readonly kind: 'continue'; readonly state: AppState; readonly locale: InterfaceLocale };

/** Anonymous preferences also determine the locale of early failures. */
export function requestLocale(req: Request): InterfaceLocale {
  const path = new URL(req.url).pathname;
  if (path === '/password/forgot' || path === '/password/reset') {
    return matchAcceptLanguage(req.headers.get('accept-language'));
  }
  return resolveInterfaceLocale(
    null,
    req.headers.get('cookie'),
    req.headers.get('accept-language'),
  );
}

/** Own CSRF, authentication, locale and write access policy for both HTTP frameworks. */
export async function resolveRequest(
  request: AuthRequest,
  target: QflowRuntimeState = {},
): Promise<RequestResolution> {
  const { req, url, runtime } = request;
  const path = url.pathname;
  const provisionalLocale = requestLocale(req);
  const runnerAllowed = runnerPskIsValid(req, parseRunnerAssessmentId(path), runtime);
  if (shouldRejectCsrf(req, url, runnerAllowed)) {
    const text = path.startsWith('/api/')
      ? 'CSRF check failed'
      : createI18n(provisionalLocale, catalogForLocale(provisionalLocale)).t(
        'core.errors.csrfFailed',
      );
    return {
      kind: 'respond',
      response: new Response(text, { status: 403 }),
      locale: provisionalLocale,
    };
  }
  let auth: RequestContext | undefined;
  let locale = provisionalLocale;
  if (!isPublicPath(path)) {
    const result = await resolveAuthContext(request, {
      allowPasswordChangeRequired: isPasswordChangeAllowedPath(path),
    });
    if (!result.ok) return { kind: 'respond', response: result.response, locale };
    auth = result.auth;
    if (auth.userId !== SYSTEM_USER_ID) {
      locale = (await getUserSettings(auth.userId)).interfaceLocale;
    }
  }
  const catalog = catalogForLocale(locale);
  const state = Object.assign(target, {
    runtime: { bindings: runtime.bindings, state: target },
    auth,
    interfaceLocale: locale,
    catalog,
    i18n: createI18n(locale, catalog),
  });
  for (const key of ['interfaceLocale', 'catalog', 'i18n'] as const) {
    Object.defineProperty(state, key, { writable: false, configurable: false });
  }
  if (auth && requiresContentWriteRole(path)) {
    const denied = requireContentWrite(auth.role, req, state.i18n);
    if (denied) return { kind: 'respond', response: denied, locale };
  }
  return { kind: 'continue', state, locale };
}

/** Apply locale headers/cookie only to localized HTML responses. */
export function applyLocalizedResponseHeaders(
  url: URL,
  response: Response,
  cookieLocale: InterfaceLocale | null,
  locale: InterfaceLocale,
): Response {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/html')) return response;
  response.headers.set('content-language', locale);
  if (cookieLocale !== locale) {
    response.headers.append('set-cookie', buildLocaleCookie(url, locale));
  }
  return response;
}

/** Harden successful, rejected and failed responses while preserving stricter route-owned headers. */
export function finalizeResponse(
  url: URL,
  response: Response,
  cookieLocale: InterfaceLocale | null,
  locale: InterfaceLocale,
): Response {
  applySecurityHeaders(url, response);
  if (!response.headers.has('content-security-policy')) {
    response.headers.set('content-security-policy', buildContentSecurityPolicy().join('; '));
  }
  return applyLocalizedResponseHeaders(url, response, cookieLocale, locale);
}

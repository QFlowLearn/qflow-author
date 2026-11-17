import LoginPage from '../../../../components/auth/LoginPage.tsx';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { loginErrorMessage } from '../../auth_feedback.ts';
import { parseAuthReturnPath } from '../../auth_return_path.ts';
import {
  buildSessionClearCookie,
  buildSessionCookie,
  type CookieValue,
  readCookieValue,
  SESSION_COOKIE_NAME,
} from '../../cookies.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import {
  type BrowserLoginResult,
  type BrowserLoginSession,
  loadBrowserLogin,
  parseBrowserLoginAction,
  submitBrowserLogin,
  unavailableBrowserLogin,
} from '../../../services/browser_login.ts';

const methods = {
  async GET(ctx: HttpRequest) {
    try {
      const returnPath = parseAuthReturnPath(ctx.url.searchParams.get('next'));
      const sessionCookie = readCookieValue(
        ctx.req.headers.get('cookie') || '',
        SESSION_COOKIE_NAME,
      );
      const result = await loadBrowserLogin({
        hostname: ctx.url.hostname,
        error: loginErrorMessage(ctx.url.searchParams.get('error')),
        next: returnPath,
        session: toBrowserLoginSession(sessionCookie),
      });
      return await projectBrowserLogin(ctx, result);
    } catch (error) {
      return await renderSignInUnavailable(ctx, error);
    }
  },
  async POST(ctx: HttpRequest) {
    try {
      const form = await ctx.req.formData();
      const email = String(form.get('email') ?? '').trim();
      const next = parseAuthReturnPath(form.get('next'));
      const existingToken = readCookieValue(
        ctx.req.headers.get('cookie') || '',
        SESSION_COOKIE_NAME,
      ).value;
      const clientIp = ctx.clientIp;
      const result = await submitBrowserLogin({
        action: parseBrowserLoginAction(form.get('action')),
        email,
        password: String(form.get('password') ?? ''),
        next,
        hostname: ctx.url.hostname,
        attemptOrigin: clientIp ?? 'unknown',
        clientIp,
        replaceToken: existingToken,
        userAgent: ctx.req.headers.get('user-agent'),
      });
      return await projectBrowserLogin(ctx, result);
    } catch (error) {
      return await renderSignInUnavailable(ctx, error);
    }
  },
};

export const loginRoute = defineHttpRoute('/login', {
  GET: methods.GET,
  HEAD: methods.GET,
  POST: methods.POST,
});

type LoginHandlerContext = HttpRequest;

async function projectBrowserLogin(
  ctx: LoginHandlerContext,
  result: BrowserLoginResult,
): Promise<Response> {
  switch (result.kind) {
    case 'page': {
      const response = await ctx.render(
        <LoginPage data={result.data} i18n={ctx.state.i18n} />,
      );
      if (result.clearSession) {
        response.headers.append('set-cookie', buildSessionClearCookie(ctx.url));
      }
      return response;
    }
    case 'redirect':
      return new Response(null, { status: 302, headers: { location: result.location } });
    case 'authenticated_redirect': {
      const response = new Response(null, {
        status: 302,
        headers: { location: result.location },
      });
      response.headers.append(
        'set-cookie',
        buildSessionCookie(ctx.url, result.sessionToken, result.sessionExpiresAt),
      );
      return response;
    }
  }
}

function toBrowserLoginSession(cookie: CookieValue): BrowserLoginSession {
  switch (cookie.kind) {
    case 'absent':
      return { kind: 'absent' };
    case 'malformed':
      return { kind: 'malformed' };
    case 'present':
      return { kind: 'present', token: cookie.value };
  }
}

async function renderSignInUnavailable(
  ctx: LoginHandlerContext,
  error: unknown,
): Promise<Response> {
  console.error(JSON.stringify({
    event: 'login_route_error',
    hostname: ctx.url.hostname,
    cause: safeErrorSummary(error),
  }));
  const result = unavailableBrowserLogin(
    parseAuthReturnPath(ctx.url.searchParams.get('next')),
  );
  return await ctx.render(
    <LoginPage data={result.data} i18n={ctx.state.i18n} />,
    503,
  );
}

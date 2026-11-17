import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { buildSessionCookie, readCookieValue, SESSION_COOKIE_NAME } from '../../cookies.ts';
import { completePasswordLogin } from '../../../services/password_login.ts';
import { resolveTenantIdForHost } from '../../../services/tenants.ts';
import { buildLocaleCookie } from '../../../i18n/locale.ts';
import { getUserSettings } from '../../../services/user_settings.ts';

function json(body: Record<string, unknown>, status = 200, headers?: Headers) {
  const hdrs = headers ?? new Headers();
  hdrs.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers: hdrs });
}

async function parsePayload(req: Request): Promise<{ email: string; password: string } | null> {
  const type = req.headers.get('content-type') ?? '';
  let body: unknown;
  if (type.includes('application/json')) {
    body = await req.json();
  } else {
    const form = await req.formData();
    body = { email: form.get('email'), password: form.get('password') };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const email = Reflect.get(body, 'email') ?? '';
  const password = Reflect.get(body, 'password') ?? '';
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  return { email, password };
}

/** Shared HTTP contract and implementation for this authentication endpoint. */
export const loginAuthRoute = defineHttpRoute('/api/auth/login', { 'POST': handle });

async function handle(ctx: HttpRequest) {
  const { req } = ctx;

  const existingToken = readCookieValue(
    req.headers.get('cookie') || '',
    SESSION_COOKIE_NAME,
  ).value;

  const payload = await parsePayload(req).catch(() => null);
  if (!payload) return json({ error: 'Invalid payload.' }, 400);

  const email = payload.email.trim();
  const clientIp = ctx.clientIp;
  const hostTenantId = await resolveTenantIdForHost(ctx.url.hostname);
  const result = await completePasswordLogin({
    email,
    password: payload.password,
    attemptOrigin: clientIp ?? 'unknown',
    clientIp,
    hostTenantId,
    replaceToken: existingToken,
    userAgent: req.headers.get('user-agent'),
  });
  if (!result.ok) {
    if (result.code === 'invalid_email') {
      return json({ error: 'Enter a valid email address.' }, 400);
    }
    if (result.code === 'locked') {
      return json({ error: 'Too many attempts. Try again later.' }, 429);
    }
    if (result.code === 'no_membership') {
      return json({ error: 'Account is not assigned to a workspace.' }, 403);
    }
    if (result.code === 'sso_required') {
      return json({ error: 'Password sign-in is disabled. Use SSO.', code: 'sso_required' }, 403);
    }
    if (result.code === 'tenant_mismatch') {
      return json({ error: 'Account belongs to a different workspace.' }, 403);
    }
    if (result.code === 'ambiguous_membership') {
      return json({ error: 'Use a workspace-specific sign-in address.' }, 409);
    }
    return json({ error: 'Invalid email or password.' }, 401);
  }

  const headers = new Headers();
  headers.append(
    'set-cookie',
    buildSessionCookie(ctx.url, result.sessionToken, result.sessionExpiresAt),
  );
  const settings = await getUserSettings(result.userId);
  headers.append('set-cookie', buildLocaleCookie(ctx.url, settings.interfaceLocale));
  return json(
    {
      ok: true,
      userId: result.userId,
      tenantId: result.tenantId,
      requirePasswordChange: result.mustChangePassword,
    },
    200,
    headers,
  );
}

import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { buildSessionCookie, readCookieValue, SESSION_COOKIE_NAME } from '../../cookies.ts';
import { createSession } from '../../../services/auth_sessions.ts';
import { createTransactionalEmailSender } from '../../../services/email.ts';
import { completePasswordSignup } from '../../../services/password_signup.ts';
import { resolveTenantIdForHost } from '../../../services/tenants.ts';
import { buildLocaleCookie } from '../../../i18n/locale.ts';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function parsePayload(
  req: Request,
): Promise<{ email: string; password: string; name?: string } | null> {
  const type = req.headers.get('content-type') ?? '';
  let body: unknown;
  if (type.includes('application/json')) {
    body = await req.json();
  } else {
    const form = await req.formData();
    body = {
      email: form.get('email'),
      password: form.get('password'),
      name: form.get('name') ?? undefined,
    };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const email = Reflect.get(body, 'email') ?? '';
  const password = Reflect.get(body, 'password') ?? '';
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  const name: unknown = Reflect.get(body, 'name');
  if (name !== undefined && typeof name !== 'string') return null;
  return { email, password, name };
}

/** Shared HTTP contract and implementation for this authentication endpoint. */
export const signupAuthRoute = defineHttpRoute('/api/auth/signup', { 'POST': handle });

async function handle(ctx: HttpRequest) {
  const { req } = ctx;

  const existingToken = readCookieValue(
    req.headers.get('cookie') || '',
    SESSION_COOKIE_NAME,
  ).value;

  const payload = await parsePayload(req).catch(() => null);
  if (!payload) return json({ error: 'Invalid payload.' }, 400);

  const email = payload.email.trim();
  const locale = ctx.state.interfaceLocale;
  const password = payload.password;
  const hostTenantId = await resolveTenantIdForHost(ctx.url.hostname);
  const result = await completePasswordSignup({
    email,
    password,
    displayName: payload.name?.trim() || null,
    hostTenantId,
    userAgent: req.headers.get('user-agent'),
    clientIp: ctx.clientIp,
    replaceToken: existingToken,
    welcomeSource: 'password_api',
    interfaceLocale: locale,
  }, {
    createSession,
    sendWelcomeEmail: (input) =>
      createTransactionalEmailSender(ctx.runtime).sendSignupWelcomeEmail(input),
  });
  if (!result.ok) {
    if (result.code === 'invalid_password') {
      return json({ error: result.issues[0], issues: result.issues }, 400);
    }
    if (result.code === 'invite_required') {
      return json({ error: 'This workspace requires an invite.' }, 403);
    }
    if (result.code === 'invalid_email') {
      return json({ error: 'Enter a valid email address.' }, 400);
    }
    if (result.code === 'email_exists') {
      return json({ error: 'Email is already registered.' }, 409);
    }
    return json({ error: 'Signup failed. Please try again.' }, 500);
  }

  if (result.code === 'account_created_session_failed') {
    return json(
      {
        ok: true,
        code: result.code,
        userId: result.userId,
        tenantId: result.tenantId,
      },
      201,
    );
  }

  const res = json({
    ok: true,
    code: result.code,
    userId: result.userId,
    tenantId: result.tenantId,
  });
  res.headers.append(
    'set-cookie',
    buildSessionCookie(ctx.url, result.session.token, result.session.expiresAt),
  );
  res.headers.append('set-cookie', buildLocaleCookie(ctx.url, locale));
  return res;
}

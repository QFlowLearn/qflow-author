import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { createPasswordServices } from '../../../services/password_services_runtime.ts';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'referrer-policy': 'no-referrer',
    },
  });
}

/** Shared HTTP contract and implementation for this authentication endpoint. */
export const resetConfirmAuthRoute = defineHttpRoute('/api/auth/password/reset/confirm', {
  'POST': handle,
});

function readPayload(body: unknown): { token: string; password: string } | null {
  if (!body || typeof body !== 'object') return null;
  const token = Reflect.get(body, 'token');
  const password = Reflect.get(body, 'password');
  if (typeof token !== 'string' || typeof password !== 'string') return null;
  return { token: token.trim(), password };
}

async function handle(ctx: HttpRequest) {
  const { req } = ctx;

  const body: unknown = await req.json().catch(() => null);
  const payload = readPayload(body);
  if (!payload) return json({ error: 'Invalid payload.' }, 400);
  const token = payload.token;
  const password = payload.password;
  if (!token) return json({ error: 'Token is required.' }, 400);
  const result = await createPasswordServices(ctx.runtime).confirmReset({
    token,
    password,
    ipAddress: ctx.clientIp,
    userAgent: req.headers.get('user-agent'),
  });
  if (!result.ok) {
    const error = result.code === 'invalid_password'
      ? result.issues[0]
      : 'Reset token is invalid or expired.';
    return json(
      result.code === 'invalid_password' ? { error, issues: result.issues } : { error },
      400,
    );
  }
  return json({ ok: true });
}

import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { buildSessionCookie } from '../../cookies.ts';
import { createPasswordServices } from '../../../services/password_services_runtime.ts';
import { requireAuthContext } from '../../../tenants.ts';

function json(body: Record<string, unknown>, status = 200, headers?: Headers) {
  const hdrs = headers ?? new Headers();
  hdrs.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers: hdrs });
}

/** Shared HTTP contract and implementation for this authentication endpoint. */
export const passwordChangeAuthRoute = defineHttpRoute('/api/auth/password/change', {
  'POST': handle,
});

function readPayload(body: unknown): { currentPassword: string; newPassword: string } | null {
  if (!body || typeof body !== 'object') return null;
  const currentPassword = Reflect.get(body, 'currentPassword');
  const newPassword = Reflect.get(body, 'newPassword');
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') return null;
  return { currentPassword, newPassword };
}

async function handle(ctx: HttpRequest) {
  const { req } = ctx;

  const body: unknown = await req.json().catch(() => null);
  const payload = readPayload(body);
  if (!payload) return json({ error: 'Invalid payload.' }, 400);
  const currentPassword = payload.currentPassword;
  const nextPassword = payload.newPassword;
  const auth = requireAuthContext(ctx.state);
  const userId = auth.userId;
  const tenantId = auth.tenantId;
  const result = await createPasswordServices(ctx.runtime).changePassword({
    userId,
    tenantId,
    currentPassword,
    newPassword: nextPassword,
    userAgent: req.headers.get('user-agent'),
    ipAddress: ctx.clientIp,
  });
  if (!result.ok) {
    const error = result.code === 'invalid_new_password'
      ? result.issues[0]
      : 'Current password is incorrect.';
    return json(
      result.code === 'invalid_new_password' ? { error, issues: result.issues } : { error },
      result.code === 'invalid_current_password' ? 401 : 400,
    );
  }
  const headers = new Headers();
  headers.append('set-cookie', buildSessionCookie(ctx.url, result.token, result.expiresAt));
  return json({ ok: true }, 200, headers);
}

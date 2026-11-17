import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { type EmailAddress, parseEmailAddress } from '../../../services/email_address.ts';
import {
  createPasswordServices,
  PASSWORD_RESET_REQUEST_MESSAGE,
} from '../../../services/password_services_runtime.ts';
import { resolveTenantIdForHost } from '../../../services/tenants.ts';

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
export const resetRequestAuthRoute = defineHttpRoute('/api/auth/password/reset/request', {
  'POST': handle,
});

function readEmail(body: unknown): EmailAddress | null {
  if (!body || typeof body !== 'object') return null;
  const email = Reflect.get(body, 'email');
  if (typeof email !== 'string') return null;
  return parseEmailAddress(email);
}

async function handle(ctx: HttpRequest) {
  const { req } = ctx;

  const body: unknown = await req.json().catch(() => null);
  const email = readEmail(body);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400);

  const result = await createPasswordServices(ctx.runtime).requestReset({
    email,
    hostTenantId: await resolveTenantIdForHost(ctx.url.hostname),
    clientIp: ctx.clientIp,
    userAgent: req.headers.get('user-agent'),
  });
  if (!result.ok) {
    console.error(JSON.stringify({
      event: 'password_reset_request_not_sent',
      reason: result.code,
    }));
  }
  return json({ ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE }, 202);
}

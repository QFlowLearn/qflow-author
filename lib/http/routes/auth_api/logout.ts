import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { buildSessionClearCookie, readCookieValue, SESSION_COOKIE_NAME } from '../../cookies.ts';
import { getSessionByToken, revokeSessionByToken } from '../../../services/auth_sessions.ts';
import { recordAuditEvent } from '../../../services/audit_logs.ts';

async function handle(ctx: HttpRequest): Promise<Response> {
  const { req } = ctx;
  const token = readCookieValue(req.headers.get('cookie') || '', SESSION_COOKIE_NAME).value;
  if (token) {
    const session = await getSessionByToken(token);
    if (session) {
      await recordAuditEvent({
        tenantId: session.tenantId,
        action: 'logout',
        actorUserId: session.userId,
        targetUserId: session.userId,
        ipAddress: ctx.clientIp,
        userAgent: req.headers.get('user-agent'),
      });
    }
    await revokeSessionByToken(token);
  }
  const res = new Response(null, { status: 204 });
  res.headers.append('set-cookie', buildSessionClearCookie(ctx.url));
  return res;
}

export const logoutRoute = defineHttpRoute('/api/auth/logout', { POST: handle });

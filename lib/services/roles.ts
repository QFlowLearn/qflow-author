import { hasCapability, type Role, roleAtLeast } from '../roles.ts';
import { requestErrorResponse } from '../http/request_error_response.ts';
import type { I18n } from '../i18n/messages.ts';

function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function forbiddenResponse(req: Request, i18n?: I18n): Response {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }
  return i18n
    ? requestErrorResponse(i18n, 'forbidden', 403)
    : new Response('Forbidden', { status: 403 });
}

export function requireRole(minimum: Role, role: Role, req: Request, i18n?: I18n): Response | null {
  if (!roleAtLeast(role, minimum)) return forbiddenResponse(req, i18n);
  return null;
}

export function requireContentWrite(role: Role, req: Request, i18n?: I18n): Response | null {
  if (isSafeMethod(req.method)) return null;
  if (!hasCapability(role, 'manage_content')) return forbiddenResponse(req, i18n);
  return null;
}

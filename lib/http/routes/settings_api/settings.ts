import { parseUserSettingsPatch } from '../../../settings.ts';
import { getUserSettings, saveUserSettings } from '../../../services/user_settings.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { buildLocaleCookie } from '../../../i18n/locale.ts';

async function read(ctx: HttpRequest): Promise<Response> {
  const auth = requireAuthContext(ctx.state);
  const uid = auth.userId;
  const hdrs = new Headers({ 'content-type': 'application/json' });

  const settings = await getUserSettings(uid);
  return new Response(JSON.stringify(settings), { headers: hdrs });
}

async function write(ctx: HttpRequest): Promise<Response> {
  const { req } = ctx;
  const uid = requireAuthContext(ctx.state).userId;
  const hdrs = new Headers({ 'content-type': 'application/json' });
  const body: unknown = await req.json().catch(() => null);
  const patch = parseUserSettingsPatch(body);
  if (patch === null) return new Response('Invalid settings', { status: 400 });
  const current = await getUserSettings(uid);
  const next = { ...current, ...patch };
  await saveUserSettings(uid, next);
  hdrs.append('set-cookie', buildLocaleCookie(ctx.url, next.interfaceLocale));
  return new Response(JSON.stringify(next), { headers: hdrs });
}

export const settingsRoute = defineHttpRoute('/api/settings', {
  GET: read,
  PUT: write,
  PATCH: write,
});

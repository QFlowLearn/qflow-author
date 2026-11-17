import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { buildLocaleCookie, parseInterfaceLocale } from '../../../i18n/locale.ts';
import { parseAuthReturnPath } from '../../auth_return_path.ts';

function localeError(
  code: 'method_not_allowed' | 'invalid_locale_form' | 'invalid_locale',
  status = 400,
): Response {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Explicit signed-out interface-locale mutation endpoint. */
async function mutateLocale(ctx: HttpRequest) {
  const form = await ctx.req.formData().catch(() => null);
  return localeMutationResponse(ctx.url, form);
}

/** Project a validated locale form into the signed-out redirect response. */
export function localeMutationResponse(url: URL, form: FormData | null): Response {
  if (!form || form.getAll('locale').length !== 1 || form.getAll('next').length > 1) {
    return localeError('invalid_locale_form');
  }
  const locale = parseInterfaceLocale(form?.get('locale'));
  if (!locale) return localeError('invalid_locale');
  const submittedNext = form.get('next');
  const next = typeof submittedNext === 'string' && /[\r\n]/.test(submittedNext)
    ? '/login'
    : parseAuthReturnPath(submittedNext) ?? '/login';
  const headers = new Headers({ location: next });
  headers.append('set-cookie', buildLocaleCookie(url, locale));
  return new Response(null, { status: 303, headers });
}

/** Shared signed-out locale mutation, preserving the closed JSON error contract. */
export const localeRoute = defineHttpRoute(
  '/api/locale',
  { POST: mutateLocale },
  {
    methodNotAllowedBody: JSON.stringify({ code: 'method_not_allowed' }),
    methodNotAllowedHeaders: { 'content-type': 'application/json' },
  },
);

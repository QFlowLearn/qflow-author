import { getEnv } from '../config.ts';

/** Name of the application session cookie. */
export const SESSION_COOKIE_NAME = 'qflow_session';

/** Result of reading one URL-encoded cookie value from an HTTP Cookie header. */
export type CookieValue =
  | { readonly kind: 'absent'; readonly value: null }
  | { readonly kind: 'malformed'; readonly value: null }
  | { readonly kind: 'present'; readonly value: string };

/** Read one cookie without allowing invalid percent encoding to escape the HTTP boundary. */
export function readCookieValue(cookieHeader: string, name: string): CookieValue {
  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=');
    if (separator < 0) continue;
    if (segment.slice(0, separator).trim() !== name) continue;

    const encodedValue = segment.slice(separator + 1);
    try {
      return { kind: 'present', value: decodeURIComponent(encodedValue) };
    } catch (_cause: unknown) {
      return { kind: 'malformed', value: null };
    }
  }
  return { kind: 'absent', value: null };
}

/** Build the hardened session cookie written by authentication HTTP adapters. */
export function buildSessionCookie(url: URL, token: string, expiresAt: Date): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  let cookie = `${SESSION_COOKIE_NAME}=${
    encodeURIComponent(token)
  }; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Priority=High`;
  const domain = getSessionCookieDomain();
  if (domain) cookie += `; Domain=${domain}`;
  if (shouldUseSecureCookies(url)) cookie += '; Secure';
  return cookie;
}

/** Build a cookie that immediately clears the application session. */
export function buildSessionClearCookie(url: URL): string {
  let cookie = `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Priority=High`;
  const domain = getSessionCookieDomain();
  if (domain) cookie += `; Domain=${domain}`;
  if (shouldUseSecureCookies(url)) cookie += '; Secure';
  return cookie;
}

function shouldUseSecureCookies(url: URL): boolean {
  const env = getEnv('QFLOW_SECURE_COOKIES');
  if (env) return env === 'true';
  return url.protocol === 'https:';
}

function getSessionCookieDomain(): string | null {
  const raw = getEnv('QFLOW_COOKIE_DOMAIN') ?? getEnv('QFLOW_ROOT_DOMAIN');
  if (!raw) return null;
  return raw.startsWith('.') ? raw.slice(1) : raw;
}

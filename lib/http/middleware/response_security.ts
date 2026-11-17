/** Apply browser security headers while preserving stricter route-owned policy. */
export function applySecurityHeaders(url: URL, res: Response): Response {
  if (!res.headers.get('x-content-type-options')) {
    res.headers.set('x-content-type-options', 'nosniff');
  }
  if (!res.headers.get('referrer-policy')) {
    res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  }
  if (!res.headers.get('permissions-policy')) {
    res.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  }
  if (!res.headers.get('x-frame-options')) {
    res.headers.set('x-frame-options', 'DENY');
  }
  if (url.protocol === 'https:' && !res.headers.get('strict-transport-security')) {
    res.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
  return res;
}
const CSP_BASE = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
] as const;

/** Frameworks declare their script protocol; application directives have one owner. */
export function buildContentSecurityPolicy(scriptSources: readonly string[] = []): string[] {
  return [...CSP_BASE, ["script-src 'self' 'unsafe-inline'", ...scriptSources].join(' ')];
}

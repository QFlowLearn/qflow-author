const RETURN_PATH_ORIGIN = 'https://qflow.invalid';
const AUTH_ENTRY_PATHS = new Set(['/login', '/signup']);

/**
 * Accepts a same-origin application path for use after authentication.
 */
export function parseAuthReturnPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return null;
  }

  try {
    const parsed = new URL(candidate, RETURN_PATH_ORIGIN);
    if (parsed.origin !== RETURN_PATH_ORIGIN || AUTH_ENTRY_PATHS.has(parsed.pathname)) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

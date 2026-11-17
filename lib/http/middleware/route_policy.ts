const PUBLIC_EXACT_PATHS = new Set([
  '/',
  '/health',
  '/login',
  '/signup',
  '/help/portability',
  '/help/qti-fidelity',
  '/help/qti3-import',
  '/help/qti-sample-report',
  '/password/forgot',
  '/password/reset',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/locale',
  '/api/auth/password/reset/request',
  '/api/auth/password/reset/confirm',
]);

const PUBLIC_PREFIXES = [
  '/_fresh',
  '/assets',
  '/static',
  '/favicon',
  '/auth/oidc',
];

const PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
  '/settings/password',
  '/api/auth/password/change',
  '/api/auth/logout',
  '/api/me',
  '/api/settings',
]);

const CONTENT_WRITE_PAGE_EXACT_PATHS = new Set([
  '/assessments',
  '/imports',
  '/items',
  '/onboarding',
]);

const CONTENT_WRITE_PAGE_PREFIXES = [
  '/assessments/',
  '/imports/batches/',
];

function exactRouteMatch(path: string, routes: ReadonlySet<string>): boolean {
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return routes.has(normalized);
}

export function isPublicPath(path: string): boolean {
  return PUBLIC_EXACT_PATHS.has(path) ||
    PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function isPasswordChangeAllowedPath(path: string): boolean {
  return PASSWORD_CHANGE_ALLOWED_PATHS.has(path);
}

export function requiresContentWriteRole(path: string): boolean {
  const isContentApi = path.startsWith('/api/') &&
    !path.startsWith('/api/auth/') &&
    path !== '/api/me' &&
    path !== '/api/settings';
  return isContentApi ||
    exactRouteMatch(path, CONTENT_WRITE_PAGE_EXACT_PATHS) ||
    CONTENT_WRITE_PAGE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

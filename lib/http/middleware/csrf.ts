export function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function passesCsrfValidation(req: Request, url: URL): boolean {
  const requestOrigin = url.origin;
  const secFetchSite = req.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (secFetchSite === 'cross-site') return false;

  const origin = req.headers.get('origin');
  if (origin) return origin === requestOrigin;

  const referer = req.headers.get('referer');
  if (referer) return referer.startsWith(requestOrigin + '/');

  if (secFetchSite) {
    return secFetchSite === 'same-origin' || secFetchSite === 'same-site' ||
      secFetchSite === 'none';
  }

  return false;
}

export function shouldRejectCsrf(req: Request, url: URL, runnerAllowed: boolean): boolean {
  return !isSafeMethod(req.method) &&
    !runnerAllowed &&
    !passesCsrfValidation(req, url);
}

/** Keep sensitive URLs out of referrers while preserving native form origins for CSRF checks. */
export async function privateResponse(
  response: Response | Promise<Response>,
): Promise<Response> {
  const resolved = await response;
  resolved.headers.set('cache-control', 'no-store');
  // no-referrer makes native POST forms send Origin: null.
  resolved.headers.set('referrer-policy', 'strict-origin');
  return resolved;
}

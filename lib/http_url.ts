/** Parses one credential-free HTTPS origin and returns its canonical origin string. */
export function parseHttpsOrigin(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  try {
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.pathname !== '/' ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) return null;
    return url.origin;
  } catch (_cause: unknown) {
    return null;
  }
}

/** Returns whether a value is one credential-free absolute HTTPS URL. */
export function isSafeHttpsUrl(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' &&
      url.username.length === 0 &&
      url.password.length === 0;
  } catch (_cause: unknown) {
    return false;
  }
}

/** Returns whether a value is one credential-free absolute HTTP(S) URL. */
export function isSafeHttpUrl(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  try {
    const url = new URL(input);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username.length === 0 &&
      url.password.length === 0;
  } catch (_cause: unknown) {
    return false;
  }
}

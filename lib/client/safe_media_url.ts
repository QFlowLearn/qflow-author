const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'data:', 'blob:']);

/** Return a browser-navigable media URL, rejecting unsafe and package-relative values. */
export function safeMediaUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || hasControlChars(trimmed)) return null;
  if (!HAS_SCHEME.test(trimmed)) {
    return trimmed.startsWith('/') && !trimmed.startsWith('//') ? trimmed : null;
  }
  try {
    const parsed = new URL(trimmed);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? trimmed : null;
  } catch (_cause: unknown) {
    return null;
  }
}

function hasControlChars(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

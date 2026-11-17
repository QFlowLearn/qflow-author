export function normalizeQtiFragment(xml: string): string {
  return xml
    .replace(/<(\/?)qti-/gi, '<$1')
    .replace(/<(\/?)qti:/gi, '<$1')
    .replace(/\s+xmlns(?::[a-z0-9_-]+)?="[^"]*"/gi, '')
    .trim();
}

export function extractAttr(source: string, key: string): string | null {
  if (!source) return null;
  const regex = new RegExp(`${key}="([^"]*)"`, 'i');
  const match = regex.exec(source);
  return match ? match[1] : null;
}

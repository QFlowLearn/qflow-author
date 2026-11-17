export function sanitizeIdentifier(input: string, fallback: string): string {
  const base = input?.trim() ?? '';
  let normalized = base.replace(/[^A-Za-z0-9._-]+/g, '_');
  normalized = normalized.replace(/__+/g, '_').replace(/^_+/, '');
  if (!normalized) normalized = fallback;
  if (!/^[A-Za-z_]/.test(normalized)) normalized = `_${normalized}`;
  return normalized.toUpperCase();
}

export function generateIdentifierFromLabel(label: string, fallback: string): string {
  if (!label?.trim()) return fallback;
  return sanitizeIdentifier(label, fallback);
}

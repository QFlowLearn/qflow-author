const QTI_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9._-]*$/;

export function isValidQtiIdentifier(value: string): boolean {
  return QTI_IDENTIFIER_RE.test((value ?? '').trim());
}

export function assertValidQtiIdentifier(value: string, fieldName: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) throw new Error(`${fieldName} is required.`);
  if (!isValidQtiIdentifier(trimmed)) {
    throw new Error(
      `${fieldName} must begin with a letter/underscore and contain only letters, numbers, dash, underscore, or period.`,
    );
  }
  return trimmed;
}

export function normalizeQtiIdentifier(value: string, fallback = 'RESPONSE'): string {
  const trimmed = (value ?? '').trim();
  if (isValidQtiIdentifier(trimmed)) return trimmed;
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/g, '_') || fallback;
  if (/^[A-Za-z_]/.test(safe)) return safe.toUpperCase();
  return `_${safe.toUpperCase()}`;
}

function sanitizePackageIdentifier(input: string): string {
  return input.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
}

export function toPackageIdentifier(raw: string | undefined, fallback: string): string {
  const fallbackBase = sanitizePackageIdentifier(fallback) || 'id';
  const cleaned = sanitizePackageIdentifier(raw ?? '');
  let candidate = cleaned || fallbackBase;
  if (!/^[A-Za-z_]/.test(candidate)) {
    candidate = `${fallbackBase}-${candidate}`;
  }
  if (!/^[A-Za-z_]/.test(candidate)) {
    candidate = `id-${candidate.replace(/^[^A-Za-z_]+/, '')}`;
  }
  return candidate;
}

export function createPackageIdentifierFactory() {
  const used = new Set<string>();
  return (raw: string | undefined, fallback: string) => {
    const candidate = toPackageIdentifier(raw, fallback);
    let unique = candidate;
    let counter = 2;
    while (used.has(unique)) {
      unique = `${candidate}-${counter}`;
      counter += 1;
    }
    used.add(unique);
    return unique;
  };
}

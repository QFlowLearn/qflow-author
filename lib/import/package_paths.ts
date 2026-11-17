export function normalizePath(value: string): string {
  const raw = (value ?? '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  const stripped = raw.replace(/^\.\//, '');
  const parts: string[] = [];
  for (const segment of stripped.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join('/');
}

export function baseDir(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized) return '';
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return '';
  return normalized.slice(0, idx);
}

export function resolvePath(basePath: string, target: string): string {
  const value = (target || '').trim();
  if (!value) return '';
  if (!basePath) return normalizePath(value);
  return normalizePath(`${basePath}/${value}`);
}

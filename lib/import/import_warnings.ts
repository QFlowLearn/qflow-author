import { normalizePath } from './package_paths.ts';
import type { ImportWarning } from './types.ts';

/** Group import warnings by their normalized package path. */
export function groupWarningsByPath(
  warnings: readonly ImportWarning[],
): Map<string, ImportWarning[]> {
  const warningsByPath = new Map<string, ImportWarning[]>();
  for (const warning of warnings) {
    const key = normalizePath(warning.path || '');
    if (!key) continue;
    const existing = warningsByPath.get(key) ?? [];
    existing.push(warning);
    warningsByPath.set(key, existing);
  }
  return warningsByPath;
}

/** Remove exact repeated diagnostics while preserving distinct detail and first occurrence. */
export function dedupeImportWarnings(warnings: readonly ImportWarning[]): ImportWarning[] {
  const unique: ImportWarning[] = [];
  const seen = new Set<string>();
  for (const warning of warnings) {
    const key = JSON.stringify([
      warning.code,
      warning.message,
      normalizePath(warning.path ?? ''),
      warning.detail ?? '',
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(warning);
  }
  return unique;
}

/** Summarize import warnings by stable code. */
export function summarizeImportWarnings(
  warnings: ReadonlyArray<{ readonly code: string }>,
): { total: number; byCode: Record<string, number> } | undefined {
  if (!warnings.length) return undefined;
  const byCode: Record<string, number> = {};
  for (const warning of warnings) {
    const code = warning.code || 'UNKNOWN';
    byCode[code] = (byCode[code] ?? 0) + 1;
  }
  return { total: warnings.length, byCode };
}

import { type AdaptiveCoverage, type AdaptiveLevel } from './assessment_adaptive_plan.ts';
import { isCanonicalUuid } from './uuid.ts';
export type AdaptiveCategoryOption = {
  readonly id: string;
  readonly version: number;
  readonly audience: string;
  readonly levels: readonly AdaptiveLevel[];
};
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function level(value: unknown): value is AdaptiveLevel & Record<string, unknown> {
  return record(value) && typeof value.id === 'string' &&
    /^[a-z][a-z0-9_-]{0,63}$/.test(value.id) && typeof value.label === 'string' &&
    value.label.length > 0 && value.label.length <= 160;
}
export function parseAdaptiveOptions(value: unknown): readonly AdaptiveCategoryOption[] | null {
  if (!record(value) || !Array.isArray(value.versions) || value.versions.length > 100) return null;
  const options: AdaptiveCategoryOption[] = [];
  for (const version of value.versions) {
    if (
      !record(version) || !isCanonicalUuid(version.id) || typeof version.version !== 'number' ||
      !Number.isSafeInteger(version.version) || typeof version.audience !== 'string' ||
      !Array.isArray(version.levels) || !version.levels.every(level)
    ) return null;
    options.push({
      id: version.id,
      version: version.version,
      audience: version.audience,
      levels: version.levels,
    });
  }
  return options;
}
export function parseAdaptiveCoverage(value: unknown): AdaptiveCoverage | null {
  if (
    !record(value) || typeof value.audience !== 'string' || !Array.isArray(value.levels) ||
    value.levels.length !== 3
  ) return null;
  const levels: AdaptiveCoverage['levels'][number][] = [];
  for (const entry of value.levels) {
    if (
      !record(entry) || !level(entry) || typeof entry.required !== 'number' ||
      !Number.isInteger(entry.required) || entry.required < 5 || entry.required > 100 ||
      typeof entry.available !== 'number' || !Number.isSafeInteger(entry.available) ||
      entry.available < 0
    ) return null;
    levels.push({
      id: entry.id,
      label: entry.label,
      required: entry.required,
      available: entry.available,
    });
  }
  return { audience: value.audience, levels };
}

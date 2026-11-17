/** Returns repeated string values once, in the order each duplicate is first observed. */
export function findDuplicateStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates];
}

/** Trims string values and returns the non-empty unique values in input order. */
export function uniqueTrimmedStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

/** Converts a finite positive dimension to an integer or omits it when invalid. */
export function normalizePositiveDimension(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const integer = Math.trunc(value);
  return integer > 0 ? integer : undefined;
}

/**
 * Converts a QTI choice/association bound where 0 means unlimited.
 * Absent, non-finite, and unlimited values become null.
 */
export function normalizeUnlimitedBound(value: number | undefined, min: number): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const integer = Math.trunc(value);
  if (integer === 0) return null;
  return integer < min ? min : integer;
}

/** Converts a QTI 0-means-unlimited bound for optional authoring fields. */
export function normalizeOptionalUnlimitedBound(
  value: number | undefined,
  min: number,
): number | undefined {
  return normalizeUnlimitedBound(value, min) ?? undefined;
}

/** Normalizes a coordinate pair string to `"x y"` or an empty string when invalid. */
export function normalizePointString(value: string): string {
  return value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Returns valid `"x y"` coordinate pairs from authoring point strings. */
export function normalizeCoordinatePoints(points?: readonly string[]): string[] {
  if (!Array.isArray(points)) return [];
  const normalized: string[] = [];
  for (const point of points) {
    const candidate = normalizePointString(point ?? '');
    if (!candidate) continue;
    const parts = candidate.split(' ').filter((part) => part.length > 0);
    if (parts.length !== 2) continue;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    normalized.push(`${x} ${y}`);
  }
  return normalized;
}

/** One mapped hotspot or drop target on an image interaction. */
export type MappedImageTarget<Shape extends string> = {
  shape: Shape;
  coords: string;
  mappedValue?: number;
};

/** Drops empty targets and fills a default shape for image hotspot/drop regions. */
export function normalizeMappedImageTargets<Shape extends string>(
  targets:
    | ReadonlyArray<{
      readonly shape?: Shape;
      readonly coords?: string;
      readonly mappedValue?: number;
    }>
    | undefined,
  defaultShape: Shape,
): Array<MappedImageTarget<Shape>> {
  if (!Array.isArray(targets)) return [];
  const normalized: Array<MappedImageTarget<Shape>> = [];
  for (const target of targets) {
    const coords = target.coords ?? '';
    if (!coords.trim()) continue;
    const mappedValue =
      typeof target.mappedValue === 'number' && Number.isFinite(target.mappedValue)
        ? target.mappedValue
        : undefined;
    normalized.push({
      shape: target.shape ?? defaultShape,
      coords,
      mappedValue,
    });
  }
  return normalized;
}

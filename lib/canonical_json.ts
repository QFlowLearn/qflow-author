/** A value that has one unambiguous JSON representation. */
export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

/** Parse and serialize JSON with recursively sorted keys for stable content identities. */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(parseJsonValue(value, new Set<object>(), '$', 'reject', false));
}

/**
 * Project a persistence record into JSON without silently inventing array values.
 *
 * Optional object properties are omitted deliberately. Every retained value must still satisfy
 * the same finite, plain-record, acyclic JSON contract used by canonical identities.
 */
export function projectJsonPersistenceObject(value: object): Record<string, CanonicalJsonValue> {
  const projected = parseJsonValue(value, new Set<object>(), '$', 'omit', false);
  if (projected === undefined || Array.isArray(projected) || projected === null) {
    throw new Error('JSON persistence requires a record at $.');
  }
  // SAFETY: the root guards above exclude every non-record member of CanonicalJsonValue.
  return projected as Record<string, CanonicalJsonValue>;
}

function parseJsonValue(
  value: unknown,
  ancestors: Set<object>,
  path: string,
  undefinedPolicy: 'reject' | 'omit',
  objectProperty: boolean,
): CanonicalJsonValue | undefined {
  if (value === undefined && undefinedPolicy === 'omit' && objectProperty) return undefined;
  if (value === undefined) {
    throw new Error(`${jsonLabel(undefinedPolicy)} cannot represent undefined at ${path}.`);
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Canonical JSON numbers must be finite at ${path}.`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(
      `${jsonLabel(undefinedPolicy)} cannot represent ${typeof value} values at ${path}.`,
    );
  }
  if (ancestors.has(value)) {
    throw new Error(`Canonical JSON cannot represent cyclic values at ${path}.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return parseJsonArray(value, ancestors, path, undefinedPolicy);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${jsonLabel(undefinedPolicy)} objects must be plain records at ${path}.`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(
        `${jsonLabel(undefinedPolicy)} objects cannot contain symbol keys at ${path}.`,
      );
    }
    // SAFETY: the plain-object check above establishes a string-keyed record boundary.
    const record = value as Record<string, unknown>;
    const canonical: Record<string, CanonicalJsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = parseJsonValue(
        record[key],
        ancestors,
        propertyPath(path, key),
        undefinedPolicy,
        true,
      );
      if (entry !== undefined) canonical[key] = entry;
    }
    return canonical;
  } finally {
    ancestors.delete(value);
  }
}

function parseJsonArray(
  value: readonly unknown[],
  ancestors: Set<object>,
  path: string,
  undefinedPolicy: 'reject' | 'omit',
): CanonicalJsonValue[] {
  const canonical: CanonicalJsonValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(
        `${jsonLabel(undefinedPolicy)} cannot represent a sparse array at ${path}[${index}].`,
      );
    }
    const entry = parseJsonValue(
      value[index],
      ancestors,
      `${path}[${index}]`,
      undefinedPolicy,
      false,
    );
    if (entry === undefined) {
      throw new Error(
        `${jsonLabel(undefinedPolicy)} cannot represent undefined at ${path}[${index}].`,
      );
    }
    canonical.push(entry);
  }
  return canonical;
}

function jsonLabel(undefinedPolicy: 'reject' | 'omit'): 'Canonical JSON' | 'JSON persistence' {
  return undefinedPolicy === 'reject' ? 'Canonical JSON' : 'JSON persistence';
}

function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

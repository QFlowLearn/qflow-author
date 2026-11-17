import { parseQtiXml } from '@longsightgroup/qti3-core';
import { type CanonicalJsonValue, projectJsonPersistenceObject } from './canonical_json.ts';

/** Canonical parsed item semantics shared by content hashing and revision comparison. */
export function projectCanonicalQtiSemantics(qtiXml: string): CanonicalJsonValue {
  const parsed = parseQtiXml(qtiXml);
  const item = parsed.document?.item;
  if (!parsed.ok || !item) {
    throw new Error('Question bank projection requires parseable QTI 3 item XML.');
  }
  return projectQtiValue(projectJsonPersistenceObject(item), true);
}

function projectQtiValue(value: CanonicalJsonValue, itemRoot = false): CanonicalJsonValue {
  if (Array.isArray(value)) return value.map((entry) => projectQtiValue(entry));
  if (value === null || typeof value !== 'object') return value;
  const projected: Record<string, CanonicalJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isParserSourceLocation(entry)) continue;
    if (itemRoot && (key === 'identifier' || key === 'title')) continue;
    projected[key] = itemRoot && key === 'attributes'
      ? projectQtiItemAttributes(entry)
      : projectQtiValue(entry);
  }
  return projected;
}

function isParserSourceLocation(value: CanonicalJsonValue): boolean {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return hasExactKeys(record, ['line', 'column', 'offset', 'path']) &&
    typeof record.line === 'number' && typeof record.column === 'number' &&
    typeof record.offset === 'number' && typeof record.path === 'string';
}

function projectQtiItemAttributes(value: CanonicalJsonValue): CanonicalJsonValue {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Parsed QTI item attributes are invalid.');
  }
  const projected: Record<string, CanonicalJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      key === 'identifier' || key === 'title' || key === 'xmlns' || key === 'xmlns:xsi' ||
      key === 'xsi:schemaLocation'
    ) {
      continue;
    }
    projected[key] = projectQtiValue(entry);
  }
  return projected;
}
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => key in value);
}

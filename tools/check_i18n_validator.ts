import { parse } from '@formatjs/icu-messageformat-parser';
import { INTERFACE_LOCALES, parseInterfaceLocale } from '../lib/i18n/locale.ts';

/** Return duplicate object-property paths in a JSON source string. */
export function findDuplicateJsonKeys(source: string): ReadonlyArray<string> {
  const duplicates: string[] = [];
  let index = 0;
  const whitespace = () => {
    while (/\s/.test(source[index] ?? '')) index++;
  };
  const stringValue = (): string => {
    const start = index;
    if (source[index] !== '"') throw new SyntaxError('expected JSON string');
    index++;
    while (index < source.length) {
      if (source[index] === '\\') index += 2;
      else if (source[index++] === '"') {
        return JSON.parse(source.slice(start, index)) as string;
      }
    }
    throw new SyntaxError('unterminated JSON string');
  };
  const value = (path: string): void => {
    whitespace();
    if (source[index] === '{') return object(path);
    if (source[index] === '[') return array(path);
    if (source[index] === '"') {
      stringValue();
      return;
    }
    const start = index;
    while (index < source.length && !/[\s,}\]]/.test(source[index])) index++;
    if (start === index) throw new SyntaxError('expected JSON value');
  };
  const object = (path: string): void => {
    index++;
    whitespace();
    const keys = new Set<string>();
    if (source[index] === '}') {
      index++;
      return;
    }
    while (index < source.length) {
      whitespace();
      const key = stringValue();
      const keyPath = path ? `${path}.${key}` : key;
      if (keys.has(key)) duplicates.push(keyPath);
      keys.add(key);
      whitespace();
      if (source[index++] !== ':') throw new SyntaxError('expected JSON colon');
      value(keyPath);
      whitespace();
      if (source[index] === '}') {
        index++;
        return;
      }
      if (source[index++] !== ',') throw new SyntaxError('expected JSON comma');
    }
    throw new SyntaxError('unterminated JSON object');
  };
  const array = (path: string): void => {
    index++;
    whitespace();
    let item = 0;
    if (source[index] === ']') {
      index++;
      return;
    }
    while (index < source.length) {
      value(`${path}[${item++}]`);
      whitespace();
      if (source[index] === ']') {
        index++;
        return;
      }
      if (source[index++] !== ',') throw new SyntaxError('expected JSON comma');
      whitespace();
    }
    throw new SyntaxError('unterminated JSON array');
  };
  whitespace();
  value('');
  whitespace();
  if (index !== source.length) throw new SyntaxError('unexpected JSON data');
  return duplicates;
}

/** Validate unknown catalog data at the checker boundary. */
export function validateCatalogData(
  contextValue: unknown,
  catalogsValue: unknown,
): ReadonlyArray<string> {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!isRecord(contextValue)) return ['context: top-level value must be an object'];
  if (!isRecord(catalogsValue)) return ['catalogs: top-level value must be an object'];
  const diagnostics: string[] = [];
  for (const [id, value] of Object.entries(contextValue)) {
    if (
      !isRecord(value) || typeof value.screen !== 'string' || !value.screen.trim() ||
      typeof value.meaning !== 'string' || !value.meaning.trim() ||
      typeof value.interpolation !== 'string' || !value.interpolation.trim()
    ) diagnostics.push(`${id}: invalid context shape`);
  }
  const locales = Object.keys(catalogsValue);
  for (const locale of INTERFACE_LOCALES) {
    if (!(locale in catalogsValue)) diagnostics.push(`${locale}: missing locale`);
  }
  for (const locale of locales) {
    if (parseInterfaceLocale(locale) === null) {
      diagnostics.push(`${locale}: unsupported locale`);
    }
  }
  const base = isRecord(catalogsValue['en-US']) ? catalogsValue['en-US'] : null;
  if (!base) diagnostics.push('catalogs: missing en-US');
  for (const locale of locales) {
    const namespaces = catalogsValue[locale];
    if (!isRecord(namespaces)) {
      diagnostics.push(`${locale}: invalid namespaces`);
      continue;
    }
    const seenIds = new Set<string>();
    for (const [_namespace, rawMessages] of Object.entries(namespaces)) {
      if (!isRecord(rawMessages)) continue;
      for (const id of Object.keys(rawMessages)) {
        if (seenIds.has(id)) diagnostics.push(`${locale}: duplicate message ID ${id}`);
        seenIds.add(id);
      }
    }
    if (base) {
      for (const name of Object.keys(base)) {
        if (!(name in namespaces)) diagnostics.push(`${locale}: missing namespace ${name}`);
      }
      for (const name of Object.keys(namespaces)) {
        if (!(name in base)) diagnostics.push(`${locale}: extra namespace ${name}`);
      }
    }
    for (const namespace of Object.keys(namespaces)) {
      const messages = namespaces[namespace];
      const baseMessages = base && isRecord(base[namespace]) ? base[namespace] : null;
      if (!isRecord(messages)) {
        diagnostics.push(`${locale}/${namespace}: invalid messages`);
        continue;
      }
      if (!baseMessages) {
        diagnostics.push(`${locale}/${namespace}: namespace mismatch`);
        continue;
      }
      for (const id of Object.keys(baseMessages)) {
        if (!(id in messages)) diagnostics.push(`${locale}/${namespace}/${id}: missing key`);
      }
      for (const id of Object.keys(messages)) {
        if (!(id in baseMessages)) diagnostics.push(`${locale}/${namespace}/${id}: extra key`);
      }
      for (const id of Object.keys(messages)) {
        const value = messages[id];
        if (typeof value !== 'string' || !value.trim()) {
          diagnostics.push(`${locale}/${namespace}/${id}: empty/non-string message`);
        }
        if (typeof value === 'string') {
          if (value.trim() === id) {
            diagnostics.push(`${locale}/${namespace}/${id}: message equals its ID`);
          }
          try {
            parse(value);
          } catch (_error: unknown) {
            diagnostics.push(`${locale}/${namespace}/${id}: invalid ICU`);
          }
        }
        if (!(id in contextValue)) diagnostics.push(`${id}: missing context`);
        const source = baseMessages?.[id];
        if (typeof value === 'string' && typeof source === 'string') {
          try {
            const signature = (input: string): string => {
              const stableData = (value: unknown): unknown => {
                if (Array.isArray(value)) return value.map(stableData);
                if (typeof value !== 'object' || value === null) return value;
                return Object.fromEntries(
                  Object.entries(value)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, item]) => [key, stableData(item)]),
                );
              };

              function normalizeList(list: unknown): unknown[] {
                if (!Array.isArray(list)) return [];
                return list
                  .map(normalizeElement)
                  .filter((item): item is Record<string, unknown> => item !== null)
                  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
              }

              function normalizeElement(part: unknown): Record<string, unknown> | null {
                if (typeof part !== 'object' || part === null) return null;
                const type = Reflect.get(part, 'type');
                // Literal text and source ordering are intentionally excluded: translators may
                // reorder prose and placeholders while preserving the semantic contract.
                if (type === 0) return null;
                const out: Record<string, unknown> = { type };
                const value = Reflect.get(part, 'value');
                if (typeof value === 'string') out.value = value;
                for (const key of ['offset', 'pluralType']) {
                  const item = Reflect.get(part, key);
                  if (item !== undefined) out[key] = item;
                }
                const style = Reflect.get(part, 'style');
                if (style !== undefined) out.style = stableData(style);
                const options = Reflect.get(part, 'options');
                if (typeof options === 'object' && options !== null) {
                  out.options = Object.fromEntries(
                    Object.entries(options)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, item]) => [
                        key,
                        normalizeList(
                          typeof item === 'object' && item !== null
                            ? Reflect.get(item, 'value')
                            : [],
                        ),
                      ]),
                  );
                }
                return out;
              }

              return JSON.stringify(normalizeList(parse(input)));
            };
            if (signature(value) !== signature(source)) {
              diagnostics.push(`${locale}/${namespace}/${id}: ICU contract mismatch`);
            }
          } catch (_error: unknown) { /* invalid syntax is reported above */ }
        }
      }
      for (const id of Object.keys(baseMessages)) {
        if (!(id in messages)) diagnostics.push(`${locale}/${namespace}/${id}: key mismatch`);
      }
    }
  }
  for (const id of Object.keys(contextValue)) {
    if (
      !locales.some((locale) =>
        isRecord(catalogsValue[locale]) &&
        Object.values(catalogsValue[locale]).some((ns) => isRecord(ns) && id in ns)
      )
    ) diagnostics.push(`${id}: orphan context`);
  }
  return diagnostics;
}

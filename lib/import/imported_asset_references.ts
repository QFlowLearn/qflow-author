import { ASSET_ATTR_REGEX, packageAssetKey, QTI_FILE_HREF_REGEX } from '../asset_refs.ts';

export function collectImportedAssetReferenceKeys(
  value: unknown,
  sourceHref?: string,
): Set<string> {
  const references = new Set<string>();

  visitStrings(value, (input) => {
    input.replace(ASSET_ATTR_REGEX, (_match, _attr, _quote, reference) => {
      addReference(references, reference, sourceHref);
      return _match;
    });
    input.replace(QTI_FILE_HREF_REGEX, (_match, _open, reference) => {
      addReference(references, reference, sourceHref);
      return _match;
    });
  });

  return references;
}

export function rewriteImportedAssetReferences(
  input: string | null | undefined,
  uploads: ReadonlyMap<string, { readonly url: string }>,
  sourceHref?: string,
): string | undefined {
  if (!input) return input ?? undefined;
  const rewrittenAttributes = input.replace(ASSET_ATTR_REGEX, (match, attr, quote, reference) => {
    const key = packageAssetKey(reference, sourceHref);
    if (!key) return match;
    const saved = uploads.get(key);
    return saved ? `${attr}=${quote}${saved.url}${quote}` : match;
  });
  return rewrittenAttributes.replace(QTI_FILE_HREF_REGEX, (match, open, reference, close) => {
    const key = packageAssetKey(reference, sourceHref);
    if (!key) return match;
    const saved = uploads.get(key);
    return saved ? `${open}${saved.url}${close}` : match;
  });
}

function visitStrings(value: unknown, visit: (value: string) => void): void {
  if (typeof value === 'string') {
    visit(value);
  } else if (Array.isArray(value)) {
    value.forEach((entry) => visitStrings(entry, visit));
  } else if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    Object.values(value as Record<string, unknown>).forEach((entry) => visitStrings(entry, visit));
  }
}

function addReference(references: Set<string>, reference: string, sourceHref?: string): void {
  const key = packageAssetKey(reference, sourceHref);
  if (key) references.add(key);
}

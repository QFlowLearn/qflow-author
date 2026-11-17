import { baseDir, normalizePath, resolvePath } from './import/package_paths.ts';

// Asset references in QTI content often appear in:
// - <... src="..."> / <... href="..."> (img, a, etc.)
// - <object data="..."> (common in IMS QTI fixtures)
export const ASSET_ATTR_REGEX =
  /((?:xlink:)?(?:src|href)|poster|data|primary-path|fallback-path|primary-configuration|secondary-configuration)=(["'])([^'"<>]+)\2/gi;

export const QTI_FILE_HREF_REGEX = /(<qti-file-href\b[^>]*>)([^<]+)(<\/qti-file-href>)/gi;
export const QTI_STYLESHEET_HREF_REGEX = /(<qti-stylesheet\b[^>]*\bhref=)(['"])([^'"]+)\2/gi;

function normalizeAssetRef(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('/uploads/')) return null;
  if (/^[a-z]+:/i.test(trimmed)) return null;
  if (trimmed.startsWith('//')) return null;
  const withoutQuery = trimmed.split('#')[0].split('?')[0];
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch (_err) {
    // ignore decoding problems
  }
  const norm = normalizePath(decoded);
  return norm ? norm.toLowerCase() : null;
}

export function assetKey(path: string): string {
  return normalizePath(path).toLowerCase();
}

/** Resolves a package-local reference relative to an item file and returns its canonical path. */
export function resolvePackageAssetPath(reference: string, sourceHref: string): string | null {
  if (!normalizeAssetRef(reference)) return null;
  const resolved = resolvePath(baseDir(sourceHref), reference);
  return resolved || null;
}

/** Returns the lookup key for a package-local asset reference, or null for external refs. */
export function packageAssetKey(reference: string, sourceHref?: string): string | null {
  if (!normalizeAssetRef(reference)) return null;
  const resolved = sourceHref ? resolvePath(baseDir(sourceHref), reference) : reference;
  const normalized = normalizeAssetRef(resolved);
  return normalized ? assetKey(normalized) : null;
}

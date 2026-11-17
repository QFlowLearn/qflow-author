import { assetKey, packageAssetKey } from '../asset_refs.ts';
import type { Draft } from '../types/draft.ts';
import type { PartOptions } from '../test_export.ts';
import {
  collectCatalogMetadataAssetPaths,
  rewriteCatalogMetadataAssetReferences,
} from './catalog_asset_references.ts';
import type { ImportedAsset, ImportResult } from './types.ts';
import type { AssessmentStandaloneContent } from '../assessment_standalone_content.ts';
import { assessmentContentQtiFragment } from '../assessment_content_qti.ts';
import {
  collectImportedAssetReferenceKeys,
  rewriteImportedAssetReferences,
} from './imported_asset_references.ts';

/** Collects package-local asset keys and fails when a reference is missing from the package. */
export function collectReferencedPackageAssetKeys(
  parsed: ImportResult,
  assetLookup: ReadonlyMap<string, ImportedAsset>,
): Set<string> {
  const referenced = new Set<string>();

  const track = (value: unknown, sourceHref?: string) => {
    for (const key of collectImportedAssetReferenceKeys(value, sourceHref)) {
      requirePackageAsset(key, assetLookup);
      referenced.add(key);
    }
  };

  for (const item of parsed.items) {
    track(item.xml, item.href);
    track(item.draft, item.href);
    for (const path of collectCatalogMetadataAssetPaths(item.draft, item.href)) {
      const key = assetKey(path);
      requirePackageAsset(key, assetLookup);
      referenced.add(key);
    }
  }
  for (const part of parsed.parts) {
    track(part.options);
    for (const placement of part.placements) {
      if ('content' in placement) track(assessmentContentQtiFragment(placement.content));
    }
  }

  return referenced;
}

/** Resolve staged content references through the same attempt-owned imported asset inventory. */
export function rewriteImportedStandaloneContent(
  content: AssessmentStandaloneContent,
  uploads: ReadonlyMap<string, { readonly url: string }>,
): AssessmentStandaloneContent {
  if (content.kind === 'image') {
    return { ...content, src: resolveStoredUploadUrl(content.src, uploads) };
  }
  if (content.kind === 'video') {
    return {
      ...content,
      src: resolveStoredUploadUrl(content.src, uploads),
      captionSrc: resolveStoredUploadUrl(content.captionSrc, uploads),
    };
  }
  return content;
}

export function rewriteImportedDraft(
  draft: Draft,
  itemHref: string,
  uploads: ReadonlyMap<string, { readonly url: string }>,
): Draft {
  const withCatalogMetadata = rewriteCatalogMetadataAssetReferences(
    draft,
    itemHref,
    (packagePath) => resolveStoredUploadUrl(packagePath, uploads),
  );
  const rewritten = rewriteDraftXmlAssetReferences(withCatalogMetadata, itemHref, uploads);
  if (!rewritten.answerFeedback) return rewritten;
  const rewrite = (entry: NonNullable<Draft['answerFeedback']>['correct']) => {
    if (!entry?.media || !['image', 'video'].includes(entry.media.kind)) return entry;
    const resolve = (src: string) => {
      const key = packageAssetKey(src, itemHref);
      if (!key) throw new Error('Invalid feedback package asset reference.');
      return resolveStoredUploadUrl(key, uploads);
    };
    const media = entry.media.kind === 'image'
      ? { ...entry.media, src: resolve(entry.media.src) }
      : entry.media.kind === 'video'
      ? {
        ...entry.media,
        src: resolve(entry.media.src),
        captionSrc: resolve(entry.media.captionSrc),
      }
      : entry.media;
    return { ...entry, media };
  };
  return {
    ...rewritten,
    answerFeedback: {
      correct: rewrite(rewritten.answerFeedback.correct),
      incorrect: rewrite(rewritten.answerFeedback.incorrect),
    },
  };
}

export function rewriteImportedPartOptions(
  options: PartOptions | undefined,
  uploads: ReadonlyMap<string, { readonly url: string }>,
): PartOptions | undefined {
  if (!options) return undefined;
  return rewriteValueXmlAssetReferences(options, undefined, uploads) as PartOptions;
}

function rewriteDraftXmlAssetReferences(
  draft: Draft,
  itemHref: string,
  uploads: ReadonlyMap<string, { readonly url: string }>,
): Draft {
  return rewriteValueXmlAssetReferences(draft, itemHref, uploads) as Draft;
}

function rewriteValueXmlAssetReferences(
  value: unknown,
  sourceHref: string | undefined,
  uploads: ReadonlyMap<string, { readonly url: string }>,
): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    return rewriteImportedAssetReferences(value, uploads, sourceHref) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteValueXmlAssetReferences(entry, sourceHref, uploads));
  }
  if (typeof value === 'object') {
    if (value instanceof Uint8Array) return value;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      next[key] = rewriteValueXmlAssetReferences(entry, sourceHref, uploads);
    }
    return next;
  }
  return value;
}

function requirePackageAsset(
  key: string,
  assetLookup: ReadonlyMap<string, ImportedAsset>,
): void {
  if (!assetLookup.has(key)) {
    throw new Error(`Package asset ${key} is referenced but missing from the package.`);
  }
}

function resolveStoredUploadUrl(
  packagePath: string,
  uploads: ReadonlyMap<string, { readonly url: string }>,
): string {
  const saved = uploads.get(assetKey(packagePath));
  if (!saved) throw new Error(`Package asset ${packagePath} was not stored.`);
  return saved.url;
}

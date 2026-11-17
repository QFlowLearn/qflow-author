import { resolvePackageAssetPath } from '../asset_refs.ts';
import type { CatalogFileDraft, Draft } from '../types/draft.ts';

/** Returns canonical package paths referenced by catalog and stylesheet draft metadata. */
export function collectCatalogMetadataAssetPaths(draft: Draft, itemHref: string): string[] {
  return catalogMetadataReferences(draft).flatMap((reference) => {
    const path = resolvePackageAssetPath(reference, itemHref);
    return path ? [path] : [];
  });
}

/** Replaces package-local catalog and stylesheet references through one canonical resolver. */
export function rewriteCatalogMetadataAssetReferences(
  draft: Draft,
  itemHref: string,
  resolveReference: (packagePath: string) => string,
): Draft {
  const rewriteReference = (reference: string): string => {
    const packagePath = resolvePackageAssetPath(reference, itemHref);
    return packagePath ? resolveReference(packagePath) : reference;
  };
  const rewriteFiles = (files: CatalogFileDraft[] | undefined): CatalogFileDraft[] | undefined =>
    files?.map((file) => ({ ...file, href: rewriteReference(file.href) }));

  return {
    ...draft,
    catalogs: draft.catalogs?.map((catalog) => ({
      ...catalog,
      cards: catalog.cards.map((card) => ({
        ...card,
        files: rewriteFiles(card.files),
        entries: card.entries?.map((entry) => ({
          ...entry,
          files: rewriteFiles(entry.files),
        })),
      })),
    })),
    stylesheets: draft.stylesheets?.map((stylesheet) => ({
      ...stylesheet,
      href: rewriteReference(stylesheet.href),
    })),
  };
}

function catalogMetadataReferences(draft: Draft): string[] {
  return [
    ...(draft.stylesheets ?? []).map((stylesheet) => stylesheet.href),
    ...(draft.catalogs ?? []).flatMap((catalog) =>
      catalog.cards.flatMap((card) => [
        ...(card.files ?? []).map((file) => file.href),
        ...(card.entries ?? []).flatMap((entry) => (entry.files ?? []).map((file) => file.href)),
      ])
    ),
  ];
}

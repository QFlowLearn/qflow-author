import { parseTestOrganization } from './package_organization.ts';
import { readPackageMetadata } from './package_metadata.ts';
import { parseQuestionTags } from '../../../question_tags.ts';
import {
  type ImportedOrganizationGroup,
  organizationGroupsFromParts,
} from '../../organization_groups.ts';
import {
  parseQtiPackageStream,
  type QtiPackageItem,
  type QtiPackageParseResult,
  type QtiPackageStreamSummary,
  type QtiStandardAlignment,
} from '@longsightgroup/qti3-core';
import { openPackageZip, type PackageZipSource } from '../../package_zip_source.ts';
import {
  MAX_NATIVE_QTI_ENTRY_BYTES,
  MAX_NATIVE_QTI_EXPANDED_BYTES,
  MAX_SOURCE_ARCHIVE_ENTRIES,
  MAX_SOURCE_FILE_BYTES,
} from '../../../source_intake/policy.ts';

import { validateCatalogMetadata } from '../../../catalog_metadata.ts';
import { extractCurriculumStandards } from '../../../standards.ts';
import type { Draft } from '../../../types/draft.ts';
import { writeZip } from '../../../zip.ts';
import { baseDir, normalizePath, resolvePath } from '../../package_paths.ts';
import { parseTestStructure } from './package_test_structure.ts';
import { parseItemXml } from './parse_item.ts';
import { QtiChoicePointsImportError } from './choice_points.ts';
import { TextEntryScoringImportError } from './text_entry_match_scoring.ts';
import type {
  ImportedAsset,
  ImportedItem,
  ImportedPart,
  ImportResult,
  ImportWarning,
} from '../../types.ts';
import { buildUnsupportedItemStub } from './unsupported_item_stub.ts';
import { migrationWarningCodeFromCatalog } from '../../migration_warning_catalog.ts';
import { migrationWarningCodeFromExternal } from '../../external_diagnostic_codes.ts';
import { QTI3_CORE_DIAGNOSTIC_CODES } from './diagnostic_codes.ts';

export type QtiPackageEntry = {
  readonly path: string;
  readonly data: Uint8Array | string;
};

const encoder = new TextEncoder();

/** Imports a QTI 3 ZIP through the canonical incremental parser. */
export async function parseQtiPackage(zipBytes: Uint8Array): Promise<ImportResult> {
  const source = await openQtiPackage(zipBytes);
  const items: ImportedItem[] = [];
  const itemWarnings: ImportWarning[] = [];
  for await (const event of streamQtiPackageImport(source)) {
    if (event.kind === 'item') {
      items.push(event.item);
      itemWarnings.push(...event.warnings);
      continue;
    }
    const assets: ImportedAsset[] = [];
    for (const asset of event.summary.assets) {
      assets.push({
        path: asset.href,
        name: asset.href.split('/').pop() || asset.href,
        mime: asset.mediaType,
        data: await source.readEntry(asset.href, MAX_NATIVE_QTI_ENTRY_BYTES),
      });
    }
    const warnings = [...event.warnings, ...itemWarnings];
    return {
      title: event.summary.title,
      parts: event.parts,
      organizationGroups: event.organizationGroups,
      items,
      assets,
      warnings: warnings.length ? warnings : undefined,
    };
  }
  throw new Error('QTI package parsing did not produce a terminal summary.');
}

/** Open the bounded native package source used by inspection and processing. */
export async function openQtiPackage(zipBytes: Uint8Array): Promise<PackageZipSource> {
  return await openPackageZip({
    size: zipBytes.length,
    read: (offset, length) => Promise.resolve(zipBytes.subarray(offset, offset + length)),
  }, {
    maxCompressedBytes: MAX_SOURCE_FILE_BYTES,
    maxDirectoryBytes: 8 * 1024 * 1024,
    maxEntries: MAX_SOURCE_ARCHIVE_ENTRIES,
    maxEntryBytes: MAX_NATIVE_QTI_ENTRY_BYTES,
    maxTotalBytes: MAX_NATIVE_QTI_EXPANDED_BYTES,
  });
}

/** Provisional item projections followed by a successfully validated package summary. */
export type QtiPackageImportEvent =
  | {
    readonly kind: 'item';
    readonly index: number;
    readonly item: ImportedItem;
    readonly warnings: readonly ImportWarning[];
  }
  | {
    readonly kind: 'summary';
    readonly summary: QtiPackageStreamSummary;
    readonly parts: ImportedPart[];
    readonly organizationGroups: ImportedOrganizationGroup[];
    readonly warnings: readonly ImportWarning[];
  };

/** Stream canonical QFlow projections without retaining the package's parsed item models. */
export async function* streamQtiPackageImport(
  source: PackageZipSource,
): AsyncGenerator<QtiPackageImportEvent> {
  const packagePaths = new Set(source.entries.map((entry) => entry.path));
  const metadata = await readPackageMetadata(source);
  const placements: ImportedPart['placements'] = [];
  for await (
    const event of parseQtiPackageStream(source, {
      maxEntries: MAX_SOURCE_ARCHIVE_ENTRIES,
      maxEntryBytes: MAX_NATIVE_QTI_ENTRY_BYTES,
      maxTotalBytes: MAX_NATIVE_QTI_EXPANDED_BYTES,
      maxDiagnostics: 10_000,
    })
  ) {
    if (event.kind === 'item') {
      const projected = projectPackageItem(event.item, packagePaths);
      const tags = metadata.tags.get(event.item.manifestResourceIdentifier ?? '') ?? [];
      projected.item.draft.tags = parseQuestionTags([
        ...(projected.item.draft.tags ?? []),
        ...tags,
      ]);
      const organization = metadata.organization.get(event.item.manifestResourceIdentifier ?? '');
      if (organization) {
        projected.item.draft = { ...projected.item.draft, importOrganization: organization };
      }
      placements.push({
        href: event.item.href,
        refIdentifier: event.item.manifestResourceIdentifier,
      });
      yield { kind: 'item', index: event.index, ...projected };
      continue;
    }
    if (!event.summary.ok) throw new Error(packageParseFailureMessage(event.summary));
    const parts = event.summary.assessmentTest
      ? parseTestStructure(event.summary.assessmentTest)
      : [{ id: 'part-1', title: 'Part 1', placements }];
    yield {
      kind: 'summary',
      summary: event.summary,
      parts,
      organizationGroups: event.summary.assessmentTest
        ? await parseTestOrganization(event.summary.assessmentTest)
        : organizationGroupsFromParts(parts),
      warnings: event.summary.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')
        .map((diagnostic) => ({
          code: migrationWarningCodeFromExternal(diagnostic.code, QTI3_CORE_DIAGNOSTIC_CODES),
          message: diagnostic.message,
          detail: `External diagnostic: ${diagnostic.code}`,
          path: diagnostic.path,
        })),
    };
  }
}

/** Imports an in-memory QTI 3 package entry set through the same ZIP parser. */
export async function parseQtiPackageEntries(
  entries: readonly QtiPackageEntry[],
): Promise<ImportResult> {
  const zip = await writeZip(
    entries.map((entry) => ({
      name: entry.path,
      data: typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data,
    })),
  );
  return await parseQtiPackage(zip);
}

function projectPackageItem(
  item: QtiPackageItem,
  packageAssetPaths: ReadonlySet<string>,
): { readonly item: ImportedItem; readonly warnings: ImportWarning[] } {
  try {
    const { draft, identifier, title } = parseItemXml(item.xml);
    const warnings = metadataImportWarnings(draft, item.href, packageAssetPaths);
    return {
      item: {
        href: item.href,
        identifier,
        title,
        xml: item.xml,
        draft: withStandards(
          { ...draft, importWarnings: warnings.length ? warnings : undefined },
          item.standards,
        ),
      },
      warnings,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unsupported item';
    const unsupported = buildUnsupportedItemStub(item.xml, item.href, reason);
    const warnings: ImportWarning[] = error instanceof QtiChoicePointsImportError
      ? [
        { code: error.code, path: item.href, message: error.message, detail: error.path },
        ...error.answerWarnings.map((warning) => ({ ...warning, path: item.href })),
      ]
      : [{
        ...unsupported.warning,
        message: error instanceof TextEntryScoringImportError
          ? 'The original question and scoring are retained. Review the source scoring before editing.'
          : unsupported.warning.message,
      }];
    const draft = {
      ...unsupported.item.draft,
      importWarnings: warnings,
      ...(error instanceof QtiChoicePointsImportError ||
          error instanceof TextEntryScoringImportError
        ? {
          ...(error instanceof QtiChoicePointsImportError
            ? { itemLanguage: error.itemLanguage }
            : {}),
          promptHtml:
            '<p>The original question and scoring are retained. Review the source scoring before editing.</p>',
        }
        : {}),
    };
    return {
      item: {
        ...unsupported.item,
        href: item.href,
        xml: item.xml,
        draft: withStandards(draft, item.standards),
      },
      warnings,
    };
  }
}

function withStandards(
  draft: ImportedItem['draft'],
  alignments: readonly QtiStandardAlignment[],
): ImportedItem['draft'] {
  const standards = extractCurriculumStandards({
    standards: [...(draft.standards ?? []), ...alignments],
  });
  return {
    ...draft,
    standards: standards.length ? standards : undefined,
  };
}

function packageParseFailureMessage(parsed: Pick<QtiPackageParseResult, 'diagnostics'>): string {
  const messages = parsed.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.message);
  return messages.length ? messages.join('; ') : 'Failed to parse QTI 3 package';
}

function metadataImportWarnings(
  draft: Draft,
  itemHref: string,
  packageAssets: ReadonlySet<string>,
): ImportWarning[] {
  const warnings: ImportWarning[] = validateCatalogMetadata(draft.catalogs, draft.stylesheets)
    .map((issue) => ({
      code: migrationWarningCodeFromCatalog(issue.code),
      message: issue.message,
      detail: issue.path,
      path: itemHref,
    }));
  const references = [
    ...(draft.stylesheets ?? []).map((stylesheet) => ({
      kind: 'stylesheet',
      href: stylesheet.href,
    })),
    ...(draft.catalogs ?? []).flatMap((catalog) =>
      catalog.cards.flatMap((card) => [
        ...(card.files ?? []).map((file) => ({ kind: 'catalog file', href: file.href })),
        ...(card.entries ?? []).flatMap((entry) =>
          (entry.files ?? []).map((file) => ({ kind: 'catalog file', href: file.href }))
        ),
      ])
    ),
  ];
  for (const reference of references) {
    const href = reference.href.trim();
    if (!href) continue;
    if (/^(?:https?:)?\/\//i.test(href) || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
      warnings.push({
        code: 'QTI_METADATA_EXTERNAL_REFERENCE',
        message: `Imported ${reference.kind} uses external reference ${href}.`,
        path: itemHref,
      });
      continue;
    }
    const direct = normalizePath(href);
    const relative = resolvePath(baseDir(itemHref), href);
    if (!packageAssets.has(direct) && !packageAssets.has(relative)) {
      warnings.push({
        code: 'QTI_METADATA_FILE_MISSING',
        message: `Imported ${reference.kind} references missing package file ${href}.`,
        path: itemHref,
      });
    }
  }
  return warnings;
}

import { importStandaloneHtml } from './standalone_html.ts';
import { importQti12SourceGroups } from './qti12_source_groups.ts';
import { organizationGroupsFromParts } from '../organization_groups.ts';
import {
  detectQtiMigrationSource,
  migrateQtiResourceToQti3,
  migrateQtiToQti3,
  type QtiMigrationDiagnostic,
  type QtiMigrationResourceInput,
  type QtiMigrationResult,
  type QtiMigrationSourceFormat,
} from '@longsightgroup/qti3-migrator';

import type {
  ImportAdapter,
  ImportedAsset,
  ImportedItem,
  ImportedPart,
  ImportedPlacement,
  ImportResult,
  ImportSource,
  ImportWarning,
  SniffResult,
} from '../types.ts';
import { migrationWarningCodeFromExternal } from '../external_diagnostic_codes.ts';
import { parseItemXml } from './qti3/parse_item.ts';
import { validateQtiResourceReview } from './qti_resource_review.ts';
import { QTI_MIGRATOR_DIAGNOSTIC_CODES } from './qti_migrator_diagnostic_codes.ts';

type MigratorAdapterOptions = {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly extensions: readonly string[];
  readonly priority: number;
  readonly formats: readonly QtiMigrationSourceFormat[];
};

export type QtiResourceImportResult =
  | { readonly ok: true; readonly imported: ImportResult }
  | { readonly ok: false; readonly warnings: readonly ImportWarning[] };

export function createQtiMigratorAdapter(options: MigratorAdapterOptions): ImportAdapter {
  const formats = new Set(options.formats);
  return {
    id: options.id,
    version: options.version,
    label: options.label,
    extensions: options.extensions,
    priority: options.priority,
    sniff: (source) => Promise.resolve(sniffMigratorSource(source, formats)),
    parse: async (source) => qtiMigrationResultToImportResult(await migrateQtiSource(source)),
  };
}

export async function migrateQtiResourceToImportResult(
  input: QtiMigrationResourceInput,
): Promise<QtiResourceImportResult> {
  const result = await migrateQtiResourceToQti3(input, {
    repairPolicy: 'safe',
    unsupportedPolicy: 'stub',
  });

  if (!result.migration.items.length) {
    return { ok: false, warnings: qtiMigrationDiagnosticsToWarnings(result.diagnostics) };
  }
  const imported = qtiMigrationResultToImportResult(result.migration);
  return { ok: true, imported: appendWarnings(imported, validateQtiResourceReview(imported)) };
}

function sniffMigratorSource(
  source: ImportSource,
  formats: Set<QtiMigrationSourceFormat>,
): SniffResult {
  const detected = detectQtiMigrationSource(source);
  if (detected.supported && detected.sourceFormat && formats.has(detected.sourceFormat)) {
    return {
      supported: true,
      confidence: detected.confidence,
      reason: detected.reason,
    };
  }
  return {
    supported: false,
    confidence: detected.confidence,
    reason: detected.reason,
  };
}

async function migrateQtiSource(
  source: ImportSource,
): Promise<QtiMigrationResult> {
  return await migrateQtiToQti3(source, {
    repairPolicy: 'safe',
    unsupportedPolicy: 'stub',
  });
}

function qtiMigrationResultToImportResult(result: QtiMigrationResult): ImportResult {
  const sourceGroups = importQti12SourceGroups(result);
  const warnings = [
    ...qtiMigrationDiagnosticsToWarnings(result.diagnostics),
    ...sourceGroups.warnings,
  ];
  const passages = new Map<string, ImportedPlacement[]>();
  const items: ImportedItem[] = result.items.flatMap((item) => {
    if (item.standaloneHtml !== undefined) {
      const passage = importStandaloneHtml(item.standaloneHtml, item.href);
      passages.set(item.href, passage.content.map((content) => ({ content })));
      warnings.push({
        code: 'LMS_CONTENT_REVIEW',
        message:
          `Passage "${item.title}" is retained as ordered unscored text and images, without an answer field. Text formatting is simplified and link targets are written as text. ${
            passage.omissions.join(' ')
          }`,
      });
      return [];
    }
    item.diagnostics.forEach((diagnostic) =>
      warnings.push({
        ...diagnosticToWarning(diagnostic),
        path: item.href,
      })
    );
    if (!item.xml) return [];

    const parsed = parseItemXml(item.xml);
    return [{
      href: item.href,
      identifier: item.identifier,
      title: item.title,
      xml: item.xml,
      draft: parsed.draft,
    }];
  });

  const parts = result.parts.map((part): ImportedPart => ({
    id: part.identifier,
    title: part.title,
    placements: part.itemHrefs.flatMap((href): ImportedPlacement[] =>
      passages.get(href) ?? [{ href }]
    ),
  }));
  return {
    title: result.title,
    parts,
    organizationGroups: sourceGroups.groups.length
      ? sourceGroups.groups.map((group) => ({
        ...group,
        hrefs: group.hrefs.filter((href) => !passages.has(href)),
      })).filter((group) => group.hrefs.length > 0)
      : organizationGroupsFromParts(parts),
    items,
    assets: result.assets.map((asset): ImportedAsset => ({
      path: asset.path,
      name: asset.path.split('/').pop() || asset.path,
      data: asset.data ?? new Uint8Array(),
      mime: asset.mediaType,
    })),
    warnings: warnings.length ? warnings : undefined,
  };
}

function qtiMigrationDiagnosticsToWarnings(
  diagnostics: readonly QtiMigrationDiagnostic[],
): ImportWarning[] {
  return diagnostics.map(diagnosticToWarning);
}

function appendWarnings(result: ImportResult, warnings: readonly ImportWarning[]): ImportResult {
  if (!warnings.length) return result;
  return {
    ...result,
    warnings: [...(result.warnings ?? []), ...warnings],
  };
}

function diagnosticToWarning(diagnostic: QtiMigrationDiagnostic): ImportWarning {
  return {
    code: migrationWarningCodeFromExternal(diagnostic.code, QTI_MIGRATOR_DIAGNOSTIC_CODES),
    message: diagnostic.message,
    detail: `External diagnostic: ${diagnostic.code}; source format: ${diagnostic.sourceFormat}`,
    path: diagnostic.path,
  };
}

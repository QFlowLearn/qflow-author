import {
  type ImportedOrganizationGroup,
  parseImportedOrganizationGroups,
} from './organization_groups.ts';
import {
  migrationDestinationWarnings,
  type SourceIntakeDestination,
} from './migration_destination.ts';
import { dedupeImportWarnings, groupWarningsByPath } from './import_warnings.ts';
import { choiceAnswerWarnings } from './choice_answer_warnings.ts';
import { normalizePath } from './package_paths.ts';
import type {
  ImportedItem,
  ImportedPart,
  ImportedSourceEvidence,
  ImportResult,
  ImportWarning,
} from './types.ts';
import { normalizeDraftForDriver, resolveDriver } from '../types/draft_utils.ts';
import type { Draft } from '../types/draft.ts';
import { detectImportAdapter } from './registry.ts';
import type {
  MigrationFidelitySummary,
  MigrationItemReadiness,
  MigrationReviewProgress,
  MigrationSummary,
} from './migration_types.ts';
import { normalizeDecision } from './migration_run_store.ts';
import { explainMigrationWarning, type MigrationWarningCode } from './migration_warning_catalog.ts';

type ImportDetection = Awaited<ReturnType<typeof detectImportAdapter>>;

export type MigrationAnalysis = {
  parts: Array<Record<string, unknown>>;
  organizationGroups: ImportedOrganizationGroup[];
  items: Array<{
    sourceHref: string;
    sourceIdentifier: string;
    title: string;
    itemType: string;
    position: number;
    readiness: MigrationItemReadiness;
    warnings: ImportWarning[];
    sourceXml: string;
    importedDraft: Record<string, unknown>;
    sourceEvidence?: ImportedSourceEvidence[];
  }>;
  summary: MigrationSummary;
};

export function emptyMigrationCounts(): MigrationSummary['counts'] {
  return {
    parts: 0,
    items: 0,
    assets: 0,
    warnings: 0,
    ready: 0,
    reviewNeeded: 0,
    blocked: 0,
  };
}

export function buildEmptyMigrationSummary(): MigrationSummary {
  return {
    counts: emptyMigrationCounts(),
    warningCounts: {},
    itemTypeCounts: {},
  };
}

export function buildMigrationAnalysis(
  parsed: ImportResult,
  detection: ImportDetection,
  destination: SourceIntakeDestination,
  sourceItemCount: number = parsed.items.length,
): MigrationAnalysis {
  const warnings = [
    ...(parsed.warnings ?? []),
    ...migrationDestinationWarnings(destination, parsed),
  ];
  const warningsByPath = groupWarningsByPath(warnings);
  const itemPaths = new Set(parsed.items.map((item) => normalizePath(item.href)));
  const resourceWarnings = warnings.filter((warning) =>
    warning.path && !itemPaths.has(normalizePath(warning.path))
  );
  const pathlessWarnings = warnings.filter((warning) => !normalizePath(warning.path ?? ''));
  const assignPathlessToOnlyItem = sourceItemCount === 1;
  const itemTypeCounts: Record<string, number> = {};
  const warningCounts: Partial<Record<MigrationWarningCode, number>> = {};
  const items = parsed.items.map((item, index) => {
    if (item.title !== item.draft.title) {
      throw new Error('Imported question title does not match its parsed draft.');
    }
    const pathKey = normalizePath(item.href);
    const collectedWarnings = assignPathlessToOnlyItem
      ? [...(warningsByPath.get(pathKey) ?? []), ...pathlessWarnings]
      : [...(warningsByPath.get(pathKey) ?? [])];
    collectedWarnings.push(...draftValidationWarnings(item));
    for (const warning of choiceAnswerWarnings(item.draft, item.href)) {
      if (!collectedWarnings.some((existing) => existing.code === warning.code)) {
        collectedWarnings.push(warning);
      }
    }
    const itemWarnings = dedupeImportWarnings(collectedWarnings);
    for (const warning of itemWarnings) {
      const code = warning.code;
      warningCounts[code] = (warningCounts[code] ?? 0) + 1;
    }
    const itemType = item.draft.type;
    itemTypeCounts[itemType] = (itemTypeCounts[itemType] ?? 0) + 1;
    const readiness = determineItemReadiness(itemWarnings);
    return {
      sourceHref: item.href,
      sourceIdentifier: item.identifier,
      title: item.title,
      itemType,
      position: index + 1,
      readiness,
      warnings: itemWarnings,
      sourceXml: item.xml,
      importedDraft: item.draft as Record<string, unknown>,
      sourceEvidence: item.sourceEvidence,
    };
  });

  const globalWarnings = [
    ...resourceWarnings,
    ...(assignPathlessToOnlyItem ? [] : pathlessWarnings),
  ];
  for (const warning of globalWarnings) {
    const code = warning.code;
    warningCounts[code] = (warningCounts[code] ?? 0) + 1;
  }

  const counts = {
    parts: parsed.parts.length,
    items: parsed.items.length,
    assets: parsed.assets.length,
    warnings: Object.values(warningCounts).reduce((sum, value) => sum + value, 0),
    ready: items.filter((item) => item.readiness === 'ready').length,
    reviewNeeded:
      items.filter((item) => item.readiness === 'minor_review' || item.readiness === 'major_review')
        .length,
    blocked: items.filter((item) => item.readiness === 'blocked').length,
  };
  return {
    parts: parsed.parts.map(serializePart),
    organizationGroups: parseImportedOrganizationGroups(parsed.organizationGroups),
    items,
    summary: {
      title: parsed.title,
      counts,
      warningCounts,
      itemTypeCounts,
      sniff: {
        confidence: detection.sniff.confidence,
        reason: detection.sniff.reason,
      },
      globalWarnings: globalWarnings.length ? globalWarnings : undefined,
    },
  };
}

export function buildReviewProgress(
  items: Array<{ decision?: string | null }>,
): MigrationReviewProgress {
  const progress: MigrationReviewProgress = {
    total: 0,
    pending: 0,
    accepted: 0,
    rejected: 0,
  };
  for (const item of items) {
    progress.total++;
    const state = normalizeDecision(item.decision);
    if (state === 'accepted') progress.accepted++;
    else if (state === 'rejected') progress.rejected++;
    else progress.pending++;
  }
  return progress;
}

export function buildFidelitySummary(
  items: Array<{ readiness: MigrationItemReadiness }>,
): MigrationFidelitySummary {
  const summary: MigrationFidelitySummary = {
    total: 0,
    semantic: 0,
    reviewRequired: 0,
    sourcePreserved: 0,
  };
  for (const item of items) {
    summary.total++;
    if (item.readiness === 'ready') summary.semantic++;
    else if (item.readiness === 'blocked') summary.sourcePreserved++;
    else summary.reviewRequired++;
  }
  return summary;
}

function serializePart(part: ImportedPart): Record<string, unknown> {
  return {
    id: part.id,
    title: part.title,
    placements: part.placements.map((placement) =>
      'content' in placement
        ? { content: placement.content, refIdentifier: placement.refIdentifier }
        : { href: placement.href, refIdentifier: placement.refIdentifier }
    ),
    options: part.options ?? {},
  };
}

function validateImportedDraft(item: ImportedItem): ImportWarning[] {
  try {
    const { typeId, driver } = resolveDriver(item.draft);
    const normalized = normalizeDraftForDriver(typeId, { ...item.draft, type: typeId }) as Draft;
    const errors = driver.validate(normalized);
    return errors.map((message) => ({
      code: 'QFLOW_DRAFT_VALIDATION',
      message,
      path: item.href,
    }));
  } catch (err) {
    return [{
      code: 'QFLOW_DRAFT_VALIDATION',
      message: err instanceof Error ? err.message : 'Imported draft could not be validated.',
      path: item.href,
    }];
  }
}

function draftValidationWarnings(item: ImportedItem): readonly ImportWarning[] {
  return item.draftValidation?.warnings ?? validateImportedDraft(item);
}

export function determineItemReadiness(warnings: ImportWarning[]): MigrationItemReadiness {
  const explanations = warnings.map((warning) => explainMigrationWarning(warning.code));
  if (explanations.some((explanation) => explanation.blocksAcceptance)) {
    return 'blocked';
  }
  if (!warnings.length) return 'ready';
  if (explanations.some((explanation) => explanation.severity === 'correction')) {
    return 'major_review';
  }
  return 'minor_review';
}

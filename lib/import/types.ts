import type { ImportedOrganizationGroup } from './organization_groups.ts';
import type { PartOptions } from '../test_export.ts';
import type { ImportedDraft } from './imported_draft.ts';
import type { StructuredSourceDocument } from '../conversion/source_model.ts';
import type { MigrationWarningCode } from './migration_warning_catalog.ts';
import type { AssessmentStandaloneContent } from '../assessment_standalone_content.ts';

export type ImportSource = {
  filename?: string;
  bytes: Uint8Array;
  mime?: string;
};

export type ImportedQuestionPlacement = { href: string; refIdentifier?: string };
export type ImportedPlacement =
  | ImportedQuestionPlacement
  | { content: AssessmentStandaloneContent; refIdentifier?: string };

/** Standalone instructions have no question resource or bank membership. */
export function importedQuestionPlacements(
  placements: readonly ImportedPlacement[],
): ImportedQuestionPlacement[] {
  return placements.filter((placement): placement is ImportedQuestionPlacement =>
    'href' in placement
  );
}
export type ImportedPart = {
  id: string;
  title: string;
  placements: ImportedPlacement[];
  options?: PartOptions;
};
export type ImportedDraftValidation = {
  readonly _tag: 'validated';
  readonly warnings: readonly ImportWarning[];
};
export type ImportedItem = {
  href: string;
  identifier: string;
  title: string;
  xml: string;
  draft: ImportedDraft;
  /** Canonical validation result when the adapter already validated this exact draft. */
  draftValidation?: ImportedDraftValidation;
  sourceEvidence?: ImportedSourceEvidence[];
};
export type ImportedAsset = { path: string; name: string; data: Uint8Array; mime?: string };

/** Source locations established by a deterministic import adapter. */
export type ImportedSourceEvidence = {
  readonly kind: 'block';
  readonly blockId: string;
  readonly quote: string;
};

export type ImportWarning = {
  code: MigrationWarningCode;
  message: string;
  detail?: string;
  path?: string;
};

export type ImportResult = {
  title: string;
  parts: ImportedPart[];
  organizationGroups: ImportedOrganizationGroup[];
  items: ImportedItem[];
  assets: ImportedAsset[];
  warnings?: ImportWarning[];
  normalizedSource?: StructuredSourceDocument;
};

export type SniffResult = {
  supported: boolean;
  confidence: number;
  reason?: string;
  hint?: unknown;
};

export type ImportAdapter = {
  id: string;
  version: string;
  label: string;
  extensions: readonly string[];
  priority: number;
  sniff: (source: ImportSource) => Promise<SniffResult>;
  parse: (source: ImportSource, hint?: unknown) => Promise<ImportResult>;
};

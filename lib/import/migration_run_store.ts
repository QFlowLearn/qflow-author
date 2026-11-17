import { parseImportedOrganizationGroups } from './organization_groups.ts';
import {
  conversionSourceArtifacts,
  migrationAssets,
  migrationItems,
  migrationRuns,
} from '../db/schema.ts';
import type { PartOptions } from '../test_export.ts';
import { isQuestionTypeId, labelForTypeId, type QuestionTypeId } from '../types/registry.ts';
import {
  parseEvidenceAnchors,
  parseExtractionUncertainties,
  parseStructuredSourceDocument,
} from '../conversion/source_codec.ts';
import type { EvidenceAnchor, ExtractionUncertainty } from '../conversion/source_model.ts';
import {
  parseNonEmptyString,
  parseNonNegativeInteger,
  parseOptionalSha256,
  parsePositiveInteger,
  parseSha256,
  parseTimestamp,
} from '../persistence_parse.ts';
import type {
  ConversionSourceArtifact,
  MigrationBatchRunSummary,
  MigrationItemDecision,
  MigrationItemReadiness,
  MigrationItemRecord,
  MigrationReviewProgress,
  MigrationRunRecord,
  MigrationSummary,
} from './migration_types.ts';
import { decodeBase64 } from '../base64.ts';

export { decodeBase64, encodeBase64 } from '../base64.ts';
import { parseMigrationWorkflowState } from './migration_state.ts';
import { parseMigrationWarningCode } from './migration_warning_catalog.ts';
import type { ImportedPart, ImportedPlacement, ImportResult, ImportWarning } from './types.ts';
import { parseImportedDraft } from './imported_draft.ts';
import { projectJsonPersistenceObject } from '../canonical_json.ts';
import { parseAcceptedMigrationQuestionSnapshot } from './migration_item_content.ts';
import { parseMigrationDestination } from './migration_destination.ts';
import { parseQuestionReviewSuggestions } from '../question_review_types.ts';
import { parseAssessmentStandaloneContent } from '../assessment_standalone_content.ts';

/** Drizzle JSON columns are typed as Record<string, unknown> at the schema boundary. */
export function toMigrationJsonColumn(value: object): Record<string, unknown> {
  return projectJsonPersistenceObject(value);
}

export function toMigrationWarningJsonColumn(
  warnings: ImportWarning[],
): Array<Record<string, unknown>> {
  return warnings as unknown as Array<Record<string, unknown>>;
}

export function toMigrationEvidenceColumn(
  evidence: readonly EvidenceAnchor[],
): Array<Record<string, unknown>> {
  return evidence as unknown as Array<Record<string, unknown>>;
}

export function toMigrationUncertaintiesColumn(
  uncertainties: readonly ExtractionUncertainty[],
): Array<Record<string, unknown>> {
  return uncertainties as unknown as Array<Record<string, unknown>>;
}

/** Parse a persisted conversion item readiness. */
function normalizeItemReadiness(status: string): MigrationItemReadiness {
  if (
    status === 'ready' || status === 'minor_review' || status === 'major_review' ||
    status === 'blocked'
  ) return status;
  throw new Error(`Invalid conversion item readiness: ${status}`);
}

/** Parse a persisted conversion item decision. */
export function normalizeDecision(status: string | null | undefined): MigrationItemDecision {
  if (status === 'pending' || status === 'accepted' || status === 'rejected') return status;
  throw new Error(`Invalid conversion item decision: ${String(status)}`);
}

type MigrationRunOwnership = {
  readonly purpose: string;
  readonly createdBy: string;
};

type MigrationRunCreator = {
  readonly creatorEmail?: string | null;
  readonly creatorName?: string | null;
};

/** Reconstruct one full migration run from its persistence projections. */
export function mapRunRow(
  row: typeof migrationRuns.$inferSelect,
  ownership: MigrationRunOwnership,
  items: MigrationItemRecord[],
  reviewProgress: MigrationReviewProgress,
  artifacts: ConversionSourceArtifact[],
  creator?: MigrationRunCreator,
): MigrationRunRecord {
  return {
    ...mapRunSummaryRow(row, ownership, creator),
    parts: parseRunParts(row.parts),
    organizationGroups: parseImportedOrganizationGroups(row.organizationGroups),
    reviewProgress,
    items,
    artifacts,
  };
}

/** Reconstruct one lightweight migration run summary from persistence. */
export function mapRunSummaryRow(
  row: typeof migrationRuns.$inferSelect,
  ownership: MigrationRunOwnership,
  creator?: MigrationRunCreator,
): MigrationBatchRunSummary {
  const workflow = parseMigrationWorkflowState(row, ownership.purpose);
  return {
    id: parseNonEmptyString(row.id, 'Conversion run ID is required.'),
    batchId: parseNonEmptyString(row.batchId, 'Conversion batch ID is required.'),
    batchPosition: parsePositiveInteger(
      row.batchPosition,
      'Conversion batch position is invalid.',
    ),
    purpose: workflow.purpose,
    createdBy: parseNonEmptyString(
      ownership.createdBy,
      'Conversion batch creator is required.',
    ),
    creatorEmail: creator?.creatorEmail ?? null,
    creatorName: creator?.creatorName ?? null,
    sourceFilename: parseNonEmptyString(
      row.sourceFilename,
      'Conversion source filename is required.',
    ),
    sourceMime: row.sourceMime ?? null,
    sourceSize: parseNonNegativeInteger(row.sourceSize, 'Conversion source size is invalid.'),
    adapter: {
      id: parseNonEmptyString(row.adapterId, 'Conversion adapter ID is required.'),
      label: parseNonEmptyString(row.adapterLabel, 'Conversion adapter label is required.'),
      version: parseNonEmptyString(
        row.adapterVersion,
        'Conversion adapter version is required.',
      ),
    },
    execution: workflow.execution,
    approval: workflow.approval,
    destination: parseMigrationDestination(row),
    summary: mapSummary(row.summary),
    createdAt: parseTimestamp(row.createdAt, 'Conversion created timestamp is invalid.'),
    updatedAt: parseTimestamp(row.updatedAt, 'Conversion updated timestamp is invalid.'),
  };
}

export function mapItemRow(row: typeof migrationItems.$inferSelect): MigrationItemRecord {
  const itemType = parseQuestionType(row.itemType);
  const draft = parseImportedDraft(row.importedDraft, itemType);
  const title = parseNonEmptyString(row.title, 'Conversion item title is required.');
  if (title !== draft.title) {
    throw new Error('Conversion item title does not match its imported draft.');
  }
  const readiness = normalizeItemReadiness(row.readiness);
  const decision = normalizeDecision(row.decision);
  const reviewedAt = row.reviewedAt
    ? parseTimestamp(row.reviewedAt, 'Conversion item review timestamp is invalid.')
    : null;
  const acceptedSnapshot = row.acceptedSnapshot === null
    ? null
    : parseAcceptedMigrationQuestionSnapshot(row.acceptedSnapshot);
  const acceptedSnapshotHash = parseOptionalSha256(
    row.acceptedSnapshotHash,
    'Accepted snapshot hash is invalid.',
  );
  const createdRevision = row.createdRevision === null
    ? null
    : parsePositiveInteger(row.createdRevision, 'Created question revision is invalid.');
  if (Boolean(row.createdQuestionId) !== Boolean(createdRevision)) {
    throw new Error('Created question ID and revision must be persisted together.');
  }
  if (decision === 'accepted') {
    if (!row.reviewedBy || !reviewedAt || !acceptedSnapshot || !acceptedSnapshotHash) {
      throw new Error('Accepted conversion item is missing its review snapshot.');
    }
    if (readiness === 'blocked') {
      throw new Error('Blocked conversion item cannot be accepted.');
    }
  } else if (acceptedSnapshot || acceptedSnapshotHash) {
    throw new Error('Only accepted conversion items can retain an accepted snapshot.');
  }
  if (decision === 'pending' && (row.reviewedBy || reviewedAt)) {
    throw new Error('Pending conversion item cannot retain reviewer metadata.');
  }
  if (decision === 'rejected' && (!row.reviewedBy || !reviewedAt)) {
    throw new Error('Rejected conversion item is missing reviewer metadata.');
  }
  return {
    id: parseNonEmptyString(row.id, 'Conversion item ID is required.'),
    runId: parseNonEmptyString(row.runId, 'Conversion item run ID is required.'),
    sourceHref: parseNonEmptyString(row.sourceHref, 'Conversion item source href is required.'),
    sourceIdentifier: parseNonEmptyString(
      row.sourceIdentifier,
      'Conversion item source identifier is required.',
    ),
    title,
    itemType,
    itemTypeLabel: labelForTypeId(itemType),
    position: parsePositiveInteger(row.position, 'Conversion item position is invalid.'),
    readiness,
    warnings: parseWarnings(row.warnings),
    sourceXml: parseString(row.sourceXml, 'Conversion item source XML must be a string.'),
    importedDraft: draft,
    blueprintTargetId: row.blueprintTargetId === null
      ? null
      : parseNonEmptyString(row.blueprintTargetId, 'Blueprint target ID must be non-empty.'),
    reviewSuggestions: parseQuestionReviewSuggestions(row.reviewSuggestions),
    createdQuestionId: row.createdQuestionId ?? null,
    createdRevision,
    decision,
    reviewNote: row.reviewNote ?? null,
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt,
    evidence: parseEvidenceAnchors(row.evidence),
    extractionUncertainties: parseExtractionUncertainties(row.extractionUncertainties),
    contentHash: parseSha256(row.contentHash, 'Conversion item content hash is invalid.'),
    contextHash: parseSha256(row.contextHash, 'Conversion item context hash is invalid.'),
    acceptedSnapshot,
    acceptedSnapshotHash,
    createdAt: parseTimestamp(row.createdAt, 'Conversion item created timestamp is invalid.'),
  };
}

export function mapArtifactRow(
  row: typeof conversionSourceArtifacts.$inferSelect,
): ConversionSourceArtifact {
  const base = {
    id: parseNonEmptyString(row.id, 'Source artifact ID is required.'),
    filename: parseNonEmptyString(row.filename, 'Source artifact filename is required.'),
    mimeType: parseNonEmptyString(row.mimeType, 'Source artifact MIME type is required.'),
    size: parseNonNegativeInteger(row.size, 'Source artifact size is invalid.'),
    sha256: parseSha256(row.sha256, 'Source artifact hash is invalid.'),
    storageKey: parseNonEmptyString(row.storageKey, 'Source artifact storage key is required.'),
    createdAt: parseTimestamp(row.createdAt, 'Source artifact timestamp is invalid.'),
  };
  if (row.kind === 'original') {
    if (row.document !== null) {
      throw new Error('Original source artifact cannot contain a normalized document.');
    }
    return { ...base, kind: 'original', document: null };
  }
  if (row.kind === 'normalized') {
    return {
      ...base,
      kind: 'normalized',
      document: parseStructuredSourceDocument(row.document),
    };
  }
  throw new Error(`Invalid conversion source artifact kind: ${row.kind}`);
}

export function importResultFromRun(
  run: MigrationRunRecord,
  assetRows: Array<typeof migrationAssets.$inferSelect>,
): ImportResult {
  const warnings = run.items.flatMap((item) =>
    item.warnings.map((warning) => ({
      ...warning,
      path: warning.path ?? item.sourceHref,
    }))
  );
  const title = parseNonEmptyString(run.summary.title, 'Conversion summary title is required.');
  return {
    title,
    parts: runPartsFromJson(run),
    organizationGroups: run.organizationGroups,
    items: run.items.map((item) => ({
      href: item.sourceHref,
      identifier: item.sourceIdentifier,
      title: item.title,
      xml: item.sourceXml,
      draft: item.importedDraft,
    })),
    assets: assetRows.map((row) => ({
      path: row.sourcePath,
      name: row.name,
      mime: row.mimeType ?? undefined,
      data: decodeBase64(row.dataBase64),
    })),
    warnings: warnings.length ? warnings : undefined,
  };
}

export function runPartsFromJson(run: Pick<MigrationRunRecord, 'parts'>): ImportedPart[] {
  return run.parts.map((value) => {
    assertExactKeys(
      value,
      ['id', 'title', 'placements', 'options'],
      ['id', 'title', 'placements', 'options'],
      'conversion part',
    );
    const placements = parseArray(
      value.placements,
      'Conversion part placements must be an array.',
    ).map(parsePlacement);
    const options = value.options === undefined ? undefined : parsePartOptions(value.options);
    return {
      id: parseNonEmptyString(value.id, 'Conversion part ID is required.'),
      title: parseNonEmptyString(value.title, 'Conversion part title is required.'),
      placements,
      options,
    };
  });
}

function mapSummary(value: unknown): MigrationSummary {
  const row = parseRecord(value, 'Conversion summary must be an object.');
  assertExactKeys(
    row,
    [
      'title',
      'counts',
      'warningCounts',
      'itemTypeCounts',
      'sniff',
      'globalWarnings',
    ],
    ['counts', 'warningCounts', 'itemTypeCounts'],
    'conversion summary',
  );
  const counts = parseRecord(row.counts, 'Conversion summary counts must be an object.');
  assertExactKeys(
    counts,
    ['parts', 'items', 'assets', 'warnings', 'ready', 'reviewNeeded', 'blocked'],
    ['parts', 'items', 'assets', 'warnings', 'ready', 'reviewNeeded', 'blocked'],
    'conversion summary counts',
  );
  const title = row.title === undefined
    ? undefined
    : parseNonEmptyString(row.title, 'Conversion summary title cannot be empty.');
  const sniff = row.sniff === undefined ? undefined : parseSniff(row.sniff);
  const globalWarnings = row.globalWarnings === undefined
    ? undefined
    : parseWarnings(row.globalWarnings);
  return {
    title,
    counts: {
      parts: parseNonNegativeInteger(counts.parts, 'Summary part count is invalid.'),
      items: parseNonNegativeInteger(counts.items, 'Summary item count is invalid.'),
      assets: parseNonNegativeInteger(counts.assets, 'Summary asset count is invalid.'),
      warnings: parseNonNegativeInteger(counts.warnings, 'Summary warning count is invalid.'),
      ready: parseNonNegativeInteger(counts.ready, 'Summary ready count is invalid.'),
      reviewNeeded: parseNonNegativeInteger(
        counts.reviewNeeded,
        'Summary review-needed count is invalid.',
      ),
      blocked: parseNonNegativeInteger(counts.blocked, 'Summary blocked count is invalid.'),
    },
    warningCounts: parseWarningCounts(row.warningCounts),
    itemTypeCounts: parseCountRecord(row.itemTypeCounts, 'Summary item-type counts are invalid.'),
    sniff,
    globalWarnings,
  };
}

function parseRunParts(value: unknown): Array<Record<string, unknown>> {
  return parseArray(value, 'Conversion parts must be an array.').map((part) => {
    const record = parseRecord(part, 'Conversion part must be an object.');
    assertExactKeys(
      record,
      ['id', 'title', 'placements', 'options'],
      ['id', 'title', 'placements', 'options'],
      'conversion part',
    );
    parseNonEmptyString(record.id, 'Conversion part ID is required.');
    parseNonEmptyString(record.title, 'Conversion part title is required.');
    parseArray(record.placements, 'Conversion part placements must be an array.').forEach(
      parsePlacement,
    );
    parsePartOptions(record.options);
    return record;
  });
}

function parsePlacement(value: unknown): ImportedPlacement {
  const record = parseRecord(value, 'Conversion placement must be an object.');
  if ('content' in record) {
    assertExactKeys(
      record,
      ['content', 'refIdentifier'],
      ['content'],
      'conversion content placement',
    );
    const parsed = parseAssessmentStandaloneContent(record.content);
    if (!parsed.ok) throw new Error('Conversion content placement has invalid content.');
    return {
      content: parsed.content,
      refIdentifier: record.refIdentifier === undefined ? undefined : parseNonEmptyString(
        record.refIdentifier,
        'Conversion placement reference identifier cannot be empty.',
      ),
    };
  }
  assertExactKeys(
    record,
    ['href', 'refIdentifier'],
    ['href'],
    'conversion placement',
  );
  const refIdentifier = record.refIdentifier === undefined ? undefined : parseNonEmptyString(
    record.refIdentifier,
    'Conversion placement reference identifier cannot be empty.',
  );
  return {
    href: parseNonEmptyString(record.href, 'Conversion placement href is required.'),
    refIdentifier,
  };
}

function parsePartOptions(value: unknown): PartOptions {
  const record = parseRecord(value, 'Conversion part options must be an object.');
  // SAFETY: PartOptions is a JSON record contract; consumers parse owned option fields.
  return record as PartOptions;
}

function parseQuestionType(value: unknown): QuestionTypeId {
  if (isQuestionTypeId(value)) return value;
  throw new Error(`Invalid conversion item type: ${String(value)}`);
}

function parseWarnings(value: unknown): ImportWarning[] {
  return parseArray(value, 'Conversion warnings must be an array.').map((entry) => {
    const record = parseRecord(entry, 'Conversion warning must be an object.');
    assertExactKeys(
      record,
      ['code', 'message', 'detail', 'path'],
      ['code', 'message'],
      'conversion warning',
    );
    const detail = record.detail === undefined
      ? undefined
      : parseNonEmptyString(record.detail, 'Conversion warning detail cannot be empty.');
    const path = record.path === undefined
      ? undefined
      : parseNonEmptyString(record.path, 'Conversion warning path cannot be empty.');
    return {
      code: parseMigrationWarningCode(
        parseNonEmptyString(record.code, 'Conversion warning code is required.'),
      ),
      message: parseNonEmptyString(record.message, 'Conversion warning message is required.'),
      detail,
      path,
    };
  });
}

function parseCountRecord(value: unknown, message: string): Record<string, number> {
  const record = parseRecord(value, message);
  const counts: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    counts[key] = parseNonNegativeInteger(entry, `${message} Invalid count for "${key}".`);
  }
  return counts;
}

function parseWarningCounts(value: unknown): MigrationSummary['warningCounts'] {
  const counts = parseCountRecord(value, 'Summary warning counts are invalid.');
  return Object.fromEntries(
    Object.entries(counts).map(([code, count]) => [parseMigrationWarningCode(code), count]),
  );
}

function parseSniff(value: unknown): NonNullable<MigrationSummary['sniff']> {
  const record = parseRecord(value, 'Conversion summary sniff result must be an object.');
  assertExactKeys(record, ['confidence', 'reason'], ['confidence'], 'conversion sniff result');
  if (
    typeof record.confidence !== 'number' || !Number.isFinite(record.confidence) ||
    record.confidence < 0 || record.confidence > 1
  ) {
    throw new Error('Conversion summary sniff confidence must be between 0 and 1.');
  }
  const reason = record.reason === undefined
    ? undefined
    : parseNonEmptyString(record.reason, 'Conversion summary sniff reason cannot be empty.');
  return { confidence: record.confidence, reason };
}

function parseRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  // SAFETY: the runtime checks above establish a non-array object boundary.
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key));
  const missing = required.filter((key) => !(key in record));
  if (unknown.length || missing.length) {
    throw new Error(
      `Invalid ${label} keys. Missing: ${missing.join(', ') || 'none'}; unknown: ${
        unknown.join(', ') || 'none'
      }.`,
    );
  }
}

function parseArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(message);
  return value;
}

function parseString(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message);
  return value;
}

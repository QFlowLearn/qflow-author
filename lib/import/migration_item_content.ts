import { assetKey } from '../asset_refs.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import type { EvidenceAnchor, ExtractionUncertainty } from '../conversion/source_model.ts';
import { parseNonEmptyString, parseSha256 } from '../persistence_parse.ts';
import { parseQuestionOrigin, type QuestionOrigin } from '../question_provenance.ts';
import { sha256Hex } from '../sha256.ts';
import type { MigrationItemDecision, MigrationItemReadiness } from './migration_types.ts';
import type { QuestionReviewSuggestion } from '../question_review_types.ts';

/** One source asset whose exact bytes can affect imported question content. */
export type MigrationReviewedAsset = {
  readonly sourcePath: string;
  readonly name: string;
  readonly mimeType: string | null;
  readonly size: number;
  readonly sha256: string;
};

/** One exact diagnostic displayed during review and persisted with imported content. */
export type MigrationReviewedWarning = {
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
  readonly path?: string;
};

/** Every reviewed value that can affect the imported question revision. */
export type MigrationItemContent = {
  readonly sourceName: string;
  readonly title: string;
  readonly itemType: string;
  readonly sourceHref: string;
  readonly sourceIdentifier: string;
  readonly sourceXml: string;
  readonly importedDraft: unknown;
  readonly blueprintTargetId: string | null;
  readonly reviewSuggestions: readonly QuestionReviewSuggestion[];
  readonly warnings: readonly MigrationReviewedWarning[];
  readonly assets: readonly MigrationReviewedAsset[];
};

/** Every review-visible value used to explain or assess one migration item. */
export type MigrationItemContext = {
  readonly readiness: MigrationItemReadiness;
  readonly sourceArtifact: {
    readonly id: string;
    readonly filename: string;
    readonly mimeType: string;
    readonly size: number;
    readonly sha256: string;
  };
  readonly normalizedSourceSha256: string;
  readonly evidence: readonly EvidenceAnchor[];
  readonly extractionUncertainties: readonly ExtractionUncertainty[];
  readonly review: {
    readonly decision: MigrationItemDecision;
    readonly note: string | null;
    readonly reviewedBy: string | null;
    readonly reviewedAt: string | null;
  };
};

type ImportedQuestionOrigin = Extract<QuestionOrigin, { readonly _tag: 'Imported' }>;

/** Complete immutable origin and content identities captured by one accepted review. */
export type AcceptedMigrationQuestionSnapshot = {
  readonly version: 1;
  readonly contentHash: string;
  readonly contextHash: string;
  readonly origin: ImportedQuestionOrigin;
};

/** Current locked content paired with the exact accepted snapshot that authorizes its commit. */
export type ReviewedMigrationQuestionSnapshot = {
  readonly migrationRunId: string;
  readonly migrationItemId: string;
  readonly content: MigrationItemContent;
  readonly context: MigrationItemContext;
  readonly acceptedSnapshot: AcceptedMigrationQuestionSnapshot;
  readonly acceptedSnapshotHash: string;
};

/** Hash the complete conversion item content reviewed before question creation. */
export async function migrationItemContentHash(
  content: MigrationItemContent,
): Promise<string> {
  return await hashCanonicalJson({
    sourceName: content.sourceName,
    title: content.title,
    itemType: content.itemType,
    sourceHref: content.sourceHref,
    sourceIdentifier: content.sourceIdentifier,
    sourceXml: content.sourceXml,
    importedDraft: content.importedDraft,
    blueprintTargetId: content.blueprintTargetId,
    reviewSuggestions: content.reviewSuggestions,
    warnings: content.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.detail === undefined ? {} : { detail: warning.detail }),
      ...(warning.path === undefined ? {} : { path: warning.path }),
    })),
    assets: sortAssets(content.assets),
  });
}

/** Hash the evidence and extraction context presented with one review decision. */
export async function migrationItemContextHash(
  context: MigrationItemContext,
): Promise<string> {
  return await hashCanonicalJson({
    readiness: context.readiness,
    sourceArtifact: context.sourceArtifact,
    normalizedSourceSha256: context.normalizedSourceSha256,
    evidence: context.evidence.map(projectEvidence),
    extractionUncertainties: context.extractionUncertainties.map((uncertainty) => ({
      code: uncertainty.code,
      message: uncertainty.message,
      ...(uncertainty.blockId === undefined ? {} : { blockId: uncertainty.blockId }),
      ...(uncertainty.page === undefined ? {} : { page: uncertainty.page }),
    })),
    review: context.review,
  });
}

/** Parse an accepted migration snapshot from persistence without repairing missing origin facts. */
export function parseAcceptedMigrationQuestionSnapshot(
  value: unknown,
): AcceptedMigrationQuestionSnapshot {
  const record = parseRecord(value, 'Accepted migration snapshot must be an object.');
  assertExactKeys(
    record,
    ['version', 'contentHash', 'contextHash', 'origin'],
    'accepted migration snapshot',
  );
  if (record.version !== 1) throw new Error('Accepted migration snapshot version must be 1.');
  const origin = parseQuestionOrigin(record.origin);
  if (origin._tag !== 'Imported') {
    throw new Error('Accepted migration snapshot requires an imported question origin.');
  }
  return {
    version: 1,
    contentHash: parseSha256(record.contentHash, 'Accepted content hash is invalid.'),
    contextHash: parseSha256(record.contextHash, 'Accepted context hash is invalid.'),
    origin,
  };
}

/** Build an accepted migration snapshot from typed review and origin facts. */
export function createAcceptedMigrationQuestionSnapshot(input: {
  readonly contentHash: string;
  readonly contextHash: string;
  readonly origin: ImportedQuestionOrigin;
}): AcceptedMigrationQuestionSnapshot {
  return parseAcceptedMigrationQuestionSnapshot({
    version: 1,
    contentHash: input.contentHash,
    contextHash: input.contextHash,
    origin: input.origin,
  });
}

/** Hash the complete accepted snapshot, including actor and assistance facts. */
export async function acceptedMigrationQuestionSnapshotHash(
  snapshot: AcceptedMigrationQuestionSnapshot,
): Promise<string> {
  return await hashCanonicalJson(snapshot);
}

/** Verify locked content against its accepted snapshot and return the exact immutable origin. */
export async function verifyReviewedMigrationQuestionSnapshot(
  snapshot: ReviewedMigrationQuestionSnapshot,
): Promise<ImportedQuestionOrigin> {
  const contentHash = await migrationItemContentHash(snapshot.content);
  const contextHash = await migrationItemContextHash(snapshot.context);
  const acceptedSnapshotHash = await acceptedMigrationQuestionSnapshotHash(
    snapshot.acceptedSnapshot,
  );
  if (
    contentHash !== snapshot.acceptedSnapshot.contentHash ||
    contextHash !== snapshot.acceptedSnapshot.contextHash ||
    acceptedSnapshotHash !== snapshot.acceptedSnapshotHash
  ) {
    throw new Error(
      `Conversion item changed after its accepted review: ${snapshot.content.sourceHref}`,
    );
  }

  const review = snapshot.context.review;
  if (
    review.decision !== 'accepted' ||
    !review.reviewedBy ||
    !review.reviewedAt ||
    snapshot.acceptedSnapshot.origin.review.reviewer.id !== review.reviewedBy
  ) {
    throw new Error('Accepted migration snapshot has contradictory reviewer facts.');
  }
  const acceptedOrigin = snapshot.acceptedSnapshot.origin;
  const expectedOrigin = parseQuestionOrigin({
    _tag: 'Imported',
    artifact: snapshot.context.sourceArtifact,
    migrationRunId: parseNonEmptyString(
      snapshot.migrationRunId,
      'Migration run ID is required.',
    ),
    migrationItemId: parseNonEmptyString(
      snapshot.migrationItemId,
      'Migration item ID is required.',
    ),
    href: snapshot.content.sourceHref,
    identifier: snapshot.content.sourceIdentifier,
    providedBy: acceptedOrigin.providedBy,
    assistance: acceptedOrigin.assistance,
    evidence: snapshot.context.evidence,
    review: {
      decision: 'accepted',
      reviewer: acceptedOrigin.review.reviewer,
      reviewedAt: review.reviewedAt,
      note: review.note,
      contentHash,
      contextHash,
    },
  });
  if (
    expectedOrigin._tag !== 'Imported' ||
    canonicalJsonStringify(expectedOrigin) !== canonicalJsonStringify(acceptedOrigin)
  ) {
    throw new Error('Accepted migration snapshot does not match its reviewed origin.');
  }
  return acceptedOrigin;
}

function projectEvidence(evidence: EvidenceAnchor): object {
  switch (evidence.kind) {
    case 'text_range':
      return {
        kind: evidence.kind,
        artifactId: evidence.artifactId,
        artifactHash: evidence.artifactHash,
        start: evidence.start,
        end: evidence.end,
        quote: evidence.quote,
      };
    case 'block':
      return {
        kind: evidence.kind,
        artifactId: evidence.artifactId,
        artifactHash: evidence.artifactHash,
        blockId: evidence.blockId,
        quote: evidence.quote,
      };
    case 'page':
      return {
        kind: evidence.kind,
        artifactId: evidence.artifactId,
        artifactHash: evidence.artifactHash,
        page: evidence.page,
        quote: evidence.quote,
      };
    case 'package_entry':
      return {
        kind: evidence.kind,
        artifactId: evidence.artifactId,
        artifactHash: evidence.artifactHash,
        path: evidence.path,
        ...(evidence.identifier === undefined ? {} : { identifier: evidence.identifier }),
      };
  }
}

function sortAssets(
  assets: readonly MigrationReviewedAsset[],
): readonly MigrationReviewedAsset[] {
  const keys = new Set<string>();
  const keyed = assets.map((asset) => {
    const key = assetKey(asset.sourcePath);
    if (!key) throw new Error('Migration asset source path is required.');
    if (keys.has(key)) {
      throw new Error(`Migration assets must have unique canonical source paths: ${key}`);
    }
    keys.add(key);
    return { key, asset };
  });
  return keyed
    .sort((left, right) => compareOrdinal(left.key, right.key))
    .map(({ asset }) => asset);
}

async function hashCanonicalJson(value: unknown): Promise<string> {
  const canonical = canonicalJsonStringify(value);
  return await sha256Hex(new TextEncoder().encode(canonical));
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  // SAFETY: the runtime checks above establish a non-array object boundary.
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const expectedKeys = new Set(expected);
  const unknown = Object.keys(record).filter((key) => !expectedKeys.has(key));
  const missing = expected.filter((key) => !Object.hasOwn(record, key));
  if (unknown.length || missing.length) {
    throw new Error(
      `Invalid ${label} keys. Missing: ${missing.join(', ') || 'none'}; unknown: ${
        unknown.join(', ') || 'none'
      }.`,
    );
  }
}

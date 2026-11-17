import { migrationAssets } from '../db/schema.ts';
import type { MigrationReviewedAsset } from './migration_item_content.ts';
import type { MigrationRunRecord } from './migration_types.ts';

type MigrationArtifact = MigrationRunRecord['artifacts'][number];
type NormalizedArtifact = Extract<MigrationArtifact, { readonly kind: 'normalized' }>;
type OriginalArtifact = Extract<MigrationArtifact, { readonly kind: 'original' }>;

/** Project persisted migration assets into the stable review-hash representation. */
export function reviewedAssetsFromRows(
  rows: readonly (typeof migrationAssets.$inferSelect)[],
): MigrationReviewedAsset[] {
  return rows.map((row) => ({
    sourcePath: row.sourcePath,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    sha256: row.sha256,
  }));
}

/** Require the single normalized artifact attached to a migration run. */
export function requireNormalizedArtifact(run: MigrationRunRecord): NormalizedArtifact {
  return requireNormalizedArtifactFromList(run.artifacts);
}

/** Require exactly one normalized artifact from a migration artifact list. */
export function requireNormalizedArtifactFromList(
  artifacts: readonly MigrationArtifact[],
): NormalizedArtifact {
  const matches = artifacts.filter(isNormalizedArtifact);
  if (matches.length !== 1) {
    throw new Error('Conversion commit requires exactly one normalized source artifact.');
  }
  return matches[0];
}

/** Require exactly one original artifact from a migration artifact list. */
export function requireOriginalArtifact(
  artifacts: readonly MigrationArtifact[],
): OriginalArtifact {
  const matches = artifacts.filter(isOriginalArtifact);
  if (matches.length !== 1) {
    throw new Error('Conversion commit requires exactly one original source artifact.');
  }
  return matches[0];
}

/** Project the stable source identity stored in question provenance. */
export function sourceArtifactIdentity(artifact: OriginalArtifact): {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly sha256: string;
} {
  return {
    id: artifact.id,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    size: artifact.size,
    sha256: artifact.sha256,
  };
}

function isNormalizedArtifact(artifact: MigrationArtifact): artifact is NormalizedArtifact {
  return artifact.kind === 'normalized';
}

function isOriginalArtifact(artifact: MigrationArtifact): artifact is OriginalArtifact {
  return artifact.kind === 'original';
}

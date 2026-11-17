import { assetKey } from '../asset_refs.ts';
import { questionSelectionIdentity } from '../question_selection_identity.ts';
import { sha256Hex } from '../sha256.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { migrationAssets, migrationItems } from '../db/schema.ts';
import {
  type EvidenceAnchor,
  sourceBlockText,
  type StructuredSourceDocument,
} from '../conversion/source_model.ts';
import { buildMigrationAnalysis } from './migration_analysis.ts';
import {
  migrationItemContentHash,
  migrationItemContextHash,
  type MigrationReviewedAsset,
} from './migration_item_content.ts';
import type { ClaimedMigrationRun } from './migration_jobs.ts';
import {
  encodeBase64,
  toMigrationEvidenceColumn,
  toMigrationJsonColumn,
  toMigrationUncertaintiesColumn,
  toMigrationWarningJsonColumn,
} from './migration_run_store.ts';
import type { ImportedSourceEvidence, ImportResult } from './types.ts';
export type PreparedAsset = typeof migrationAssets.$inferInsert;
export type PreparedItem = typeof migrationItems.$inferInsert;
export async function prepareAnalysisRows(input: {
  readonly job: ClaimedMigrationRun;
  readonly sourceName: string;
  readonly parsed: ImportResult;
  readonly analysis: ReturnType<typeof buildMigrationAnalysis>;
  readonly document: StructuredSourceDocument;
  readonly sourceArtifact: {
    readonly id: string;
    readonly filename: string;
    readonly mimeType: string;
    readonly size: number;
    readonly sha256: string;
  };
  readonly preparedAssets?: PreparedAsset[];
  readonly normalized: { readonly id: string; readonly sha256: string };
}): Promise<{ readonly assets: PreparedAsset[]; readonly items: PreparedItem[] }> {
  const now = new Date();
  const assets: PreparedAsset[] = input.preparedAssets ?? [];
  const sourcePaths = new Set<string>();
  for (const [index, asset] of input.parsed.assets.entries()) {
    const sourcePath = assetKey(asset.path);
    if (!sourcePath) throw new Error('Migration asset source path is required.');
    if (sourcePaths.has(sourcePath)) {
      throw new Error(`Migration assets must have unique canonical source paths: ${sourcePath}`);
    }
    sourcePaths.add(sourcePath);
    assets.push({
      id: await uuidV5(input.job.id, `migration-asset:${index + 1}:${sourcePath}`),
      runId: input.job.id,
      sourcePath,
      name: asset.name,
      mimeType: asset.mime ?? null,
      size: asset.data.byteLength,
      sha256: await sha256Hex(asset.data),
      dataBase64: encodeBase64(asset.data),
      createdAt: now,
    });
  }
  const reviewedAssets: MigrationReviewedAsset[] = assets.map((asset) => ({
    sourcePath: asset.sourcePath,
    name: asset.name,
    mimeType: asset.mimeType ?? null,
    size: asset.size,
    sha256: asset.sha256,
  }));

  const items: PreparedItem[] = [];
  for (const item of input.analysis.items) {
    const importedDraft = toMigrationJsonColumn(item.importedDraft);
    const evidence = buildImportedEvidence({
      document: input.document,
      artifactId: input.normalized.id,
      artifactHash: input.normalized.sha256,
      item: {
        href: item.sourceHref,
        identifier: item.sourceIdentifier,
        sourceEvidence: item.sourceEvidence,
      },
    });
    const contentHash = await migrationItemContentHash({
      sourceName: input.sourceName,
      title: item.title,
      itemType: item.itemType,
      sourceHref: item.sourceHref,
      sourceIdentifier: item.sourceIdentifier,
      sourceXml: item.sourceXml,
      importedDraft,
      blueprintTargetId: null,
      reviewSuggestions: [],
      warnings: item.warnings,
      assets: reviewedAssets,
    });
    const contextHash = await migrationItemContextHash({
      readiness: item.readiness,
      sourceArtifact: input.sourceArtifact,
      normalizedSourceSha256: input.normalized.sha256,
      evidence,
      extractionUncertainties: input.document.uncertainties,
      review: {
        decision: 'pending',
        note: null,
        reviewedBy: null,
        reviewedAt: null,
      },
    });
    items.push({
      id: await uuidV5(
        input.job.id,
        `migration-item:${item.position}:${item.sourceIdentifier}:${item.sourceHref}`,
      ),
      runId: input.job.id,
      sourceHref: item.sourceHref,
      sourceIdentifier: item.sourceIdentifier,
      title: item.title,
      itemType: item.itemType,
      position: item.position,
      readiness: item.readiness,
      warnings: toMigrationWarningJsonColumn(item.warnings),
      sourceXml: item.sourceXml,
      importedDraft,
      blueprintTargetId: null,
      reviewSuggestions: [],
      evidence: toMigrationEvidenceColumn(evidence),
      // Uncertain recovery must never become an assertion of complete content equality.
      exactContentIdentity: item.readiness === 'ready'
        ? await questionSelectionIdentity(item.sourceXml)
        : null,
      extractionUncertainties: toMigrationUncertaintiesColumn(input.document.uncertainties),
      contentHash,
      contextHash,
      decision: 'pending',
      createdAt: now,
    });
  }
  return { assets, items };
}

function buildImportedEvidence(input: {
  readonly document: StructuredSourceDocument;
  readonly artifactId: string;
  readonly artifactHash: string;
  readonly item: {
    readonly href: string;
    readonly identifier: string;
    readonly sourceEvidence?: readonly ImportedSourceEvidence[];
  };
}): EvidenceAnchor[] {
  if (!input.item.sourceEvidence?.length) {
    return [{
      kind: 'package_entry',
      artifactId: input.artifactId,
      artifactHash: input.artifactHash,
      path: input.item.href,
      identifier: input.item.identifier,
    }];
  }
  return input.item.sourceEvidence.map((evidence) => {
    const block = input.document.blocks.find((candidate) => candidate.id === evidence.blockId);
    if (!block) {
      throw new Error(
        `Import adapter cited missing normalized source block "${evidence.blockId}".`,
      );
    }
    const sourceText = sourceBlockText(block);
    const quote = evidence.quote.trim();
    if (!quote || !sourceText.includes(quote)) {
      throw new Error(
        `Import adapter evidence quote was not found in source block "${evidence.blockId}".`,
      );
    }
    return {
      kind: 'block' as const,
      artifactId: input.artifactId,
      artifactHash: input.artifactHash,
      blockId: evidence.blockId,
      quote,
    };
  });
}

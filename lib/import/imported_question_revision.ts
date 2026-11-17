import type { OrganizationTransfer } from '../organization_transfer.ts';
import type { ImportedQuestionProvenanceCommand } from '../question_provenance.ts';
import { assetKey } from '../asset_refs.ts';
import type { StoredUpload } from '../uploads.ts';
import { normalizeDraftForDriver, resolveDriver } from '../types/draft_utils.ts';
import type { Draft } from '../types/draft.ts';
import { rewriteImportedAssetReferences } from './imported_asset_references.ts';
import {
  type MigrationItemContent,
  type ReviewedMigrationQuestionSnapshot,
  verifyReviewedMigrationQuestionSnapshot,
} from './migration_item_content.ts';
import { parseImportedDraft } from './imported_draft.ts';
import { rewriteImportedDraft } from './package_asset_references.ts';
import { isQuestionTypeId } from '../types/registry.ts';
import type { QuestionReviewSuggestion } from '../question_review_types.ts';
import {
  type PreparedQuestionRevision,
  prepareQuestionRevision,
} from '../question_revision_preparation.ts';

const VERIFIED_IMPORTED_QUESTION_REVISION = Symbol('verified-imported-question-revision');

/** Staged upload whose exact source bytes remain bound to the accepted review. */
export type ReviewedAssetUpload = StoredUpload & { readonly sourceSha256: string };

type ImportedQuestionRevisionInput = {
  readonly questionId: string;
  readonly title: string;
  readonly tags: string[];
  readonly body: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly reviewSuggestions: readonly QuestionReviewSuggestion[];
  readonly qtiXml: string;
  readonly note: string;
  readonly draftState: 'published';
};

/** Question content and provenance produced only after its complete reviewed identity is verified. */
export type VerifiedImportedQuestionRevision = {
  readonly [VERIFIED_IMPORTED_QUESTION_REVISION]: true;
  readonly input: PreparedQuestionRevision<ImportedQuestionRevisionInput>;
  readonly provenance: ImportedQuestionProvenanceCommand;
  readonly organization: OrganizationTransfer | null;
};

/** Open a verified import capability and reject forged structural values at runtime. */
export function openVerifiedImportedQuestionRevision(
  revision: VerifiedImportedQuestionRevision,
): Pick<VerifiedImportedQuestionRevision, 'input' | 'provenance'> {
  if (
    !revision ||
    typeof revision !== 'object' ||
    revision[VERIFIED_IMPORTED_QUESTION_REVISION] !== true
  ) {
    throw new Error('Imported question revision was not produced by the review verifier.');
  }
  return { input: revision.input, provenance: revision.provenance };
}

/** Verify accepted source content and derive the only imported question save payload. */
export async function prepareVerifiedImportedQuestionRevision(input: {
  readonly snapshot: ReviewedMigrationQuestionSnapshot;
  readonly assetUploads: ReadonlyMap<string, ReviewedAssetUpload>;
}): Promise<VerifiedImportedQuestionRevision> {
  const { snapshot, assetUploads } = input;
  const { content } = snapshot;
  const origin = await verifyReviewedMigrationQuestionSnapshot(snapshot);
  assertStagedAssets(content, assetUploads);
  const itemType = content.itemType;
  if (!isQuestionTypeId(itemType)) {
    throw new Error(`Unsupported reviewed question type: ${content.itemType}`);
  }
  const { importOrganization, ...importedDraft } = parseImportedDraft(
    content.importedDraft,
    itemType,
  );
  const organization = importOrganization ?? null;

  const rewrittenXml =
    rewriteImportedAssetReferences(content.sourceXml, assetUploads, content.sourceHref) ??
      content.sourceXml;
  const hasUnsupportedStub = content.warnings.some((warning) =>
    warning.code === 'UNSUPPORTED_ITEM_STUBBED'
  );
  const rewrittenDraft = tagImportedDraft(
    rewriteImportedDraft(importedDraft, content.sourceHref, assetUploads),
  );
  const draft = content.warnings.length
    ? {
      ...rewrittenDraft,
      importWarnings: [...content.warnings],
      preserveSourceXml: rewrittenDraft.preserveSourceXml ?? hasUnsupportedStub,
    }
    : rewrittenDraft;
  const { typeId, driver } = resolveDriver(draft);
  const normalized = normalizeDraftForDriver(typeId, { ...draft, type: typeId }) as Draft;
  const validationErrors = driver.validate(normalized);
  if (validationErrors.length) {
    throw new Error(
      `Question "${content.title}" is invalid: ${validationErrors.join(' ')}`,
    );
  }
  const serialized = driver.serialize(normalized);
  if (serialized.title !== content.title) {
    throw new Error('Reviewed question title does not match its serialized draft.');
  }
  const metadata: Record<string, unknown> = {
    source: 'qti-import',
    href: content.sourceHref,
  };
  if (content.warnings.length) metadata.importWarnings = content.warnings;

  const revisionInput = await prepareQuestionRevision({
    questionId: crypto.randomUUID(),
    title: serialized.title,
    tags: serialized.tags ?? ['imported'],
    body: serialized as Record<string, unknown>,
    reviewSuggestions: content.reviewSuggestions,
    metadata,
    qtiXml: rewrittenXml,
    note: `Imported from ${content.sourceName}`,
    draftState: 'published' as const,
  });

  return {
    [VERIFIED_IMPORTED_QUESTION_REVISION]: true,
    input: revisionInput,
    organization,
    provenance: {
      _tag: 'Migration',
      origin,
    },
  };
}

function assertStagedAssets(
  content: MigrationItemContent,
  staged: ReadonlyMap<string, ReviewedAssetUpload>,
): void {
  const reviewed = new Map(content.assets.map((asset) => [assetKey(asset.sourcePath), asset]));
  for (const [key, upload] of staged) {
    const expected = reviewed.get(key);
    if (
      !expected ||
      expected.name !== upload.name ||
      expected.size !== upload.size ||
      expected.sha256 !== upload.sourceSha256
    ) {
      throw new Error(`Staged conversion asset changed after review: ${key}`);
    }
  }
}

function tagImportedDraft(draft: Draft): Draft {
  const tags = Array.isArray(draft.tags)
    ? Array.from(new Set([...draft.tags, 'imported']))
    : ['imported'];
  return { ...draft, tags };
}

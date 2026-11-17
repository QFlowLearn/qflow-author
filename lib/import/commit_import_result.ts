import { importOrganizationTransfers } from '../services/question_organization_transfer.ts';
import { registerOrganizationIntake } from '../services/question_organization_intake.ts';
import { filePublishedBankQuestionsInTransaction } from '../services/bank_collections.ts';
import type {
  MigrationCommittedDestination,
  ReadyMigrationDestination,
} from './migration_destination.ts';
import { assetKey } from '../asset_refs.ts';
import { saveAssessmentInTransaction } from '../services/assessment_records.ts';
import {
  type QuestionTransaction,
  saveImportedQuestionRevisionsInTransaction,
} from '../services/questions.ts';
import { cleanupObjectKeys, type ObjectCleanupFailure } from '../object_storage_compensation.ts';
import type { ObjectWriteLifecycle } from '../storage_contract.ts';
import type { RequestContext } from '../tenants.ts';
import { insertStagedUploadInTransaction, stageUpload } from '../uploads.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { sha256Hex } from '../sha256.ts';
import { summarizeImportWarnings } from './import_warnings.ts';
import {
  collectReferencedPackageAssetKeys,
  rewriteImportedPartOptions,
  rewriteImportedStandaloneContent,
} from './package_asset_references.ts';
import { normalizePath } from './package_paths.ts';
import type { ImportResult } from './types.ts';
import {
  prepareVerifiedImportedQuestionRevision,
  type ReviewedAssetUpload,
  type VerifiedImportedQuestionRevision,
} from './imported_question_revision.ts';
import type { ReviewedMigrationQuestionSnapshot } from './migration_item_content.ts';
import { mapConcurrentBounded } from '../bounded_concurrency.ts';

/** Content staged outside a database transaction for one idempotent conversion commit. */
export type StagedImportAssets = ReadonlyMap<string, ReviewedAssetUpload>;

/** Tenant-validated migration item references used to resolve question provenance at commit. */
export type MigrationQuestionReferences = {
  readonly itemsByHref: ReadonlyMap<string, ReviewedMigrationQuestionSnapshot>;
};

/** Verified question revisions whose QTI projections were completed before commit. */
export type PreparedImportQuestionRevisions = ReadonlyMap<
  string,
  {
    readonly acceptedSnapshotHash: string;
    readonly revision: VerifiedImportedQuestionRevision;
  }
>;

const QUESTION_PREPARATION_CONCURRENCY = 4;

/** Signals that import objects remain after a failed operation and compensating cleanup. */
export class ImportAssetCleanupRequiredError extends Error {
  readonly _tag = 'ImportAssetCleanupRequiredError' as const;

  constructor(
    readonly idempotencyKey: string,
    readonly objectKeys: ReadonlyArray<string>,
    operationCause: unknown,
    readonly cleanupFailures: ReadonlyArray<ObjectCleanupFailure>,
  ) {
    super(
      operationCause === undefined
        ? 'Import asset cleanup failed.'
        : 'Import asset operation and object cleanup both failed.',
      operationCause === undefined ? undefined : { cause: operationCause },
    );
    this.name = 'ImportAssetCleanupRequiredError';
  }
}

/** The reviewed question changed while its expensive revision preparation was in flight. */
export class ImportQuestionPreparationInvalidatedError extends Error {
  readonly _tag = 'ImportQuestionPreparationInvalidatedError' as const;

  constructor(readonly href: string) {
    super('The migration changed while its question revisions were being prepared.');
    this.name = 'ImportQuestionPreparationInvalidatedError';
  }
}

/** Verifies reviewed content and prepares its bank projections outside the commit transaction. */
export async function prepareImportQuestionRevisions(
  references: MigrationQuestionReferences,
  assetUploads: StagedImportAssets,
): Promise<PreparedImportQuestionRevisions> {
  const entries = [...references.itemsByHref.entries()];
  const prepared = await mapConcurrentBounded(
    entries,
    { concurrency: QUESTION_PREPARATION_CONCURRENCY },
    async ([href, snapshot]) => ({
      href,
      acceptedSnapshotHash: snapshot.acceptedSnapshotHash,
      revision: await prepareVerifiedImportedQuestionRevision({ snapshot, assetUploads }),
    }),
  );
  return new Map(prepared.map((entry) => [entry.href, entry]));
}

function assertPreparedImportQuestionIsCurrent(
  href: string,
  preparedSnapshotHash: string,
  currentSnapshotHash: string,
): void {
  if (preparedSnapshotHash !== currentSnapshotHash) {
    throw new ImportQuestionPreparationInvalidatedError(href);
  }
}

function requirePreparedImportQuestionRevision(
  href: string,
  acceptedSnapshotHash: string,
  preparedQuestionRevisions: PreparedImportQuestionRevisions,
): VerifiedImportedQuestionRevision {
  const prepared = preparedQuestionRevisions.get(href);
  if (!prepared) {
    throw new Error(`Conversion item is missing its prepared question revision: ${href}`);
  }
  assertPreparedImportQuestionIsCurrent(
    href,
    prepared.acceptedSnapshotHash,
    acceptedSnapshotHash,
  );
  return prepared.revision;
}

/** Upload referenced package assets under object identities owned by one commit attempt. */
export async function stageImportAssets(
  ctx: RequestContext,
  parsed: ImportResult,
  input: {
    readonly idempotencyKey: string;
    readonly attemptId: string;
    readonly storage: ObjectWriteLifecycle;
  },
): Promise<StagedImportAssets> {
  const assetLookup = new Map(parsed.assets.map((asset) => [assetKey(asset.path), asset]));
  const referencedAssets = collectReferencedPackageAssetKeys(parsed, assetLookup);
  const now = new Date().toISOString();
  const staged = new Map<string, ReviewedAssetUpload>();
  try {
    for (const key of referencedAssets) {
      const asset = assetLookup.get(key);
      if (!asset) throw new Error(`Referenced package asset is missing: ${key}`);
      const uploadId = await uuidV5(
        input.attemptId,
        `conversion:${ctx.tenantId}:asset:${key}`,
      );
      const sourceSha256 = await sha256Hex(asset.data);
      const stored = await stageUpload(ctx, asset.data, {
        id: uploadId,
        name: asset.name,
        type: asset.mime,
        now,
        storage: input.storage,
      });
      staged.set(key, {
        ...stored,
        sourceSha256,
      });
    }
  } catch (cause: unknown) {
    await throwAfterImportAssetCleanup(input, staged, cause);
  }
  return staged;
}

/** Delete every object owned by an import attempt that did not commit. */
export async function cleanupStagedImportAssets(
  input: {
    readonly idempotencyKey: string;
    readonly storage: ObjectWriteLifecycle;
  },
  staged: StagedImportAssets,
  operationCause?: unknown,
): Promise<void> {
  const objectKeys = [...staged.values()].map((upload) => upload.path);
  const cleanupFailures = await cleanupObjectKeys(input.storage, objectKeys);
  if (cleanupFailures.length === 0) return;
  throw new ImportAssetCleanupRequiredError(
    input.idempotencyKey,
    objectKeys,
    operationCause,
    cleanupFailures,
  );
}

/** Re-throw an import failure after deleting every object staged before it. */
export async function throwAfterImportAssetCleanup(
  input: {
    readonly idempotencyKey: string;
    readonly storage: ObjectWriteLifecycle;
  },
  staged: StagedImportAssets,
  cause: unknown,
): Promise<never> {
  await cleanupStagedImportAssets(input, staged, cause);
  throw cause;
}

/** Commit questions, assessment, placements, and upload metadata in one transaction. */
export async function commitImportResultInTransaction(
  tx: QuestionTransaction,
  ctx: RequestContext,
  parsed: ImportResult,
  sourceName: string,
  assetUploads: StagedImportAssets,
  questionReferences: MigrationQuestionReferences,
  preparedQuestionRevisions: PreparedImportQuestionRevisions,
  destination: ReadyMigrationDestination,
): Promise<{
  destination: MigrationCommittedDestination;
  itemResults: Array<{ href: string; questionId: string; revision: number }>;
}> {
  for (const upload of assetUploads.values()) {
    await insertStagedUploadInTransaction(tx, ctx, upload);
  }

  const importWarnings = parsed.warnings ?? [];
  const itemMapping = new Map<
    string,
    { itemId: string; rev: number; blueprintTargetId: string | null }
  >();
  const itemResults: Array<{ href: string; questionId: string; revision: number }> = [];
  const pendingQuestions = parsed.items.map((item) => {
    const normalizedHref = normalizePath(item.href);
    const snapshot = questionReferences.itemsByHref.get(normalizedHref);
    if (!snapshot) {
      throw new Error(`Conversion item is missing its migration reference: ${item.href}`);
    }
    const preparedQuestionRevision = requirePreparedImportQuestionRevision(
      normalizedHref,
      snapshot.acceptedSnapshotHash,
      preparedQuestionRevisions,
    );
    return { item, normalizedHref, snapshot, preparedQuestionRevision };
  });
  const savedQuestions = await saveImportedQuestionRevisionsInTransaction(
    tx,
    ctx,
    pendingQuestions.map(({ preparedQuestionRevision }) => preparedQuestionRevision),
  );
  if (savedQuestions.length !== pendingQuestions.length) {
    throw new Error('Question revision batch returned an unexpected result count.');
  }
  for (const [index, { item, normalizedHref, snapshot }] of pendingQuestions.entries()) {
    const result = savedQuestions[index];
    if (destination._tag === 'Assessment') {
      itemMapping.set(normalizedHref, {
        itemId: result.questionId,
        rev: result.revision,
        blueprintTargetId: requireBlueprintTargetId(snapshot.content.blueprintTargetId, item.title),
      });
    }
    itemResults.push({
      href: item.href,
      questionId: result.questionId,
      revision: result.revision,
    });
  }

  await importOrganizationTransfers(
    tx,
    ctx,
    pendingQuestions.flatMap(({ preparedQuestionRevision }, index) =>
      preparedQuestionRevision.organization
        ? [{
          questionId: savedQuestions[index].questionId,
          revisionId: savedQuestions[index].revisionId,
          transfer: preparedQuestionRevision.organization,
        }]
        : []
    ),
    new Date(),
  );

  if (destination._tag === 'WorkspaceBank') {
    if (destination.collectionId !== null) {
      await filePublishedBankQuestionsInTransaction(
        tx,
        ctx,
        destination.collectionId,
        itemResults.map((item) => item.questionId),
        new Date(),
      );
      // Index source groups once; a question in several sections has no automatic source mapping.
      const sectionByHref = new Map<string, string | null>();
      const sectionIds = new Set<string>();
      for (const group of parsed.organizationGroups) {
        if (!group.id.trim() || group.id.length > 256 || sectionIds.has(group.id)) {
          throw new Error('Imported section identity is invalid or repeated.');
        }
        sectionIds.add(group.id);
        for (const sourceHref of group.hrefs) {
          const href = normalizePath(sourceHref);
          const previous = sectionByHref.get(href);
          sectionByHref.set(
            href,
            previous === undefined || previous === group.id ? group.id : null,
          );
        }
      }
      await registerOrganizationIntake(
        tx,
        ctx,
        destination.collectionId,
        pendingQuestions.map(({ item, snapshot }, index) => {
          const sectionKey = sectionByHref.get(normalizePath(item.href));
          return {
            questionId: savedQuestions[index].questionId,
            source: typeof sectionKey === 'string'
              ? { sourceId: snapshot.context.sourceArtifact.id, sectionKey }
              : null,
          };
        }),
        new Date(),
      );
    }
    return { destination, itemResults };
  }

  const storedParts = parsed.parts.map((part) => ({
    id: crypto.randomUUID(),
    title: part.title,
    placements: part.placements.map((placement) => {
      if ('content' in placement) {
        return {
          id: crypto.randomUUID(),
          content: rewriteImportedStandaloneContent(placement.content, assetUploads),
          fixed: true as const,
        };
      }
      const mapping = itemMapping.get(normalizePath(placement.href));
      if (!mapping) {
        throw new Error(`Assessment references missing item file: ${placement.href}`);
      }
      return {
        id: crypto.randomUUID(),
        itemId: mapping.itemId,
        snapshotRev: mapping.rev,
        blueprintTargetId: requireBlueprintTargetId(mapping.blueprintTargetId, placement.href),
      };
    }),
    options: rewriteImportedPartOptions(part.options, assetUploads),
  }));
  if (!storedParts.length) throw new Error('Conversion commit requires at least one part.');

  const totalItems = storedParts.reduce(
    (sum, part) => sum + part.placements.filter((placement) => 'itemId' in placement).length,
    0,
  );
  const assessmentId = crypto.randomUUID();
  await saveAssessmentInTransaction(tx, ctx, {
    id: assessmentId,
    title: parsed.title,
    brief: `Imported from ${sourceName}`,
    targetCount: totalItems,
    tags: ['imported'],
    metadata: {
      importSource: sourceName,
      importWarnings: summarizeImportWarnings(importWarnings),
    },
    blueprint: destination.blueprint,
    parts: storedParts,
  });

  return { destination: { _tag: 'Assessment', assessmentId }, itemResults };
}

function requireBlueprintTargetId(value: string | null, title: string): string {
  if (!value) throw new Error(`Question "${title}" is missing its blueprint alignment.`);
  return value;
}

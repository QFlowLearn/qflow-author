import {
  authorizeBankIntakeInTransaction,
  canStartBankIntake,
} from '../services/bank_intake_access.ts';
import { and, eq, sql } from 'drizzle-orm';

import {
  assertMigrationDestinationCoverage,
  requireReadyMigrationDestination,
} from './migration_destination.ts';
import { db } from '../db.ts';
import {
  conversionSourceArtifacts,
  migrationAssets,
  migrationBatches,
  migrationCommitJobs,
  migrationItems,
  migrationRuns,
} from '../db/schema.ts';
import { recordAuditEventInTransaction } from '../services/audit_logs.ts';
import type { ObjectWriteLifecycle } from '../storage_contract.ts';
import { type RequestContext, resolveUserId } from '../tenants.ts';
import {
  cleanupStagedImportAssets,
  commitImportResultInTransaction,
  type MigrationQuestionReferences,
  prepareImportQuestionRevisions,
  stageImportAssets,
  throwAfterImportAssetCleanup,
} from './commit_import_result.ts';
import { buildReviewProgress } from './migration_analysis.ts';
import type { ReviewedMigrationQuestionSnapshot } from './migration_item_content.ts';
import {
  importResultFromRun,
  mapArtifactRow,
  mapItemRow,
  mapRunRow,
  runPartsFromJson,
  toMigrationJsonColumn,
} from './migration_run_store.ts';
import { getMigrationRun } from './migration_run_queries.ts';
import {
  requireNormalizedArtifact,
  requireOriginalArtifact,
  reviewedAssetsFromRows,
  sourceArtifactIdentity,
} from './migration_source_evidence.ts';
import type { MigrationItemRecord, MigrationRunRecord } from './migration_types.ts';
import { normalizePath } from './package_paths.ts';

type MigrationCommitResult = Awaited<ReturnType<typeof commitImportResultInTransaction>>;
type MigrationCommitAttemptOutcome =
  | { readonly _tag: 'Committed'; readonly result: MigrationCommitResult }
  | { readonly _tag: 'Replayed'; readonly result: MigrationCommitResult };

/** Commit the explicitly approved migration selection exactly once. */
export async function commitMigrationRun(
  ctx: RequestContext,
  id: string,
  opts: {
    readonly storage: ObjectWriteLifecycle;
    readonly approvedItemIds: string[];
    readonly approval: boolean;
  },
): Promise<MigrationCommitResult> {
  const run = await getMigrationRun(ctx, id);
  if (!run) throw new Error('Migration run not found.');
  if (run.destination._tag === 'WorkspaceBank') {
    const { collectionId } = run.destination;
    if (!await canStartBankIntake(ctx, collectionId, db)) {
      throw new Error('Bank intake destination is unavailable.');
    }
  }
  if (run.execution._tag === 'Failed') {
    throw new Error(run.execution.failure);
  }
  if (run.execution._tag === 'Queued' || run.execution._tag === 'Analyzing') {
    throw new Error('Migration analysis must finish before commit.');
  }
  if (run.purpose === 'recover_existing' && run.approval._tag !== 'Approved') {
    throw new Error('The assigned reviewer must approve this conversion before commit.');
  }
  if (run.execution._tag === 'Committed') {
    return replayCommittedMigration(run);
  }
  const approvedIds = assertConversionCommitApproval(
    run,
    opts.approvedItemIds,
    opts.approval,
  );

  const assetRows = await db.select().from(migrationAssets).where(eq(migrationAssets.runId, id));
  const parsed = importResultFromRun(selectApprovedRun(run, approvedIds), assetRows);
  const stagedAssets = await stageImportAssets(ctx, parsed, {
    idempotencyKey: id,
    attemptId: crypto.randomUUID(),
    storage: opts.storage,
  });
  let outcome: MigrationCommitAttemptOutcome;
  try {
    const initialQuestionReferences = buildMigrationQuestionReferences(
      run,
      selectApprovedRun(run, approvedIds),
      assetRows,
    );
    // Keep QTI projection outside the row-lock transaction. The transaction reloads the accepted
    // snapshots and rejects these revisions if a reviewer changed one during preparation.
    const preparedQuestionRevisions = await prepareImportQuestionRevisions(
      initialQuestionReferences,
      stagedAssets,
    );

    outcome = await db.transaction(async (tx): Promise<MigrationCommitAttemptOutcome> => {
      if (
        run.destination._tag === 'WorkspaceBank' &&
        !await authorizeBankIntakeInTransaction(tx, ctx, run.destination.collectionId)
      ) throw new Error('Bank intake destination is unavailable.');
      const lockedRows = await tx.select({
        run: migrationRuns,
        purpose: migrationBatches.purpose,
        createdBy: migrationBatches.createdBy,
      }).from(migrationRuns)
        .innerJoin(migrationBatches, eq(migrationBatches.id, migrationRuns.batchId))
        .where(and(
          eq(migrationRuns.id, id),
          eq(migrationRuns.tenantId, ctx.tenantId),
        )).for('update').limit(1);
      if (!lockedRows.length) throw new Error('Migration run not found.');
      const locked = lockedRows[0];
      const lockedRow = locked.run;
      if (lockedRow.status === 'committed') {
        const replay = await getMigrationRun(ctx, id, tx);
        if (!replay) throw new Error('Committed migration disappeared.');
        return { _tag: 'Replayed', result: replayCommittedMigration(replay) };
      }
      const [backgroundJob] = await tx.select({ id: migrationCommitJobs.id }).from(
        migrationCommitJobs,
      ).where(eq(migrationCommitJobs.id, id));
      if (backgroundJob) throw new Error('This conversion is owned by its background commit.');
      if (lockedRow.status === 'failed') {
        throw new Error('Failed migration runs cannot be committed.');
      }
      if (lockedRow.status === 'queued' || lockedRow.status === 'analyzing') {
        throw new Error('Migration analysis must finish before commit.');
      }
      if (
        locked.purpose === 'recover_existing' &&
        lockedRow.approvalStatus !== 'approved'
      ) {
        throw new Error('The assigned reviewer must approve this conversion before commit.');
      }

      const lockedItemRows = await tx.select().from(migrationItems)
        .where(eq(migrationItems.runId, id))
        .orderBy(migrationItems.position)
        .for('update');
      const lockedItems = lockedItemRows.map(mapItemRow);
      const artifactRows = await tx.select().from(conversionSourceArtifacts)
        .where(eq(conversionSourceArtifacts.runId, id))
        .orderBy(conversionSourceArtifacts.createdAt)
        .for('update');
      const currentRun = mapRunRow(
        lockedRow,
        { purpose: locked.purpose, createdBy: locked.createdBy },
        lockedItems,
        buildReviewProgress(lockedItems),
        artifactRows.map(mapArtifactRow),
      );
      const currentApprovedIds = assertConversionCommitApproval(
        currentRun,
        opts.approvedItemIds,
        opts.approval,
      );
      const currentAssetRows = await tx.select().from(migrationAssets)
        .where(eq(migrationAssets.runId, id))
        .for('update');
      const approvedRun = selectApprovedRun(currentRun, currentApprovedIds);
      const currentParsed = importResultFromRun(approvedRun, currentAssetRows);
      const questionReferences = buildMigrationQuestionReferences(
        currentRun,
        approvedRun,
        currentAssetRows,
      );
      const committed = await commitImportResultInTransaction(
        tx,
        ctx,
        currentParsed,
        currentRun.sourceFilename,
        stagedAssets,
        questionReferences,
        preparedQuestionRevisions,
        requireReadyMigrationDestination(currentRun.destination),
      );

      for (const item of committed.itemResults) {
        await tx.update(migrationItems).set({
          createdQuestionId: item.questionId,
          createdRevision: item.revision,
        }).where(and(
          eq(migrationItems.runId, id),
          eq(migrationItems.sourceHref, item.href),
        ));
      }
      await tx.update(migrationRuns).set({
        status: 'committed',
        assessmentId: committed.destination._tag === 'Assessment'
          ? committed.destination.assessmentId
          : null,
        summary: toMigrationJsonColumn({
          ...currentRun.summary,
        }),
        updatedAt: sql`now()`,
        committedAt: sql`now()`,
      }).where(and(
        eq(migrationRuns.id, id),
        eq(migrationRuns.tenantId, ctx.tenantId),
        eq(migrationRuns.status, 'analyzed'),
      ));
      await recordAuditEventInTransaction(tx, {
        tenantId: ctx.tenantId,
        actorUserId: resolveUserId(ctx),
        action: 'migration_committed',
        metadata: {
          runId: id,
          assessmentId: committed.destination._tag === 'Assessment'
            ? committed.destination.assessmentId
            : null,
          items: committed.itemResults.length,
        },
      });
      return { _tag: 'Committed', result: committed };
    });
  } catch (cause: unknown) {
    return await throwAfterImportAssetCleanup(
      {
        idempotencyKey: id,
        storage: opts.storage,
      },
      stagedAssets,
      cause,
    );
  }
  if (outcome._tag === 'Replayed') {
    await cleanupStagedImportAssets(
      { idempotencyKey: id, storage: opts.storage },
      stagedAssets,
    );
  }
  return outcome.result;
}

export function buildMigrationQuestionReferences(
  currentRun: MigrationRunRecord,
  approvedRun: MigrationRunRecord,
  assetRows: readonly (typeof migrationAssets.$inferSelect)[],
): MigrationQuestionReferences {
  const reviewedAssets = reviewedAssetsFromRows(assetRows);
  const normalizedArtifact = requireNormalizedArtifact(currentRun);
  const itemsByHref = new Map(
    approvedRun.items.map((item) => [
      normalizePath(item.sourceHref),
      {
        migrationRunId: currentRun.id,
        migrationItemId: item.id,
        content: {
          sourceName: currentRun.sourceFilename,
          title: item.title,
          itemType: item.itemType,
          sourceHref: item.sourceHref,
          sourceIdentifier: item.sourceIdentifier,
          sourceXml: item.sourceXml,
          importedDraft: item.importedDraft,
          blueprintTargetId: item.blueprintTargetId,
          reviewSuggestions: item.reviewSuggestions,
          warnings: item.warnings,
          assets: reviewedAssets,
        },
        context: {
          readiness: item.readiness,
          sourceArtifact: sourceArtifactIdentity(requireOriginalArtifact(currentRun.artifacts)),
          normalizedSourceSha256: normalizedArtifact.sha256,
          evidence: item.evidence,
          extractionUncertainties: item.extractionUncertainties,
          review: {
            decision: item.decision,
            note: item.reviewNote ?? null,
            reviewedBy: item.reviewedBy ?? null,
            reviewedAt: item.reviewedAt ?? null,
          },
        },
        acceptedSnapshot: requireAcceptedSnapshot(item.acceptedSnapshot, item.title),
        acceptedSnapshotHash: requireAcceptedSnapshotHash(
          item.acceptedSnapshotHash,
          item.title,
        ),
      } satisfies ReviewedMigrationQuestionSnapshot,
    ]),
  );
  if (itemsByHref.size !== approvedRun.items.length) {
    throw new Error('Approved conversion items must have unique source paths.');
  }
  return { itemsByHref };
}

function requireAcceptedSnapshot(
  value: MigrationItemRecord['acceptedSnapshot'],
  title: string,
) {
  if (!value) throw new Error(`Accepted item "${title}" is missing its review snapshot.`);
  return value;
}

function requireAcceptedSnapshotHash(
  value: string | null | undefined,
  title: string,
): string {
  if (!value) throw new Error(`Accepted item "${title}" is missing its snapshot hash.`);
  return value;
}

/** Validate explicit item approval and complete blueprint coverage before commit. */
export function assertConversionCommitApproval(
  run: MigrationRunRecord,
  approvedItemIds: string[],
  approval: boolean,
): Set<string> {
  if (!approval) throw new Error('Explicit approval is required before commit.');
  if (approvedItemIds.length !== new Set(approvedItemIds).size) {
    throw new Error('Approved item IDs must be unique.');
  }
  const approvedIds = new Set(approvedItemIds);
  if (!approvedIds.size) throw new Error('Select at least one accepted item to commit.');
  const selectedItems = run.items.filter((item) => approvedIds.has(item.id));
  if (selectedItems.length !== approvedIds.size) {
    throw new Error('The approval includes an item outside this conversion run.');
  }
  for (const item of selectedItems) {
    if (item.readiness === 'blocked') {
      throw new Error(`Blocked item "${item.title}" cannot be committed.`);
    }
    if (item.decision !== 'accepted') {
      throw new Error(`Item "${item.title}" has not been accepted.`);
    }
    if (
      item.acceptedSnapshot?.contentHash !== item.contentHash ||
      item.acceptedSnapshot.contextHash !== item.contextHash ||
      !item.acceptedSnapshotHash
    ) {
      throw new Error(`Item "${item.title}" changed after acceptance and must be reviewed again.`);
    }
  }
  assertMigrationDestinationCoverage(run.destination, run.items, approvedIds);
  return approvedIds;
}

function selectApprovedRun(run: MigrationRunRecord, approvedIds: Set<string>): MigrationRunRecord {
  const approvedItems = run.items.filter((item) => approvedIds.has(item.id));
  const approvedHrefs = new Set(approvedItems.map((item) => item.sourceHref));
  const parts = runPartsFromJson(run).map((
    part,
  ) => ({
    id: part.id,
    title: part.title,
    placements: part.placements.filter((placement) =>
      'content' in placement || approvedHrefs.has(placement.href)
    ),
    options: part.options ?? {},
  })).filter((part) => part.placements.length > 0);
  const organizationGroups = run.organizationGroups.map((group) => ({
    ...group,
    hrefs: group.hrefs.filter((href) => approvedHrefs.has(href)),
  })).filter((group) => group.hrefs.length > 0);
  return { ...run, items: approvedItems, parts, organizationGroups };
}

function replayCommittedMigration(run: MigrationRunRecord): MigrationCommitResult {
  if (run.execution._tag !== 'Committed') throw new Error('Expected a committed migration.');
  const itemResults = run.items.filter((item) =>
    item.createdQuestionId !== null && item.createdQuestionId !== undefined
  ).map((item) => {
    if (!item.createdQuestionId || !item.createdRevision) {
      throw new Error('Committed item is missing its revision identity.');
    }
    return {
      href: item.sourceHref,
      questionId: item.createdQuestionId,
      revision: item.createdRevision,
    };
  });
  if (!itemResults.length) {
    throw new Error('Committed migration has no persisted question identities.');
  }
  return { destination: run.execution.destination, itemResults };
}

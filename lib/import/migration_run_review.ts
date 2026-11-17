import { authorizeBankIntakeInTransaction } from '../services/bank_intake_access.ts';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  type AssessmentBlueprint,
  AssessmentBlueprintUpdateError,
  findAssessmentBlueprintTarget,
  parseAssessmentBlueprint,
  requireDefinedAssessmentBlueprint,
} from '../assessment_blueprint.ts';
import { parseAIGenerationJobOutput } from '../conversion/generation_checkpoint.ts';
import { db } from '../db.ts';
import {
  aiGenerationJobsTable,
  conversionSourceArtifacts,
  migrationAssets,
  migrationBatches,
  migrationCommitJobs,
  migrationItems,
  migrationRuns,
} from '../db/schema.ts';
import {
  type ImportedQuestionAssistance,
  parseQuestionActorSnapshot,
  parseQuestionOrigin,
  type QuestionOrigin,
} from '../question_provenance.ts';
import { recordAuditEventInTransaction } from '../services/audit_logs.ts';
import { loadQuestionActorSnapshotInTransaction } from '../services/question_provenance.ts';
import { type RequestContext, resolveUserId } from '../tenants.ts';
import type { Draft } from '../types/draft.ts';
import { normalizeDraftForDriver } from '../types/draft_utils.ts';
import { isQuestionTypeId } from '../types/registry.ts';
import {
  acceptedMigrationQuestionSnapshotHash,
  createAcceptedMigrationQuestionSnapshot,
  migrationItemContentHash,
  migrationItemContextHash,
} from './migration_item_content.ts';
import { mapArtifactRow, mapItemRow, toMigrationJsonColumn } from './migration_run_store.ts';
import {
  requireNormalizedArtifactFromList,
  requireOriginalArtifact,
  reviewedAssetsFromRows,
  sourceArtifactIdentity,
} from './migration_source_evidence.ts';
import { draftApprovalColumns } from './migration_state.ts';
import type { MigrationItemRecord } from './migration_types.ts';

type MigrationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ImportedOrigin = Extract<QuestionOrigin, { readonly _tag: 'Imported' }>;

/** Replace an analyzed conversion's blueprint before review decisions are recorded. */
export async function updateMigrationRunBlueprint(
  ctx: RequestContext,
  runId: string,
  blueprint: AssessmentBlueprint,
): Promise<AssessmentBlueprint> {
  const parsed = parseAssessmentBlueprint(blueprint);
  await db.transaction(async (tx) => {
    const runs = await tx.select({
      status: migrationRuns.status,
      destination: migrationRuns.destination,
    })
      .from(migrationRuns)
      .where(and(
        eq(migrationRuns.id, runId),
        eq(migrationRuns.tenantId, ctx.tenantId),
      )).for('update').limit(1);
    if (!runs.length) {
      throw new AssessmentBlueprintUpdateError('not_found', 'Conversion run not found.');
    }
    if (runs[0].destination !== 'Assessment') {
      throw new AssessmentBlueprintUpdateError(
        'conflict',
        'Bank conversions do not use assessment blueprints.',
      );
    }
    if (runs[0].status !== 'analyzed') {
      throw new AssessmentBlueprintUpdateError(
        'conflict',
        'Only analyzed conversions can change their blueprint.',
      );
    }
    const reviewed = await tx.select({ id: migrationItems.id })
      .from(migrationItems)
      .where(and(
        eq(migrationItems.runId, runId),
        inArray(migrationItems.decision, ['accepted', 'rejected']),
      )).limit(1);
    if (reviewed.length) {
      throw new AssessmentBlueprintUpdateError(
        'conflict',
        'Reset recorded question decisions before changing the blueprint.',
      );
    }
    const activeGenerationJobs = await tx.select({ id: aiGenerationJobsTable.id })
      .from(aiGenerationJobsTable)
      .where(and(
        eq(aiGenerationJobsTable.tenantId, ctx.tenantId),
        eq(aiGenerationJobsTable.conversionRunId, runId),
        inArray(aiGenerationJobsTable.status, ['queued', 'running']),
      ))
      .limit(1);
    if (activeGenerationJobs.length) {
      throw new AssessmentBlueprintUpdateError(
        'conflict',
        'Wait for the active AI generation job before changing the blueprint.',
      );
    }
    await tx.update(migrationRuns).set({
      blueprint: parsed,
      ...draftApprovalColumns(),
      updatedAt: sql`now()`,
    }).where(and(
      eq(migrationRuns.id, runId),
      eq(migrationRuns.tenantId, ctx.tenantId),
    ));
    await recordAuditEventInTransaction(tx, {
      tenantId: ctx.tenantId,
      actorUserId: resolveUserId(ctx),
      action: 'conversion_blueprint_updated',
      metadata: {
        runId,
        state: parsed._tag,
        targetCount: parsed._tag === 'Defined'
          ? parsed.targets.reduce((sum, target) => sum + target.count, 0)
          : 0,
      },
    });
  });
  return parsed;
}

/** Supported bulk and single-item review mutations. */
export type ConversionItemAction =
  | { kind: 'accept'; reviewNote?: string | null }
  | { kind: 'reject'; reviewNote?: string | null }
  | { kind: 'reset_decision'; reviewNote?: string | null }
  | { kind: 'retag'; tags: string[] }
  | { kind: 'change_type'; typeId: string }
  | { kind: 'align_blueprint_target'; targetId: string }
  | { kind: 'edit'; title: string; bodyHtml: string };

/** Optimistic-concurrency token supplied for one selected migration item. */
export type ConversionItemVersion = {
  readonly contentHash: string;
  readonly contextHash: string;
  readonly decision: MigrationItemRecord['decision'];
};

/** Apply one validated review mutation to selected migration items atomically. */
export async function updateMigrationItems(
  ctx: RequestContext,
  runId: string,
  itemIds: string[],
  action: ConversionItemAction,
  expectedVersions: Readonly<Record<string, ConversionItemVersion>>,
): Promise<void> {
  const uniqueIds = [...new Set(itemIds.filter(Boolean))];
  if (!uniqueIds.length) throw new Error('Select at least one item.');
  if (uniqueIds.length !== itemIds.length) throw new Error('Item IDs must be unique.');
  assertExpectedVersions(uniqueIds, expectedVersions);
  const userId = resolveUserId(ctx);
  const now = new Date();

  await db.transaction(async (tx) => {
    const [destination] = await tx.select({
      kind: migrationRuns.destination,
      collectionId: migrationRuns.collectionId,
    }).from(migrationRuns)
      .where(and(eq(migrationRuns.id, runId), eq(migrationRuns.tenantId, ctx.tenantId)));
    if (
      destination?.kind === 'WorkspaceBank' &&
      !await authorizeBankIntakeInTransaction(tx, ctx, destination.collectionId)
    ) throw new Error('Bank intake destination is unavailable.');
    const run = await tx.select({
      status: migrationRuns.status,
      sourceFilename: migrationRuns.sourceFilename,
      purpose: migrationBatches.purpose,
      createdBy: migrationBatches.createdBy,
      createdBySnapshot: migrationBatches.createdBySnapshot,
      adapterId: migrationRuns.adapterId,
      adapterLabel: migrationRuns.adapterLabel,
      adapterVersion: migrationRuns.adapterVersion,
      blueprint: migrationRuns.blueprint,
      destination: migrationRuns.destination,
    }).from(migrationRuns)
      .innerJoin(migrationBatches, eq(migrationBatches.id, migrationRuns.batchId))
      .where(and(
        eq(migrationRuns.id, runId),
        eq(migrationRuns.tenantId, ctx.tenantId),
      )).for('update').limit(1);
    if (!run.length) throw new Error('Conversion run not found.');
    const [commit] = await tx.select({ id: migrationCommitJobs.id }).from(migrationCommitJobs)
      .where(eq(migrationCommitJobs.id, runId)).limit(1);
    if (commit) throw new Error('This selection is frozen for background import.');
    if (run[0].status !== 'analyzed') {
      throw new Error('Only analyzed conversions can be reviewed or edited.');
    }
    const rows = await tx.select().from(migrationItems).where(and(
      eq(migrationItems.runId, runId),
      inArray(migrationItems.id, uniqueIds),
    )).for('update');
    if (rows.length !== uniqueIds.length) {
      throw new Error('An item is outside this conversion run.');
    }
    const items = rows.map(mapItemRow);
    const assetRows = await tx.select().from(migrationAssets)
      .where(eq(migrationAssets.runId, runId))
      .for('update');
    const reviewedAssets = reviewedAssetsFromRows(assetRows);
    const sourceArtifacts = (await tx.select().from(conversionSourceArtifacts)
      .where(eq(conversionSourceArtifacts.runId, runId))
      .for('update')).map(mapArtifactRow);
    const originalArtifact = requireOriginalArtifact(sourceArtifacts);
    const normalizedArtifact = requireNormalizedArtifactFromList(sourceArtifacts);
    const providedBy = parseQuestionActorSnapshot(run[0].createdBySnapshot);
    if (providedBy.id !== run[0].createdBy) {
      throw new Error('Conversion batch creator snapshot does not match its creator.');
    }
    for (const item of items) {
      const expected = expectedVersions[item.id];
      if (
        expected.contentHash !== item.contentHash ||
        expected.contextHash !== item.contextHash ||
        expected.decision !== item.decision
      ) {
        throw new Error(`Item "${item.title}" changed. Reload before applying this update.`);
      }
    }

    if (action.kind === 'accept' || action.kind === 'reject' || action.kind === 'reset_decision') {
      const decision = action.kind === 'accept'
        ? 'accepted'
        : action.kind === 'reject'
        ? 'rejected'
        : 'pending';
      const reviewer = decision === 'accepted'
        ? await loadQuestionActorSnapshotInTransaction(tx, userId)
        : null;
      const assistance = decision === 'accepted'
        ? await loadImportedQuestionAssistance(tx, runId, run[0])
        : null;
      const decisions: Array<{
        id: string;
        decision: string;
        review_note: string | null;
        reviewed_by: string | null;
        reviewed_at: string | null;
        context_hash: string;
        accepted_snapshot: Record<string, unknown> | null;
        accepted_snapshot_hash: string | null;
      }> = [];
      for (const item of items) {
        if (decision === 'accepted' && item.readiness === 'blocked') {
          throw new Error('Blocked items must be corrected before they can be accepted.');
        }
        if (decision === 'accepted' && run[0].destination === 'Assessment') {
          const blueprint = requireDefinedAssessmentBlueprint(
            parseAssessmentBlueprint(run[0].blueprint),
          );
          const target = findAssessmentBlueprintTarget(
            blueprint,
            item.blueprintTargetId ?? undefined,
          );
          if (!target) {
            throw new Error(`Align "${item.title}" with a blueprint target before accepting it.`);
          }
          if (target.questionType !== item.itemType) {
            throw new Error(
              `Blueprint target "${target.id}" requires ${target.questionType}, not ${item.itemType}.`,
            );
          }
        }
        const note = (action.reviewNote ?? item.reviewNote ?? '').trim();
        const review = {
          decision,
          note: note || null,
          reviewedBy: decision === 'pending' ? null : userId,
          reviewedAt: decision === 'pending' ? null : now.toISOString(),
        } as const;
        const contextHash = await migrationItemContextHash({
          readiness: item.readiness,
          sourceArtifact: sourceArtifactIdentity(originalArtifact),
          normalizedSourceSha256: normalizedArtifact.sha256,
          evidence: item.evidence,
          extractionUncertainties: item.extractionUncertainties,
          review,
        });
        const acceptedSnapshot = decision === 'accepted'
          ? createAcceptedMigrationQuestionSnapshot({
            contentHash: item.contentHash,
            contextHash,
            origin: requireImportedQuestionOrigin(parseQuestionOrigin({
              _tag: 'Imported',
              artifact: sourceArtifactIdentity(originalArtifact),
              migrationRunId: runId,
              migrationItemId: item.id,
              href: item.sourceHref,
              identifier: item.sourceIdentifier,
              providedBy,
              assistance,
              evidence: item.evidence,
              review: {
                decision: 'accepted',
                reviewer,
                reviewedAt: review.reviewedAt,
                note: review.note,
                contentHash: item.contentHash,
                contextHash,
              },
            })),
          })
          : null;
        decisions.push({
          id: item.id,
          decision,
          review_note: review.note,
          reviewed_by: review.reviewedBy,
          reviewed_at: review.reviewedAt,
          context_hash: contextHash,
          accepted_snapshot: acceptedSnapshot === null
            ? null
            : toMigrationJsonColumn(acceptedSnapshot),
          accepted_snapshot_hash: acceptedSnapshot === null
            ? null
            : await acceptedMigrationQuestionSnapshotHash(acceptedSnapshot),
        });
      }
      // All source rows and versions were validated under their locks above. One
      // bounded statement saves their distinct snapshots without per-item network waits.
      for (let offset = 0; offset < decisions.length; offset += 100) {
        await tx.execute(sql`update ${migrationItems} as target set
          decision = patch.decision, review_note = patch.review_note,
          reviewed_by = patch.reviewed_by, reviewed_at = patch.reviewed_at,
          context_hash = patch.context_hash, accepted_snapshot = patch.accepted_snapshot,
          accepted_snapshot_hash = patch.accepted_snapshot_hash
          from jsonb_to_recordset(${JSON.stringify(decisions.slice(offset, offset + 100))}::jsonb)
          as patch(id uuid, decision text, review_note text, reviewed_by uuid,
            reviewed_at timestamptz, context_hash text, accepted_snapshot jsonb,
            accepted_snapshot_hash text)
          where target.id = patch.id and target.run_id = ${runId}::uuid`);
      }
    } else {
      for (const item of items) {
        const draft: Draft = { ...item.importedDraft };
        let title = item.title;
        let blueprintTargetId = item.blueprintTargetId;
        let reviewSuggestions = item.reviewSuggestions;
        if (action.kind === 'retag') {
          draft.tags = normalizeActionTags(action.tags);
        } else if (action.kind === 'change_type') {
          const typeId = action.typeId;
          if (!isQuestionTypeId(typeId)) {
            throw new Error(`Unsupported question type: ${action.typeId}`);
          }
          Object.assign(draft, normalizeDraftForDriver(typeId, { ...draft, type: typeId }));
          draft.type = typeId;
          blueprintTargetId = null;
          reviewSuggestions = [];
        } else if (action.kind === 'align_blueprint_target') {
          if (run[0].destination !== 'Assessment') {
            throw new Error('Bank conversions do not use assessment blueprints.');
          }
          const blueprint = requireDefinedAssessmentBlueprint(
            parseAssessmentBlueprint(run[0].blueprint),
          );
          const target = findAssessmentBlueprintTarget(blueprint, action.targetId);
          if (!target) throw new Error('Choose a current blueprint target.');
          if (target.questionType !== item.itemType) {
            throw new Error(
              `This target requires ${target.questionType}. Change the question type first.`,
            );
          }
          blueprintTargetId = target.id;
          reviewSuggestions = reviewSuggestions.filter((suggestion) =>
            suggestion.category !== 'alignment'
          );
        } else {
          title = action.title.trim();
          if (!title) throw new Error('Question title is required.');
          draft.title = title;
          draft.bodyHtml = action.bodyHtml.trim();
          reviewSuggestions = [];
        }
        const importedDraft = toMigrationJsonColumn(draft);
        const itemType = String(draft.type || item.itemType);
        const contentHash = await migrationItemContentHash({
          sourceName: run[0].sourceFilename,
          title,
          itemType,
          sourceHref: item.sourceHref,
          sourceIdentifier: item.sourceIdentifier,
          sourceXml: item.sourceXml,
          importedDraft,
          blueprintTargetId,
          reviewSuggestions,
          warnings: item.warnings,
          assets: reviewedAssets,
        });
        const contextHash = await migrationItemContextHash({
          readiness: item.readiness,
          sourceArtifact: sourceArtifactIdentity(originalArtifact),
          normalizedSourceSha256: normalizedArtifact.sha256,
          evidence: item.evidence,
          extractionUncertainties: item.extractionUncertainties,
          review: {
            decision: 'pending',
            note: null,
            reviewedBy: null,
            reviewedAt: null,
          },
        });
        await tx.update(migrationItems).set({
          title,
          itemType,
          importedDraft,
          // Edits invalidate the comparison captured from the imported source.
          exactContentIdentity: null,
          blueprintTargetId,
          reviewSuggestions: reviewSuggestions as unknown as Array<Record<string, unknown>>,
          contentHash,
          contextHash,
          decision: 'pending',
          reviewNote: null,
          acceptedSnapshot: null,
          acceptedSnapshotHash: null,
          reviewedBy: null,
          reviewedAt: null,
        }).where(and(eq(migrationItems.id, item.id), eq(migrationItems.runId, runId)));
      }
    }

    await tx.update(migrationRuns).set({
      ...draftApprovalColumns(),
      updatedAt: sql`now()`,
    }).where(and(
      eq(migrationRuns.id, runId),
      eq(migrationRuns.tenantId, ctx.tenantId),
    ));

    await recordAuditEventInTransaction(tx, {
      tenantId: ctx.tenantId,
      actorUserId: userId,
      action: action.kind === 'accept' || action.kind === 'reject' ||
          action.kind === 'reset_decision'
        ? 'migration_item_reviewed'
        : 'conversion_items_updated',
      metadata: {
        runId,
        itemIds: uniqueIds,
        update: action.kind,
        decision: action.kind === 'accept'
          ? 'accepted'
          : action.kind === 'reject'
          ? 'rejected'
          : action.kind === 'reset_decision'
          ? 'pending'
          : undefined,
      },
    });
  });
}

async function loadImportedQuestionAssistance(
  tx: MigrationTransaction,
  runId: string,
  run: {
    readonly purpose: string;
    readonly adapterId: string;
    readonly adapterLabel: string;
    readonly adapterVersion: string;
  },
): Promise<ImportedQuestionAssistance> {
  if (run.purpose === 'recover_existing') {
    return {
      _tag: 'DeterministicImport',
      adapter: {
        id: run.adapterId,
        label: run.adapterLabel,
        version: run.adapterVersion,
      },
    };
  }
  if (run.purpose !== 'generate_new') {
    throw new Error(`Unsupported conversion purpose: ${run.purpose}`);
  }
  const jobs = await tx.select({
    id: aiGenerationJobsTable.id,
    output: aiGenerationJobsTable.output,
  }).from(aiGenerationJobsTable).where(and(
    eq(aiGenerationJobsTable.conversionRunId, runId),
    eq(aiGenerationJobsTable.status, 'completed'),
  )).for('update');
  if (jobs.length !== 1) {
    throw new Error('Generated questions require exactly one completed AI generation job.');
  }
  const output = parseAIGenerationJobOutput(jobs[0].output);
  if (output?._tag !== 'completed') {
    throw new Error('Completed AI generation job is missing its generation reference.');
  }
  return {
    _tag: 'AiGenerated',
    jobId: jobs[0].id,
    generation: output.generation,
  };
}

function requireImportedQuestionOrigin(origin: QuestionOrigin): ImportedOrigin {
  if (origin._tag !== 'Imported') {
    throw new Error('Accepted migration snapshot requires an imported question origin.');
  }
  return origin;
}

function assertExpectedVersions(
  itemIds: readonly string[],
  versions: Readonly<Record<string, ConversionItemVersion>>,
): void {
  const versionIds = Object.keys(versions);
  if (
    versionIds.length !== itemIds.length ||
    versionIds.some((itemId) => !itemIds.includes(itemId))
  ) {
    throw new Error('Every selected item requires exactly one version token.');
  }
  for (const itemId of itemIds) {
    const version = versions[itemId];
    if (
      !version ||
      !/^[0-9a-f]{64}$/.test(version.contentHash) ||
      !/^[0-9a-f]{64}$/.test(version.contextHash) ||
      (version.decision !== 'pending' && version.decision !== 'accepted' &&
        version.decision !== 'rejected')
    ) {
      throw new Error(`Item "${itemId}" has an invalid version token.`);
    }
  }
}

function normalizeActionTags(tags: readonly string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}

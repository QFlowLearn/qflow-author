import { ContentAssetUnavailableError } from './owned_content_assets.ts';
import { lockWorkspaceAndRequireAuthority } from './workspace_authorization.ts';
import { readAssessmentCopyReplay, recordAssessmentCopy } from './assessment_question_copies.ts';
import { reserveAssessmentPositions } from './assessment_insertion.ts';
import { rememberAuthoringSettings } from './authoring_preferences.ts';
import type { AuthoringSettingsPatch } from '../authoring_preferences.ts';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db.ts';
import {
  assessmentParts,
  assessmentPlacements,
  assessments,
  questionRevisions,
  questions,
} from '../db/schema.ts';
import { safeErrorSummary } from '../error_summary.ts';
import {
  AdaptiveAssessmentMembershipError,
  requireManualAssessmentMembership,
} from './assessment_membership.ts';
import { StaleQuestionRevisionError } from '../question_provenance.ts';
import type { RequestContext } from '../tenants.ts';
import type { Draft } from '../types/draft.ts';
import {
  archivedQuestionFailure,
  prepareQuestionPublication,
  prepareQuestionPublicationFromSource,
  type PrepareQuestionPublicationResult,
  type PublishQuestionErrorBody,
} from './publish.ts';
import {
  ArchivedQuestionError,
  getQuestionRevision,
  IncompatibleQuestionVariantError,
  saveQuestionRevisionInTransaction,
  saveVariantQuestionRevisionInTransaction,
  VariantQuestionContentMismatchError,
  VariantQuestionSourceNotFoundError,
} from './questions.ts';
import {
  compatibleVariantTypes,
  createQuestionVariantDraft,
  parseQuestionVariantDraft,
} from '../question_variants.ts';
import { isQuestionTypeId, type QuestionTypeId } from '../types/registry.ts';
import {
  AssessmentBlueprintAlignmentError,
  parseAssessmentBlueprint,
  requireCompatibleBlueprintTarget,
} from '../assessment_blueprint.ts';

/** Canonical command for creating or revising a question inside an assessment. */
export type SaveAssessmentQuestionCommand =
  | {
    readonly _tag: 'Create';
    readonly beforePlacementId?: string;
    readonly partId: string;
    readonly draft: Draft;
    readonly rememberedSettings?: AuthoringSettingsPatch;
    readonly blueprintTargetId?: string;
  }
  | {
    readonly _tag: 'Revise';
    readonly expectedParentRevision: number;
    readonly placementId: string;
    readonly itemId: string;
    readonly draft: Draft;
    readonly rememberedSettings?: AuthoringSettingsPatch;
    readonly blueprintTargetId?: string;
  }
  | {
    readonly _tag: 'Variant';
    readonly requestId: string;
    readonly partId: string;
    readonly sourcePlacementId: string;
    readonly sourceItemId: string;
    readonly sourceRevision: number;
    readonly targetType: QuestionTypeId;
    readonly blueprintTargetId?: string;
  };

/** Successful assessment question save, including the committed placement revision. */
export type SavedAssessmentQuestion = {
  readonly itemId: string;
  readonly placementId: string;
  readonly revision: number;
  readonly identifier: string;
  readonly fixed: boolean;
};

/** Typed result returned by the assessment authoring command. */
export type SaveAssessmentQuestionResult =
  | { readonly ok: true; readonly status: 201; readonly value: SavedAssessmentQuestion }
  | {
    readonly ok: false;
    readonly status: 400 | 403 | 404 | 409 | 422 | 500;
    readonly error: PublishQuestionErrorBody;
  };

/** Saves a question revision and its assessment placement as one database transaction. */
export async function saveAssessmentQuestion(
  ctx: RequestContext,
  assessmentId: string,
  command: SaveAssessmentQuestionCommand,
): Promise<SaveAssessmentQuestionResult> {
  try {
    if (command._tag === 'Variant') {
      const replay = await db.transaction(async (tx) => {
        if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
          throw new AssessmentAuthoringFailure('copy_forbidden');
        }
        const [assessment] = await tx.select({ id: assessments.id }).from(assessments).where(
          and(eq(assessments.id, assessmentId), eq(assessments.tenantId, ctx.tenantId)),
        ).for('update');
        if (!assessment) throw new AssessmentAuthoringFailure('assessment_not_found');
        await requireManualAssessmentMembership(tx, assessmentId);
        return await readAssessmentCopyReplay(tx, ctx, assessmentId, command);
      });
      if (replay._tag === 'Rejected') throw new AssessmentAuthoringFailure(replay.reason);
      if (replay._tag === 'Replayed') return { ok: true, status: 201, value: replay.value };
    }
    const { draft, preparation } = await prepareAssessmentQuestion(ctx, command);
    if (!preparation.ok) {
      return {
        ok: false,
        status: preparation.error.status,
        error: preparation.error.body,
      };
    }
    if (command._tag === 'Revise') {
      if (preparation.prepared.revision === 1) {
        return {
          ok: false,
          status: 404,
          error: {
            error: 'placement_not_found',
            message: 'Question placement not found.',
            issues: [],
          },
        };
      }
      // Preparation captures the parent also guarded by the existing revision transaction engine.
      if (preparation.prepared.revision - 1 !== command.expectedParentRevision) {
        return staleRevisionFailure();
      }
    }
    const value = await db.transaction(async (tx) => {
      if (
        command._tag === 'Variant' &&
        !await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })
      ) throw new AssessmentAuthoringFailure('copy_forbidden');
      const assessment = await tx.select({
        id: assessments.id,
        blueprint: assessments.blueprint,
      })
        .from(assessments)
        .where(and(
          eq(assessments.id, assessmentId),
          eq(assessments.tenantId, ctx.tenantId),
        ))
        .for('update')
        .limit(1);
      if (assessment.length === 0) throw new AssessmentAuthoringFailure('assessment_not_found');
      await requireManualAssessmentMembership(tx, assessmentId);
      if (command._tag === 'Variant') {
        const replay = await readAssessmentCopyReplay(tx, ctx, assessmentId, command);
        if (replay._tag === 'Rejected') throw new AssessmentAuthoringFailure(replay.reason);
        if (replay._tag === 'Replayed') return replay.value;
      }
      let blueprintTargetId: string | null;
      let fixed = false;
      if (command._tag === 'Revise') {
        const revisionPlacement = await lockPlacementForRevision(
          tx,
          assessmentId,
          command.placementId,
          command.itemId,
        );
        blueprintTargetId = command.blueprintTargetId ?? revisionPlacement.blueprintTargetId;
        fixed = revisionPlacement.fixed;
      } else {
        blueprintTargetId = command.blueprintTargetId ?? null;
      }
      if (blueprintTargetId !== null) {
        requireAssessmentBlueprintAlignment(
          parseAssessmentBlueprint(assessment[0].blueprint),
          blueprintTargetId,
          requireQuestionType(draft.type),
        );
      }

      const variantPosition = command._tag === 'Variant'
        ? await nextVariantPlacement(tx, assessmentId, command)
        : null;
      if (variantPosition) fixed = variantPosition.fixed;
      const beforePlacementId = variantPosition
        ? variantPosition.beforePlacementId
        : command._tag === 'Create'
        ? command.beforePlacementId
        : undefined;

      const saved = command._tag === 'Variant'
        ? await saveVariantQuestionRevisionInTransaction(
          tx,
          ctx,
          preparation.prepared.saveInput,
          { questionId: command.sourceItemId, revision: command.sourceRevision },
          command.targetType,
        )
        : await saveQuestionRevisionInTransaction(tx, ctx, preparation.prepared.saveInput);

      const placementId = command._tag === 'Create' || command._tag === 'Variant'
        ? await insertPlacement(
          tx,
          assessmentId,
          command.partId,
          saved.questionId,
          saved.revision,
          blueprintTargetId,
          fixed,
          beforePlacementId,
        )
        : await revisePlacement(
          tx,
          command.placementId,
          command.itemId,
          saved.revision,
          blueprintTargetId,
        );

      if (command._tag !== 'Variant' && command.rememberedSettings) {
        await rememberAuthoringSettings(
          tx,
          ctx,
          assessmentId,
          requireQuestionType(draft.type),
          command.rememberedSettings,
        );
      }

      await tx.update(assessments).set({ updatedAt: sql`now()` }).where(
        and(eq(assessments.id, assessmentId), eq(assessments.tenantId, ctx.tenantId)),
      );

      const result = {
        itemId: saved.questionId,
        placementId,
        revision: saved.revision,
        identifier: preparation.prepared.identifier,
        fixed,
      };
      if (
        command._tag === 'Variant' &&
        !await recordAssessmentCopy(tx, ctx, assessmentId, command, result)
      ) throw new AssessmentAuthoringFailure('copy_request_conflict');
      return result;
    });
    return { ok: true, status: 201, value };
  } catch (cause: unknown) {
    if (cause instanceof ContentAssetUnavailableError) {
      return {
        ok: false,
        status: 422,
        error: {
          error: cause.code,
          message: cause.message,
          issues: [{ field: 'general', message: cause.message }],
        },
      };
    }
    if (cause instanceof AdaptiveAssessmentMembershipError) {
      return {
        ok: false,
        status: 422,
        error: { error: cause.code, message: cause.message, issues: [] },
      };
    }
    if (cause instanceof ArchivedQuestionError) {
      const failure = archivedQuestionFailure();
      return { ok: false, status: failure.status, error: failure.body };
    }
    if (cause instanceof StaleQuestionRevisionError) {
      return staleRevisionFailure();
    }
    if (cause instanceof VariantQuestionSourceNotFoundError) {
      return {
        ok: false,
        status: 404,
        error: {
          error: 'variant_source_not_found',
          message: cause.message,
          issues: [],
        },
      };
    }
    if (cause instanceof IncompatibleQuestionVariantError) {
      return {
        ok: false,
        status: 422,
        error: {
          error: 'incompatible_variant_transform',
          message: cause.message,
          issues: [{
            field: 'draft.type',
            message: 'Choose a compatible question type or keep the source type.',
          }],
        },
      };
    }
    if (cause instanceof VariantQuestionContentMismatchError) {
      return {
        ok: false,
        status: 422,
        error: {
          error: 'variant_content_mismatch',
          message: cause.message,
          issues: [{
            field: 'sourceRevision',
            message: 'Reload the source question and create the variant again.',
          }],
        },
      };
    }
    if (cause instanceof AssessmentAuthoringFailure) {
      const notFound = cause.reason.endsWith('_not_found');
      return {
        ok: false,
        status: cause.reason === 'copy_forbidden'
          ? 403
          : notFound
          ? 404
          : ['source_revision_changed', 'copy_request_conflict', 'copy_unavailable'].includes(
              cause.reason,
            )
          ? 409
          : 400,
        error: {
          error: cause.reason,
          message: cause.message,
          issues: [],
        },
      };
    }
    console.error(
      'Assessment question transaction failed',
      safeErrorSummary(cause),
    );
    return {
      ok: false,
      status: 500,
      error: {
        error: 'assessment_question_save_failed',
        message: 'The question could not be saved to the assessment.',
        issues: [],
      },
    };
  }
}

function staleRevisionFailure(): Extract<SaveAssessmentQuestionResult, { ok: false }> {
  return {
    ok: false,
    status: 409,
    error: {
      error: 'stale_parent_revision',
      message: 'This item changed while you were editing it.',
      issues: [{ field: 'itemId', message: 'Reload the item and save your changes again.' }],
    },
  };
}

type AssessmentTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class AssessmentAuthoringFailure extends Error {
  constructor(
    readonly reason:
      | 'copy_forbidden'
      | 'copy_request_conflict'
      | 'copy_unavailable'
      | 'source_revision_changed'
      | 'assessment_not_found'
      | 'blueprint_alignment_invalid'
      | 'part_not_found'
      | 'placement_not_found',
    message?: string,
  ) {
    super(
      message ??
        (reason === 'copy_forbidden'
          ? 'You no longer have permission to copy questions in this workspace.'
          : reason === 'copy_request_conflict'
          ? 'This copy request belongs to a different operation.'
          : reason === 'copy_unavailable'
          ? 'The saved copy has changed or was removed. Reload the assessment to review it.'
          : reason === 'source_revision_changed'
          ? 'The source question changed. Reload it before duplicating.'
          : reason === 'assessment_not_found'
          ? 'Assessment not found.'
          : reason === 'blueprint_alignment_invalid'
          ? 'Choose a blueprint target that supports this question type.'
          : reason === 'part_not_found'
          ? 'Assessment part not found.'
          : 'Question placement not found.'),
    );
  }
}

function requireAssessmentBlueprintAlignment(
  blueprint: ReturnType<typeof parseAssessmentBlueprint>,
  targetId: string,
  questionType: QuestionTypeId,
): void {
  try {
    requireCompatibleBlueprintTarget(blueprint, targetId, questionType);
  } catch (cause: unknown) {
    if (cause instanceof AssessmentBlueprintAlignmentError) {
      throw new AssessmentAuthoringFailure('blueprint_alignment_invalid', cause.message);
    }
    throw cause;
  }
}

/** Resolve adjacency while holding the assessment lock, so another insertion cannot move the copy. */
async function nextVariantPlacement(
  tx: AssessmentTransaction,
  assessmentId: string,
  command: Extract<SaveAssessmentQuestionCommand, { readonly _tag: 'Variant' }>,
): Promise<{ readonly beforePlacementId: string | undefined; readonly fixed: boolean }> {
  const [source] = await tx.select({
    position: assessmentPlacements.position,
    fixed: assessmentPlacements.fixed,
    revision: sql<
      number
    >`coalesce(${assessmentPlacements.pinnedRevision}, ${questionRevisions.revision})`,
  }).from(assessmentPlacements)
    .innerJoin(assessmentParts, eq(assessmentParts.id, assessmentPlacements.assessmentPartId))
    .innerJoin(questions, eq(questions.id, assessmentPlacements.questionId))
    .innerJoin(questionRevisions, eq(questionRevisions.id, questions.latestRevisionId))
    .where(and(
      eq(assessmentParts.assessmentId, assessmentId),
      eq(assessmentPlacements.assessmentPartId, command.partId),
      eq(assessmentPlacements.id, command.sourcePlacementId),
      eq(assessmentPlacements.questionId, command.sourceItemId),
    )).limit(1);
  if (!source) throw new AssessmentAuthoringFailure('placement_not_found');
  if (Number(source.revision) !== command.sourceRevision) {
    throw new AssessmentAuthoringFailure('source_revision_changed');
  }
  const [next] = await tx.select({ id: assessmentPlacements.id }).from(assessmentPlacements)
    .where(and(
      eq(assessmentPlacements.assessmentPartId, command.partId),
      gt(assessmentPlacements.position, source.position),
    )).orderBy(asc(assessmentPlacements.position)).limit(1);
  return { beforePlacementId: next?.id, fixed: source.fixed };
}

async function insertPlacement(
  tx: AssessmentTransaction,
  assessmentId: string,
  partId: string,
  itemId: string,
  revision: number,
  blueprintTargetId: string | null,
  fixed: boolean,
  beforePlacementId?: string,
): Promise<string> {
  const part = await tx.select({ id: assessmentParts.id })
    .from(assessmentParts)
    .where(and(eq(assessmentParts.id, partId), eq(assessmentParts.assessmentId, assessmentId)))
    .limit(1);
  if (part.length === 0) throw new AssessmentAuthoringFailure('part_not_found');

  const position = await reserveAssessmentPositions(tx, partId, 1, beforePlacementId);
  if (position === null) throw new AssessmentAuthoringFailure('placement_not_found');
  const placementId = crypto.randomUUID();
  await tx.insert(assessmentPlacements).values({
    id: placementId,
    assessmentPartId: partId,
    questionId: itemId,
    pinnedRevision: revision,
    blueprintTargetId,
    fixed,
    position,
  });
  await tx.update(assessments).set({
    targetCount: sql`${assessments.targetCount} + 1`,
  }).where(eq(assessments.id, assessmentId));
  return placementId;
}

async function lockPlacementForRevision(
  tx: AssessmentTransaction,
  assessmentId: string,
  placementId: string,
  itemId: string,
): Promise<
  { readonly id: string; readonly blueprintTargetId: string | null; readonly fixed: boolean }
> {
  const placement = await tx.select({
    id: assessmentPlacements.id,
    blueprintTargetId: assessmentPlacements.blueprintTargetId,
    fixed: assessmentPlacements.fixed,
  })
    .from(assessmentPlacements)
    .innerJoin(assessmentParts, eq(assessmentParts.id, assessmentPlacements.assessmentPartId))
    .where(and(
      eq(assessmentPlacements.id, placementId),
      eq(assessmentPlacements.questionId, itemId),
      eq(assessmentParts.assessmentId, assessmentId),
    ))
    .for('update')
    .limit(1);
  if (placement.length === 0) throw new AssessmentAuthoringFailure('placement_not_found');
  return placement[0];
}

async function revisePlacement(
  tx: AssessmentTransaction,
  placementId: string,
  itemId: string,
  revision: number,
  blueprintTargetId: string | null,
): Promise<string> {
  const updated = await tx.update(assessmentPlacements).set({
    pinnedRevision: revision,
    blueprintTargetId,
  }).where(and(
    eq(assessmentPlacements.id, placementId),
    eq(assessmentPlacements.questionId, itemId),
  )).returning({ id: assessmentPlacements.id });
  if (!updated.length) throw new AssessmentAuthoringFailure('placement_not_found');
  return updated[0].id;
}

function withoutItemId(draft: Draft): Draft {
  const { itemId: _itemId, ...createDraft } = draft;
  return createDraft;
}

async function prepareAssessmentQuestion(
  ctx: RequestContext,
  command: SaveAssessmentQuestionCommand,
): Promise<{ readonly draft: Draft; readonly preparation: PrepareQuestionPublicationResult }> {
  if (command._tag !== 'Variant') {
    const draft = command._tag === 'Revise'
      ? { ...command.draft, itemId: command.itemId }
      : withoutItemId(command.draft);
    return { draft, preparation: await prepareQuestionPublication(ctx, draft) };
  }
  const source = await getQuestionRevision(ctx, command.sourceItemId, command.sourceRevision);
  if (!source) throw new VariantQuestionSourceNotFoundError();
  const sourceDraft = parseQuestionVariantDraft(source.body, 'source');
  if (!compatibleVariantTypes(sourceDraft).includes(command.targetType)) {
    throw new IncompatibleQuestionVariantError(sourceDraft.type, command.targetType);
  }
  const draft = createQuestionVariantDraft(sourceDraft, command.targetType);
  const preparation = sourceDraft.type === command.targetType
    ? await prepareQuestionPublicationFromSource(draft, {
      _tag: 'Copy',
      itemId: crypto.randomUUID(),
      qtiXml: source.qtiXml,
    })
    : await prepareQuestionPublication(ctx, draft);
  return { draft, preparation };
}

function requireQuestionType(value: Draft['type']): QuestionTypeId {
  if (!isQuestionTypeId(value)) throw new Error('Prepared question type is invalid.');
  return value;
}

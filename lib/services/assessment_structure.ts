import { requireOwnedContentAssets } from './owned_content_assets.ts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  type AssessmentBlueprint,
  AssessmentBlueprintAlignmentError,
  AssessmentBlueprintUpdateError,
  parseAssessmentBlueprint,
  requireCompatibleBlueprintTarget,
} from '../assessment_blueprint.ts';
import { db } from '../db.ts';
import {
  assessmentParts,
  assessmentPlacements,
  assessments,
  questionRevisions,
  questions,
} from '../db/schema.ts';
import { normalizePlacementRevisionSelectors } from '../placement_question_views.ts';
import { type RequestContext } from '../tenants.ts';
import { isQuestionTypeId, type QuestionTypeId } from '../types/registry.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { loadPlacementQuestionRevisionRows } from './placement_question_revision_rows.ts';
import { requireManualAssessmentMembership } from './assessment_membership.ts';
import type { AssessmentStandaloneContent } from '../assessment_standalone_content.ts';
import { assessmentQuestionPlacements } from '../assessment_content.ts';
import {
  type AssessmentContentPlacement,
  parseAssessmentStandaloneContent,
} from '../assessment_standalone_content.ts';

/** One assessment-local question placement. */
export type AssessmentPlacement = AssessmentContentPlacement | {
  id: string;
  itemId: string;
  snapshotRev: number | null;
  blueprintTargetId: string | null;
  fixed?: boolean;
};

/** One ordered assessment part and its placements. */
export type AssessmentPart = {
  id: string;
  title: string;
  options: Record<string, unknown>;
  placements: AssessmentPlacement[];
};

/** Input used to replace one assessment part. */
export type AssessmentPartInput = {
  id?: string;
  title: string;
  options?: Record<string, unknown>;
  placements?: AssessmentPlacementInput[];
};

/** Input used to replace one assessment-local question placement. */
export type AssessmentQuestionPlacementInput = {
  id?: string;
  itemId: string;
  snapshotRev?: number | null;
  blueprintTargetId?: string | null;
  fixed?: boolean;
};

/** Question references and unscored anchors share one ordered persistence command. */
export type AssessmentPlacementInput =
  | AssessmentQuestionPlacementInput
  | (Omit<AssessmentContentPlacement, 'id'> & { readonly id?: string });

/** Transaction handle accepted by assessment persistence operations. */
export type AssessmentTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type AppendPlacementInput = {
  readonly itemId: string;
  readonly partId?: string;
  readonly followLatest?: boolean;
  readonly pinnedRevision?: number | null;
  readonly blueprintTargetId?: string | null;
};

/** An expected rejection of one assessment-structure mutation. */
export class AssessmentStructureError extends Error {
  readonly _tag = 'AssessmentStructureError' as const;

  constructor(
    readonly status: 404 | 422,
    message: string,
    readonly code: AssessmentStructureErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AssessmentStructureError';
  }
}

export type AssessmentStructureErrorCode =
  | 'assessment_not_found'
  | 'question_not_found'
  | 'placement_not_found'
  | 'part_not_found'
  | 'invalid_identifier'
  | 'blueprint_alignment_invalid'
  | 'revision_unavailable'
  | 'invalid_content'
  | 'content_asset_unavailable'
  | 'content_ordering_unsupported';

/** Replace assessment structure inside a caller-owned transaction. */
export async function replaceAssessmentPartsInTransaction(
  tx: AssessmentTransaction,
  ctx: RequestContext,
  assessmentId: string,
  parts: AssessmentPartInput[],
): Promise<void> {
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
  if (!assessment.length) {
    throw new AssessmentStructureError(404, 'Assessment not found.', 'assessment_not_found');
  }
  await requireManualAssessmentMembership(tx, assessmentId);
  const questionInputs = parts.flatMap((part) =>
    assessmentQuestionPlacements(part.placements ?? [])
  );
  const questionIds = new Set<string>();
  for (const part of parts) {
    for (const placement of part.placements ?? []) {
      if ('itemId' in placement) {
        questionIds.add(placement.itemId);
        continue;
      }
      if (placement.fixed !== true) {
        throw new AssessmentStructureError(
          422,
          'Assessment content is invalid.',
          'invalid_content',
        );
      }
      if (part.options?.shuffleQuestions === true) {
        throw new AssessmentStructureError(
          422,
          'Standalone content blocks require authored question order.',
          'content_ordering_unsupported',
        );
      }
    }
  }
  if (questionIds.size) {
    const questionRows = await tx.select({ id: questions.id })
      .from(questions)
      .where(and(
        eq(questions.tenantId, ctx.tenantId),
        inArray(questions.id, Array.from(questionIds)),
      ));
    if (questionRows.length !== questionIds.size) {
      throw new AssessmentStructureError(404, 'Question not found.', 'question_not_found');
    }
  }
  await validatePlacementBlueprintTargets(
    tx,
    ctx,
    parseAssessmentBlueprint(assessment[0].blueprint),
    questionInputs,
  );
  const partRows: Array<typeof assessmentParts.$inferInsert> = [];
  const placementRows: Array<typeof assessmentPlacements.$inferInsert> = [];
  const content: AssessmentStandaloneContent[] = [];
  for (const [index, part] of parts.entries()) {
    const partId = resolveUuidInput(part.id, 'Assessment part ID');
    partRows.push({
      id: partId,
      assessmentId,
      title: part.title || 'Untitled Part',
      position: index + 1,
      options: part.options ?? {},
    });
    for (const [placementIndex, placement] of (part.placements ?? []).entries()) {
      if ('content' in placement) {
        const parsed = parseAssessmentStandaloneContent(placement.content);
        if (!parsed.ok) {
          throw new AssessmentStructureError(
            422,
            'Assessment content is invalid.',
            'invalid_content',
          );
        }
        content.push(parsed.content);
        placementRows.push({
          id: resolveUuidInput(placement.id, 'Assessment placement ID'),
          assessmentPartId: partId,
          questionId: null,
          content: parsed.content,
          pinnedRevision: null,
          blueprintTargetId: null,
          fixed: true,
          position: placementIndex + 1,
        });
        continue;
      }
      placementRows.push({
        id: resolveUuidInput(placement.id, 'Assessment placement ID'),
        assessmentPartId: partId,
        questionId: placement.itemId,
        pinnedRevision: placement.snapshotRev ?? null,
        blueprintTargetId: placement.blueprintTargetId ?? null,
        fixed: placement.fixed === true,
        position: placementIndex + 1,
      });
    }
  }
  await requireOwnedContentAssets(
    tx,
    ctx,
    content,
    () =>
      new AssessmentStructureError(
        422,
        'A content file is unavailable or has the wrong media type. Upload the file again before saving.',
        'content_asset_unavailable',
      ),
  );
  await tx.delete(assessmentParts).where(eq(assessmentParts.assessmentId, assessmentId));
  if (partRows.length) await tx.insert(assessmentParts).values(partRows);
  if (placementRows.length) await tx.insert(assessmentPlacements).values(placementRows);
  await tx.update(assessments).set({
    targetCount: questionInputs.length,
    updatedAt: sql`now()`,
  }).where(and(
    eq(assessments.id, assessmentId),
    eq(assessments.tenantId, ctx.tenantId),
  ));
}

/** Append one question placement to an assessment part. */
export async function appendPlacement(
  ctx: RequestContext,
  assessmentId: string,
  input: AppendPlacementInput,
) {
  return await db.transaction(async (tx) => {
    const assessmentRows = await tx.select({ blueprint: assessments.blueprint })
      .from(assessments)
      .where(and(
        eq(assessments.id, assessmentId),
        eq(assessments.tenantId, ctx.tenantId),
      ))
      .for('update')
      .limit(1);
    if (!assessmentRows.length) {
      throw new AssessmentStructureError(404, 'Assessment not found.', 'assessment_not_found');
    }
    await requireManualAssessmentMembership(tx, assessmentId);
    const partId = await resolvePartId(tx, assessmentId, input.partId);
    const questionRows = await tx.select({
      latestRevisionId: questions.latestRevisionId,
      latestRevision: questionRevisions.revision,
    }).from(questions)
      .leftJoin(
        questionRevisions,
        and(
          eq(questionRevisions.id, questions.latestRevisionId),
          eq(questionRevisions.tenantId, ctx.tenantId),
        ),
      )
      .where(and(
        eq(questions.id, input.itemId),
        eq(questions.tenantId, ctx.tenantId),
      ))
      .limit(1);
    if (!questionRows.length) {
      throw new AssessmentStructureError(404, 'Question not found.', 'question_not_found');
    }
    const question = questionRows[0];
    if (!question.latestRevisionId || question.latestRevision === null) {
      throw new Error('Question is missing its latest revision.');
    }
    let pinnedRevision: number | null = null;
    if (typeof input.pinnedRevision === 'number') pinnedRevision = input.pinnedRevision;
    else if (!input.followLatest) pinnedRevision = question.latestRevision;

    if (input.blueprintTargetId !== null && input.blueprintTargetId !== undefined) {
      await validatePlacementBlueprintTargets(
        tx,
        ctx,
        parseAssessmentBlueprint(assessmentRows[0].blueprint),
        [{
          itemId: input.itemId,
          snapshotRev: pinnedRevision,
          blueprintTargetId: input.blueprintTargetId,
        }],
      );
    }
    const lastPosition = await tx.select({
      value: sql<number>`COALESCE(MAX(${assessmentPlacements.position}), 0)`,
    })
      .from(assessmentPlacements)
      .where(eq(assessmentPlacements.assessmentPartId, partId));
    const placementId = crypto.randomUUID();
    await tx.insert(assessmentPlacements).values({
      id: placementId,
      assessmentPartId: partId,
      questionId: input.itemId,
      pinnedRevision,
      blueprintTargetId: input.blueprintTargetId ?? null,
      position: (lastPosition[0]?.value ?? 0) + 1,
    });
    await tx.update(assessments).set({
      targetCount: sql`${assessments.targetCount} + 1`,
      updatedAt: sql`now()`,
    }).where(eq(assessments.id, assessmentId));
    return { id: placementId, snapshotRev: pinnedRevision };
  });
}

/** Make one placement follow the question's latest revision. */
export async function setPlacementFollowLatest(
  ctx: RequestContext,
  assessmentId: string,
  placementId: string,
): Promise<void> {
  await updatePlacementRevision(ctx, assessmentId, placementId, 'follow_latest');
}

/** Pin one placement to the question's current latest revision. */
export async function pinPlacementToLatest(
  ctx: RequestContext,
  assessmentId: string,
  placementId: string,
): Promise<void> {
  await updatePlacementRevision(ctx, assessmentId, placementId, 'pin_latest');
}

/** Change one assessment-local blueprint alignment without creating a question revision. */
export async function updatePlacementBlueprintTarget(
  ctx: RequestContext,
  assessmentId: string,
  placementId: string,
  targetId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const placements = await tx.select({
      questionId: questions.id,
      pinnedRevision: assessmentPlacements.pinnedRevision,
      latestRevisionId: questions.latestRevisionId,
      blueprint: assessments.blueprint,
    }).from(assessmentPlacements)
      .innerJoin(assessmentParts, eq(assessmentPlacements.assessmentPartId, assessmentParts.id))
      .innerJoin(assessments, eq(assessmentParts.assessmentId, assessments.id))
      .innerJoin(questions, eq(assessmentPlacements.questionId, questions.id))
      .where(and(
        eq(assessmentPlacements.id, placementId),
        eq(assessmentParts.assessmentId, assessmentId),
        eq(assessments.tenantId, ctx.tenantId),
        eq(questions.tenantId, ctx.tenantId),
      ))
      .for('update')
      .limit(1);
    const placement = placements[0];
    if (!placement) {
      throw new AssessmentStructureError(
        404,
        'Question placement not found.',
        'placement_not_found',
      );
    }

    const revisionConditions = [
      eq(questionRevisions.questionId, placement.questionId),
      eq(questionRevisions.tenantId, ctx.tenantId),
    ];
    if (placement.pinnedRevision === null) {
      if (!placement.latestRevisionId) throw new Error('Question is missing its latest revision.');
      revisionConditions.push(eq(questionRevisions.id, placement.latestRevisionId));
    } else {
      revisionConditions.push(eq(questionRevisions.revision, placement.pinnedRevision));
    }
    const revisions = await tx.select({ body: questionRevisions.body })
      .from(questionRevisions)
      .where(and(...revisionConditions))
      .limit(1);
    const questionType = parseQuestionTypeFromRevisionBody(revisions[0]?.body);
    const target = requirePlacementBlueprintTarget(
      parseAssessmentBlueprint(placement.blueprint),
      targetId,
      questionType,
    );
    await tx.update(assessmentPlacements).set({
      blueprintTargetId: target.id,
      updatedAt: sql`now()`,
    }).where(eq(assessmentPlacements.id, placementId));
  });
}

/** Replace one assessment's explicit blueprint contract. */
export async function updateAssessmentBlueprint(
  ctx: RequestContext,
  id: string,
  blueprint: AssessmentBlueprint,
): Promise<AssessmentBlueprint> {
  const parsed = parseAssessmentBlueprint(blueprint);
  return await db.transaction(async (tx) => {
    const assessment = await tx.select({ id: assessments.id })
      .from(assessments)
      .where(and(eq(assessments.id, id), eq(assessments.tenantId, ctx.tenantId)))
      .for('update')
      .limit(1);
    if (!assessment.length) {
      throw new AssessmentBlueprintUpdateError('not_found', 'Assessment not found.');
    }

    const placements = await tx.select({
      itemId: assessmentPlacements.questionId,
      snapshotRev: assessmentPlacements.pinnedRevision,
      blueprintTargetId: assessmentPlacements.blueprintTargetId,
    })
      .from(assessmentPlacements)
      .innerJoin(assessmentParts, eq(assessmentPlacements.assessmentPartId, assessmentParts.id))
      .where(eq(assessmentParts.assessmentId, id));
    try {
      await validatePlacementBlueprintTargets(
        tx,
        ctx,
        parsed,
        placements.flatMap((placement) =>
          placement.itemId === null ? [] : [{ ...placement, itemId: placement.itemId }]
        ),
      );
    } catch (cause: unknown) {
      if (cause instanceof AssessmentStructureError) {
        throw new AssessmentBlueprintUpdateError(
          'conflict',
          'Reassign questions that use targets you removed or changed before saving this blueprint.',
          { cause },
        );
      }
      throw cause;
    }

    const updated = await tx.update(assessments).set({
      blueprint: parsed,
      updatedAt: sql`now()`,
    }).where(and(eq(assessments.id, id), eq(assessments.tenantId, ctx.tenantId))).returning({
      blueprint: assessments.blueprint,
    });
    if (!updated.length) {
      throw new AssessmentBlueprintUpdateError('not_found', 'Assessment not found.');
    }
    return parseAssessmentBlueprint(updated[0].blueprint);
  });
}

async function validatePlacementBlueprintTargets(
  tx: AssessmentTransaction,
  ctx: RequestContext,
  blueprint: AssessmentBlueprint,
  inputs: readonly AssessmentQuestionPlacementInput[],
): Promise<void> {
  const placements = inputs.filter((placement) =>
    placement.blueprintTargetId !== null && placement.blueprintTargetId !== undefined
  );
  if (!placements.length) return;

  const selection = normalizePlacementRevisionSelectors(placements.map((placement) => ({
    itemId: placement.itemId,
    revision: placement.snapshotRev ?? null,
  })));
  const revisions = await loadPlacementQuestionRevisionRows(tx, ctx.tenantId, selection);
  const latestRevisionByItemId = new Map(
    revisions
      .filter((revision) => revision.revisionId === revision.latestRevisionId)
      .map((revision) => [revision.itemId, revision]),
  );
  const pinnedRevisionBySelector = new Map(
    revisions.map((revision) => [`${revision.itemId}:${revision.revision}`, revision]),
  );

  for (const placement of placements) {
    const targetId = placement.blueprintTargetId;
    if (targetId === null || targetId === undefined) continue;
    const revision = placement.snapshotRev === null || placement.snapshotRev === undefined
      ? latestRevisionByItemId.get(placement.itemId)
      : pinnedRevisionBySelector.get(`${placement.itemId}:${placement.snapshotRev}`);
    if (!revision) {
      throw new AssessmentStructureError(
        422,
        'Choose an available question revision for blueprint alignment.',
        'revision_unavailable',
      );
    }
    requirePlacementBlueprintTarget(
      blueprint,
      targetId,
      parseQuestionTypeFromRevisionBody(revision.body),
    );
  }
}

async function updatePlacementRevision(
  ctx: RequestContext,
  assessmentId: string,
  placementId: string,
  selection: 'follow_latest' | 'pin_latest',
): Promise<void> {
  await db.transaction(async (tx) => {
    const placement = await tx.select({
      id: assessmentPlacements.id,
      questionId: questions.id,
      blueprintTargetId: assessmentPlacements.blueprintTargetId,
      latestRevisionId: questions.latestRevisionId,
      blueprint: assessments.blueprint,
    })
      .from(assessmentPlacements)
      .innerJoin(assessmentParts, eq(assessmentParts.id, assessmentPlacements.assessmentPartId))
      .innerJoin(assessments, eq(assessments.id, assessmentParts.assessmentId))
      .innerJoin(questions, eq(questions.id, assessmentPlacements.questionId))
      .where(and(
        eq(assessmentPlacements.id, placementId),
        eq(assessmentParts.assessmentId, assessmentId),
        eq(assessments.tenantId, ctx.tenantId),
        eq(questions.tenantId, ctx.tenantId),
      ))
      .for('update')
      .limit(1);
    if (!placement.length) {
      throw new AssessmentStructureError(404, 'Placement not found.', 'placement_not_found');
    }
    await requireManualAssessmentMembership(tx, assessmentId);
    const current = placement[0];
    if (!current.latestRevisionId) throw new Error('Question has no revisions');
    const revisions = await tx.select({
      revision: questionRevisions.revision,
      body: questionRevisions.body,
    }).from(questionRevisions).where(and(
      eq(questionRevisions.id, current.latestRevisionId),
      eq(questionRevisions.questionId, current.questionId),
      eq(questionRevisions.tenantId, ctx.tenantId),
    )).limit(1);
    if (!revisions.length) throw new Error('Question latest revision not found');
    if (current.blueprintTargetId !== null) {
      requirePlacementBlueprintTarget(
        parseAssessmentBlueprint(current.blueprint),
        current.blueprintTargetId,
        parseQuestionTypeFromRevisionBody(revisions[0].body),
      );
    }
    const pinnedRevision = selection === 'pin_latest' ? revisions[0].revision : null;
    await tx.update(assessmentPlacements).set({ pinnedRevision }).where(
      eq(assessmentPlacements.id, placementId),
    );
    await tx.update(assessments).set({ updatedAt: sql`now()` }).where(
      eq(assessments.id, assessmentId),
    );
  });
}

function requirePlacementBlueprintTarget(
  blueprint: AssessmentBlueprint,
  targetId: string,
  questionType: QuestionTypeId,
) {
  try {
    return requireCompatibleBlueprintTarget(blueprint, targetId, questionType);
  } catch (cause: unknown) {
    if (cause instanceof AssessmentBlueprintAlignmentError) {
      throw new AssessmentStructureError(422, cause.message, 'blueprint_alignment_invalid', {
        cause,
      });
    }
    throw cause;
  }
}

function parseQuestionTypeFromRevisionBody(value: unknown): QuestionTypeId {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Question revision body is invalid.');
  }
  // SAFETY: the record shape is established above; the concrete field is parsed below.
  const type = (value as Record<string, unknown>).type;
  if (!isQuestionTypeId(type)) throw new Error('Question revision type is invalid.');
  return type;
}

function resolveUuidInput(value: string | undefined, label: string): string {
  if (value === undefined) return crypto.randomUUID();
  if (!isCanonicalUuid(value)) {
    throw new AssessmentStructureError(422, `${label} must be a UUID.`, 'invalid_identifier');
  }
  return value;
}

async function resolvePartId(
  tx: AssessmentTransaction,
  assessmentId: string,
  requested?: string,
): Promise<string> {
  if (requested) {
    const row = await tx.select({ id: assessmentParts.id })
      .from(assessmentParts)
      .where(and(eq(assessmentParts.id, requested), eq(assessmentParts.assessmentId, assessmentId)))
      .limit(1);
    if (!row.length) {
      throw new AssessmentStructureError(404, 'Assessment part not found.', 'part_not_found');
    }
    return requested;
  }
  const existing = await tx.select({ id: assessmentParts.id })
    .from(assessmentParts)
    .where(eq(assessmentParts.assessmentId, assessmentId))
    .orderBy(assessmentParts.position)
    .limit(1);
  if (existing.length) return existing[0].id;
  const newId = crypto.randomUUID();
  await tx.insert(assessmentParts).values({
    id: newId,
    assessmentId,
    title: 'Part 1',
    position: 1,
    options: {},
  });
  return newId;
}

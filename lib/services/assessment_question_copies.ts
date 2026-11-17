import { and, eq } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { assessmentQuestionCopies } from '../db/assessment_copy_schema.ts';
import { assessmentParts, assessmentPlacements } from '../db/assessment_schema.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { isCanonicalUuid } from '../uuid.ts';
import type { RequestContext } from '../tenants.ts';
import type {
  SaveAssessmentQuestionCommand,
  SavedAssessmentQuestion,
} from './assessment_question_authoring.ts';

type CopyCommand = Extract<SaveAssessmentQuestionCommand, { readonly _tag: 'Variant' }>;

/** A persisted request is either new, replayable, or explicitly conflicts with current ownership. */
export type AssessmentCopyReplay =
  | { readonly _tag: 'New' }
  | { readonly _tag: 'Replayed'; readonly value: SavedAssessmentQuestion }
  | { readonly _tag: 'Rejected'; readonly reason: 'copy_request_conflict' | 'copy_unavailable' };

function commandIdentity(command: CopyCommand): string {
  return canonicalJsonStringify({
    partId: command.partId,
    sourcePlacementId: command.sourcePlacementId,
    sourceItemId: command.sourceItemId,
    sourceRevision: command.sourceRevision,
    targetType: command.targetType,
    blueprintTargetId: command.blueprintTargetId ?? null,
  });
}

/** Inspect the receipt while the caller holds current workspace and assessment authority locks. */
export async function readAssessmentCopyReplay(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  assessmentId: string,
  command: CopyCommand,
): Promise<AssessmentCopyReplay> {
  const [row] = await tx.select().from(assessmentQuestionCopies).where(
    eq(assessmentQuestionCopies.requestId, command.requestId),
  );
  if (!row) return { _tag: 'New' };
  if (
    row.tenantId !== ctx.tenantId || row.assessmentId !== assessmentId ||
    row.createdBy !== ctx.userId || row.command !== commandIdentity(command)
  ) {
    return { _tag: 'Rejected', reason: 'copy_request_conflict' };
  }
  const value = parseSavedCopy(row.result);
  const [placement] = await tx.select({
    itemId: assessmentPlacements.questionId,
    revision: assessmentPlacements.pinnedRevision,
    fixed: assessmentPlacements.fixed,
  })
    .from(assessmentPlacements).innerJoin(
      assessmentParts,
      eq(assessmentParts.id, assessmentPlacements.assessmentPartId),
    )
    .where(
      and(
        eq(assessmentPlacements.id, value.placementId),
        eq(assessmentParts.assessmentId, assessmentId),
        eq(assessmentParts.id, command.partId),
      ),
    );
  if (
    !placement || placement.itemId !== value.itemId || placement.revision !== value.revision ||
    placement.fixed !== value.fixed
  ) {
    return { _tag: 'Rejected', reason: 'copy_unavailable' };
  }
  return { _tag: 'Replayed', value };
}

/** Persist the receipt in the copy transaction; false requires the caller to abort that transaction. */
export async function recordAssessmentCopy(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  assessmentId: string,
  command: CopyCommand,
  value: SavedAssessmentQuestion,
): Promise<boolean> {
  const rows = await tx.insert(assessmentQuestionCopies).values({
    requestId: command.requestId,
    tenantId: ctx.tenantId,
    assessmentId,
    createdBy: ctx.userId,
    command: commandIdentity(command),
    result: value,
  }).onConflictDoNothing().returning({ requestId: assessmentQuestionCopies.requestId });
  return rows.length === 1;
}

function parseSavedCopy(input: unknown): SavedAssessmentQuestion {
  if (
    !input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).length !== 5 ||
    !('itemId' in input) || !isCanonicalUuid(input.itemId) ||
    !('placementId' in input) || !isCanonicalUuid(input.placementId) ||
    !('revision' in input) || typeof input.revision !== 'number' ||
    !Number.isSafeInteger(input.revision) || input.revision < 1 ||
    !('identifier' in input) || typeof input.identifier !== 'string' || !input.identifier.trim() ||
    !('fixed' in input) || typeof input.fixed !== 'boolean'
  ) {
    throw new Error('Stored assessment copy receipt is invalid.');
  }
  return {
    itemId: input.itemId,
    placementId: input.placementId,
    revision: input.revision,
    identifier: input.identifier,
    fixed: input.fixed,
  };
}

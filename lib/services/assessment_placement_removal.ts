import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, type QflowDatabase, type QflowDatabaseTransaction } from '../db.ts';
import {
  assessmentParts,
  assessmentPlacementRemovals,
  assessmentPlacements,
  assessments,
  questions,
} from '../db/schema.ts';
import {
  parsePlacementRemovalOrder,
  parsePlacementRemovalReceipt,
  type PlacementRemovalCommand,
  type PlacementRemovalReceipt,
  type PlacementRemovalResult,
  type RestoredAssessmentPlacement,
} from '../assessment_placement_removal.ts';
import {
  AssessmentBlueprintAlignmentError,
  parseAssessmentBlueprint,
  requireCompatibleBlueprintTarget,
} from '../assessment_blueprint.ts';
import { parseValidPersistedDraft } from '../persisted_draft.ts';
import { normalizePlacementRevisionSelectors } from '../placement_question_views.ts';
import { safeErrorSummary } from '../error_summary.ts';
import type { RequestContext } from '../tenants.ts';
import { loadPlacementQuestionRevisionRows } from './placement_question_revision_rows.ts';
import { isAdaptiveAssessment } from './assessment_membership.ts';
import { lockWorkspaceAndRequireAuthority } from './workspace_authorization.ts';

/** The persisted restore window starts at the saved removal timestamp, not at UI reload. */
export const PLACEMENT_REMOVAL_WINDOW_MS = 5 * 60 * 1000;

type ReceiptRow = typeof assessmentPlacementRemovals.$inferSelect;
type PlacementRow = typeof assessmentPlacements.$inferSelect;
type AssessmentRow = Pick<typeof assessments.$inferSelect, 'id' | 'blueprint'>;
type Transaction = QflowDatabaseTransaction;

/** Own authorized, atomic removal/recovery with explicit database and clock dependencies. */
export function createAssessmentPlacementRemovalService(dependencies: {
  readonly database: Pick<QflowDatabase, 'transaction'>;
  readonly now: () => Date;
}) {
  const { database, now } = dependencies;
  async function run<T>(
    ctx: RequestContext,
    assessmentId: string,
    operation: (tx: Transaction, assessment: AssessmentRow) => Promise<PlacementRemovalResult<T>>,
  ): Promise<PlacementRemovalResult<T>> {
    try {
      return await database.transaction(async (tx) => {
        if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
          return { ok: false, code: 'forbidden' };
        }
        const [assessment] = await tx.select({
          id: assessments.id,
          blueprint: assessments.blueprint,
        })
          .from(assessments).where(
            and(eq(assessments.id, assessmentId), eq(assessments.tenantId, ctx.tenantId)),
          )
          .for('update');
        if (!assessment) return { ok: false, code: 'not_found' };
        return await operation(tx, assessment);
      });
    } catch (cause: unknown) {
      console.error(
        JSON.stringify({
          event: 'assessment_placement_recovery_failed',
          assessmentId,
          cause: safeErrorSummary(cause),
        }),
      );
      return { ok: false, code: 'storage_failed' };
    }
  }

  async function remove(
    ctx: RequestContext,
    assessmentId: string,
    placementId: string,
    command: PlacementRemovalCommand,
  ): Promise<PlacementRemovalResult<PlacementRemovalReceipt>> {
    return await run(ctx, assessmentId, async (tx) => {
      if (await isAdaptiveAssessment(tx, assessmentId)) {
        return { ok: false, code: 'adaptive_managed' };
      }
      const [prior] = await tx.select().from(assessmentPlacementRemovals).where(
        eq(assessmentPlacementRemovals.id, command.removalId),
      );
      if (prior) {
        if (
          prior.tenantId !== ctx.tenantId || prior.assessmentId !== assessmentId ||
          prior.removedBy !== ctx.userId ||
          prior.placementId !== placementId ||
          prior.expectedRevision !== command.expectedRevision || prior.restoredAt !== null
        ) {
          return { ok: false, code: 'conflict' };
        }
        return { ok: true, value: receiptFromRow(prior) };
      }
      const [placement] = await tx.select({
        placement: assessmentPlacements,
      })
        .from(assessmentPlacements)
        .innerJoin(assessmentParts, eq(assessmentParts.id, assessmentPlacements.assessmentPartId))
        .innerJoin(questions, eq(questions.id, assessmentPlacements.questionId))
        .where(
          and(
            eq(assessmentPlacements.id, placementId),
            eq(assessmentParts.assessmentId, assessmentId),
            eq(questions.tenantId, ctx.tenantId),
          ),
        );
      if (!placement) return { ok: false, code: 'not_found' };
      const row = placement.placement;
      if (row.questionId === null || row.content !== null) {
        throw new Error('Persisted question placement is invalid.');
      }
      const revision = await resolveRevision(tx, ctx, row);
      if (!revision) return { ok: false, code: 'unavailable' };
      if (revision.revision !== command.expectedRevision) return { ok: false, code: 'conflict' };
      const title = questionTitleFromRevision(revision.body);
      if (title === null) return { ok: false, code: 'unavailable' };
      const order = await partOrder(tx, row.assessmentPartId);
      const remainingOrder = order.filter((item) => item.id !== placementId);
      const removedAt = now();
      const [saved] = await tx.insert(assessmentPlacementRemovals).values({
        id: command.removalId,
        tenantId: ctx.tenantId,
        assessmentId,
        removedBy: ctx.userId,
        placementId,
        partId: row.assessmentPartId,
        questionId: row.questionId,
        pinnedRevision: row.pinnedRevision,
        blueprintTargetId: row.blueprintTargetId,
        fixed: row.fixed,
        position: row.position,
        title,
        expectedRevision: command.expectedRevision,
        remainingOrder,
        placementCreatedAt: row.createdAt,
        placementUpdatedAt: row.updatedAt,
        removedAt,
        expiresAt: new Date(removedAt.getTime() + PLACEMENT_REMOVAL_WINDOW_MS),
      }).returning();
      await tx.delete(assessmentPlacements).where(eq(assessmentPlacements.id, placementId));
      await updateCount(tx, assessmentId);
      return { ok: true, value: receiptFromRow(saved) };
    });
  }

  async function restore(
    ctx: RequestContext,
    assessmentId: string,
    removalId: string,
  ): Promise<PlacementRemovalResult<RestoredAssessmentPlacement>> {
    return await run(ctx, assessmentId, async (tx, assessment) => {
      const [row] = await tx.select().from(assessmentPlacementRemovals).where(and(
        eq(assessmentPlacementRemovals.id, removalId),
        eq(assessmentPlacementRemovals.assessmentId, assessmentId),
        eq(assessmentPlacementRemovals.tenantId, ctx.tenantId),
        eq(assessmentPlacementRemovals.removedBy, ctx.userId),
      ));
      if (!row) return { ok: false, code: 'not_found' };
      const receipt = receiptFromRow(row);
      if (await isAdaptiveAssessment(tx, assessmentId)) {
        return { ok: false, code: 'adaptive_managed' };
      }
      const [existing] = await tx.select({
        placement: assessmentPlacements,
        assessmentId: assessmentParts.assessmentId,
      }).from(
        assessmentPlacements,
      )
        .innerJoin(assessmentParts, eq(assessmentParts.id, assessmentPlacements.assessmentPartId))
        .where(eq(assessmentPlacements.id, receipt.placementId));
      if (row.restoredAt !== null) {
        if (
          !existing || existing.assessmentId !== assessmentId ||
          existing.placement.questionId !== receipt.itemId ||
          existing.placement.fixed !== receipt.fixed
        ) {
          return { ok: false, code: 'conflict' };
        }
        return await restoredView(tx, ctx, receipt, existing.placement);
      }
      const restoredAt = now();
      if (restoredAt.getTime() >= row.expiresAt.getTime()) return { ok: false, code: 'expired' };
      if (existing) return { ok: false, code: 'conflict' };
      const [part] = await tx.select({ id: assessmentParts.id }).from(assessmentParts).where(and(
        eq(assessmentParts.id, receipt.partId),
        eq(assessmentParts.assessmentId, assessmentId),
      ));
      if (!part) return { ok: false, code: 'unavailable' };
      const remaining = parsePlacementRemovalOrder(row.remainingOrder);
      if (!remaining) throw new Error('Stored placement recovery order is invalid.');
      const current = await partOrder(tx, receipt.partId);
      if (
        JSON.stringify(current) !== JSON.stringify(remaining) ||
        current.some((item) => item.position === receipt.position)
      ) {
        return { ok: false, code: 'conflict' };
      }
      const placement: PlacementRow = {
        id: receipt.placementId,
        assessmentPartId: receipt.partId,
        questionId: receipt.itemId,
        content: null,
        pinnedRevision: receipt.snapshotRev,
        blueprintTargetId: receipt.blueprintTargetId,
        fixed: receipt.fixed,
        position: receipt.position,
        createdAt: row.placementCreatedAt,
        updatedAt: row.placementUpdatedAt,
      };
      const resolved = await restoredView(tx, ctx, {
        ...receipt,
        restoredAt: restoredAt.toISOString(),
      }, placement);
      if (!resolved.ok) return resolved;
      if (receipt.blueprintTargetId !== null) {
        try {
          requireCompatibleBlueprintTarget(
            parseAssessmentBlueprint(assessment.blueprint),
            receipt.blueprintTargetId,
            resolved.value.draft.type,
          );
        } catch (cause: unknown) {
          if (cause instanceof AssessmentBlueprintAlignmentError) {
            return { ok: false, code: 'conflict' };
          }
          throw cause;
        }
      }
      await tx.insert(assessmentPlacements).values(placement);
      await tx.update(assessmentPlacementRemovals).set({ restoredAt }).where(
        eq(assessmentPlacementRemovals.id, removalId),
      );
      await updateCount(tx, assessmentId);
      return resolved;
    });
  }

  async function list(
    ctx: RequestContext,
    assessmentId: string,
  ): Promise<PlacementRemovalResult<readonly PlacementRemovalReceipt[]>> {
    return await run(ctx, assessmentId, async (tx) => {
      const rows = await tx.select().from(assessmentPlacementRemovals).where(and(
        eq(assessmentPlacementRemovals.assessmentId, assessmentId),
        eq(assessmentPlacementRemovals.tenantId, ctx.tenantId),
        eq(assessmentPlacementRemovals.removedBy, ctx.userId),
        isNull(assessmentPlacementRemovals.restoredAt),
        gt(assessmentPlacementRemovals.expiresAt, now()),
      )).orderBy(desc(assessmentPlacementRemovals.removalSequence)).limit(20);
      return { ok: true, value: rows.map(receiptFromRow) };
    });
  }
  return { remove, restore, list };
}

/** Request composition uses the configured database and wall clock, never a temporary store. */
export const assessmentPlacementRemovalService = createAssessmentPlacementRemovalService({
  database: db,
  now: () => new Date(),
});

function receiptFromRow(row: ReceiptRow): PlacementRemovalReceipt {
  const receipt = parsePlacementRemovalReceipt({
    id: row.id,
    placementId: row.placementId,
    partId: row.partId,
    itemId: row.questionId,
    snapshotRev: row.pinnedRevision,
    blueprintTargetId: row.blueprintTargetId,
    fixed: row.fixed,
    position: row.position,
    title: row.title,
    removedAt: row.removedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    restoredAt: row.restoredAt?.toISOString() ?? null,
  });
  if (!receipt) throw new Error('Stored placement recovery receipt is invalid.');
  return receipt;
}

async function partOrder(tx: Transaction, partId: string) {
  const rows = await tx.select({
    id: assessmentPlacements.id,
    position: assessmentPlacements.position,
  })
    .from(assessmentPlacements).where(eq(assessmentPlacements.assessmentPartId, partId)).orderBy(
      assessmentPlacements.position,
    );
  const parsed = parsePlacementRemovalOrder(rows);
  if (!parsed) throw new Error('Stored assessment part order is ambiguous.');
  return parsed;
}

async function resolveRevision(tx: Transaction, ctx: RequestContext, placement: PlacementRow) {
  if (placement.questionId === null || placement.content !== null) return undefined;
  const [revision] = await loadPlacementQuestionRevisionRows(
    tx,
    ctx.tenantId,
    normalizePlacementRevisionSelectors([
      { itemId: placement.questionId, revision: placement.pinnedRevision },
    ]),
  );
  return revision;
}

async function restoredView(
  tx: Transaction,
  ctx: RequestContext,
  receipt: PlacementRemovalReceipt,
  placement: PlacementRow,
): Promise<PlacementRemovalResult<RestoredAssessmentPlacement>> {
  if (placement.questionId === null || placement.content !== null) {
    return { ok: false, code: 'unavailable' };
  }
  const [question] = await tx.select({ id: questions.id }).from(questions).where(and(
    eq(questions.id, placement.questionId),
    eq(questions.tenantId, ctx.tenantId),
    eq(questions.lifecycleState, 'active'),
  ));
  if (!question) return { ok: false, code: 'unavailable' };
  const row = await resolveRevision(tx, ctx, placement);
  if (!row) return { ok: false, code: 'unavailable' };
  const draft = parseValidPersistedDraft(row.body);
  const order = await partOrder(tx, placement.assessmentPartId);
  return {
    ok: true,
    value: {
      receipt,
      placement: {
        id: placement.id,
        partId: placement.assessmentPartId,
        itemId: placement.questionId,
        snapshotRev: placement.pinnedRevision,
        blueprintTargetId: placement.blueprintTargetId,
        fixed: placement.fixed,
        position: placement.position,
      },
      revision: row.revision,
      beforePlacementId: order.find((item) => item.position > placement.position)?.id ?? null,
      draft,
    },
  };
}

async function updateCount(tx: Transaction, assessmentId: string) {
  await tx.update(assessments).set({
    targetCount:
      sql`(SELECT count(p.question_id)::integer FROM assessment_placements p JOIN assessment_parts s ON s.id = p.assessment_part_id WHERE s.assessment_id = ${assessmentId})`,
    updatedAt: sql`now()`,
  }).where(eq(assessments.id, assessmentId));
}

function questionTitleFromRevision(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const title = Reflect.get(value, 'title');
  return typeof title === 'string' ? title : null;
}

import { reserveAssessmentPositions } from './assessment_insertion.ts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db.ts';
import { assessmentParts, assessmentPlacements, assessments, questions } from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';
import type {
  BankSelectionResult,
  ParsedBankSelectionCommand,
} from '../assessment_bank_selection.ts';
import { parseValidPersistedDraft } from '../persisted_draft.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { hasWorkspaceCapability, lockWorkspace } from './workspace_authorization.ts';
import { loadPlacementQuestionRevisionRows } from './placement_question_revision_rows.ts';
import { validateAutomaticBankSelection } from './bank_selection_validation.ts';
import { isAdaptiveAssessment } from './assessment_membership.ts';

/** Expected rejection of an atomic selection. */
export type BankSelectionFailure =
  | 'forbidden'
  | 'not_found'
  | 'unavailable'
  | 'conflict'
  | 'unsupported_selection'
  | 'storage_failed';

/** Add all selected revisions, or none; exact retries reuse their original placements. */
export async function appendBankSelection(
  ctx: RequestContext,
  assessmentId: string,
  command: ParsedBankSelectionCommand,
): Promise<
  | { readonly ok: true; readonly value: BankSelectionResult }
  | { readonly ok: false; readonly code: BankSelectionFailure }
> {
  try {
    return await db.transaction(async (tx) => {
      if (
        !await lockWorkspace(tx, ctx.tenantId) ||
        !await hasWorkspaceCapability(ctx, 'manage_content', tx)
      ) {
        return { ok: false, code: 'forbidden' } as const;
      }
      const [assessment] = await tx.select({ id: assessments.id }).from(assessments)
        .where(and(eq(assessments.id, assessmentId), eq(assessments.tenantId, ctx.tenantId))).for(
          'update',
        );
      if (!assessment) return { ok: false, code: 'not_found' } as const;
      if (await isAdaptiveAssessment(tx, assessmentId)) {
        return { ok: false, code: 'conflict' } as const;
      }
      const [part] = await tx.select({ id: assessmentParts.id }).from(assessmentParts)
        .where(
          and(
            eq(assessmentParts.id, command.partId),
            eq(assessmentParts.assessmentId, assessmentId),
          ),
        );
      if (!part) return { ok: false, code: 'not_found' } as const;
      const existing = await tx.select({
        id: assessmentPlacements.id,
        itemId: assessmentPlacements.questionId,
        revision: assessmentPlacements.pinnedRevision,
        partId: assessmentPlacements.assessmentPartId,
      }).from(assessmentPlacements)
        .innerJoin(assessmentParts, eq(assessmentParts.id, assessmentPlacements.assessmentPartId))
        .where(eq(assessmentParts.assessmentId, assessmentId));
      const pending = [];
      for (const item of command.items) {
        const prior = existing.find((row) => row.id === item.placementId);
        if (prior) {
          if (
            prior.itemId !== item.itemId || prior.revision !== item.revision ||
            prior.partId !== command.partId
          ) {
            return { ok: false, code: 'conflict' } as const;
          }
        } else {
          if (existing.some((row) => row.itemId === item.itemId)) {
            return { ok: false, code: 'conflict' } as const;
          }
          pending.push(item);
        }
      }
      if (pending.length) {
        const active = await tx.select({ id: questions.id }).from(questions).where(and(
          eq(questions.tenantId, ctx.tenantId),
          eq(questions.lifecycleState, 'active'),
          inArray(questions.id, pending.map((item) => item.itemId)),
        ));
        if (active.length !== pending.length) return { ok: false, code: 'unavailable' } as const;
      }
      const rows = await loadPlacementQuestionRevisionRows(tx, ctx.tenantId, {
        latestItemIds: [],
        pinnedRevisions: command.items,
      });
      const items: BankSelectionResult['items'][number][] = [];
      for (const item of command.items) {
        const row = rows.find((row) =>
          row.itemId === item.itemId && row.revision === item.revision
        );
        if (!row) return { ok: false, code: 'unavailable' } as const;
        items.push({
          placementId: item.placementId,
          itemId: item.itemId,
          revision: item.revision,
          draft: parseValidPersistedDraft(row.body),
        });
      }
      if (pending.some((item) => item.proposal !== null)) {
        const failure = await validateAutomaticBankSelection(
          tx,
          ctx,
          assessmentId,
          command,
          pending,
          rows,
        );
        if (failure) return { ok: false, code: failure } as const;
      }
      if (pending.length) {
        const position = await reserveAssessmentPositions(
          tx,
          command.partId,
          pending.length,
          command.beforePlacementId,
        );
        if (position === null) return { ok: false, code: 'conflict' } as const;
        await tx.insert(assessmentPlacements).values(pending.map((item, index) => ({
          id: item.placementId,
          assessmentPartId: command.partId,
          questionId: item.itemId,
          pinnedRevision: item.revision,
          position: position + index,
        })));
        await tx.update(assessments).set({
          targetCount: sql`coalesce(${assessments.targetCount}, 0) + ${pending.length}`,
          updatedAt: sql`now()`,
        }).where(eq(assessments.id, assessmentId));
      }
      return { ok: true, value: { partId: command.partId, items } } as const;
    });
  } catch (cause: unknown) {
    console.error('Bank selection append failed', safeErrorSummary(cause));
    return { ok: false, code: 'storage_failed' };
  }
}

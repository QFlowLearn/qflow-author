import { and, eq } from 'drizzle-orm';
import { db, type QflowDatabase } from '../db.ts';
import { assessments } from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';
import type { AssessmentArrangeRequest } from '../assessment_arrangement.ts';
import { assessmentArrangementVersion } from '../assessment_arrangement_version.ts';
import {
  AssessmentStructureError,
  replaceAssessmentPartsInTransaction,
} from './assessment_structure.ts';
import {
  AdaptiveAssessmentMembershipError,
  requireManualAssessmentMembership,
} from './assessment_membership.ts';
import { lockWorkspaceAndRequireAuthority } from './workspace_authorization.ts';
import { readAssessmentParts } from './assessment_structure_read.ts';
import { moveAssessmentCanvasPlacement } from '../assessment_canvas_move.ts';

/** Expected arrangement rejection; callers retain their local draft. */
export type AssessmentArrangementSaveFailure = {
  readonly code:
    | 'forbidden'
    | 'stale_structure'
    | 'adaptive_managed'
    | 'invalid_canvas_move'
    | AssessmentStructureError['code'];
  readonly status: 403 | 404 | 409 | 422;
  readonly message: string;
};

/** A saved authoritative version or a recoverable rejection. */
export type AssessmentArrangementSaveResult =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly error: AssessmentArrangementSaveFailure };

/** Compare and replace under workspace/assessment locks; exact retries are read-only successes. */
export async function saveAssessmentParts(
  ctx: RequestContext,
  assessmentId: string,
  request: AssessmentArrangeRequest,
  database: QflowDatabase = db,
): Promise<AssessmentArrangementSaveResult> {
  try {
    return await database.transaction(async (tx) => {
      if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
        return rejection('forbidden', 403, 'Assessment editing is not permitted.');
      }
      const [assessment] = await tx.select({ id: assessments.id }).from(assessments).where(and(
        eq(assessments.id, assessmentId),
        eq(assessments.tenantId, ctx.tenantId),
      )).for('update');
      if (!assessment) return rejection('assessment_not_found', 404, 'Assessment not found.');
      await requireManualAssessmentMembership(tx, assessmentId);
      const savedParts = await readAssessmentParts(tx, assessmentId);
      const current = await assessmentArrangementVersion(assessmentId, savedParts);
      const desired = await assessmentArrangementVersion(assessmentId, request.parts);
      // A lost-response retry never replaces structure or authorizes a stale, different snapshot.
      if (current === desired) return { ok: true, version: current };
      if (current !== request.expectedVersion) {
        return rejection('stale_structure', 409, 'The saved assessment arrangement has changed.');
      }
      if (request.canvasMove) {
        const moved = moveAssessmentCanvasPlacement(savedParts, request.canvasMove);
        if (
          !moved.ok || await assessmentArrangementVersion(assessmentId, moved.parts) !== desired
        ) {
          return rejection(
            'invalid_canvas_move',
            422,
            'Only an ordinary within-part question move is permitted.',
          );
        }
      }
      await replaceAssessmentPartsInTransaction(
        tx,
        ctx,
        assessmentId,
        request.parts.map((part) => ({
          ...part,
          placements: part.placements.map((placement) => ({ ...placement })),
        })),
      );
      return { ok: true, version: desired };
    });
  } catch (cause: unknown) {
    // Translate expected legacy persistence failures only after the transaction has rolled back.
    if (cause instanceof AssessmentStructureError) {
      return rejection(cause.code, cause.status, cause.message);
    }
    if (cause instanceof AdaptiveAssessmentMembershipError) {
      return rejection('adaptive_managed', 422, cause.message);
    }
    throw cause;
  }
}

function rejection(
  code: AssessmentArrangementSaveFailure['code'],
  status: AssessmentArrangementSaveFailure['status'],
  message: string,
): AssessmentArrangementSaveResult {
  return { ok: false, error: { code, status, message } };
}

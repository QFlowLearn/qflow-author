import { AssessmentExportError } from '../export/assessment_export_error.ts';
import { assessmentQuestionPlacements } from '../assessment_content.ts';
import type { QflowDatabase } from '../db.ts';
import type { RequestContext } from '../tenants.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { assessmentArrangementVersion } from '../assessment_arrangement_version.ts';
import {
  type AssessmentQuestionOrderPreview,
  buildQuestionOrderPreview,
} from '../assessment_question_order_preview.ts';
import {
  buildValidatedQti3Assessment,
  toAssessmentExportSelectionDocument,
} from '../export/assessment.ts';
import { loadAssessmentItemExports } from '../export/assessment_loader.ts';
import {
  normalizePlacementRevisionSelectors,
  projectPlacementQuestionViews,
} from '../placement_question_views.ts';
import { getAssessment } from './assessment_records.ts';
import { loadPlacementQuestionRevisionRows } from './placement_question_revision_rows.ts';
import { hasWorkspaceCapability } from './workspace_authorization.ts';

/** Read failures distinguish stale policy and managed sequencing from unavailable preview. */
export type QuestionOrderPreviewResult =
  | { readonly ok: true; readonly value: AssessmentQuestionOrderPreview }
  | {
    readonly ok: false;
    readonly code:
      | 'forbidden'
      | 'assessment_not_found'
      | 'adaptive_managed'
      | 'stale_arrangement'
      | 'empty_assessment'
      | 'invalid_assessment'
      | 'ordering_unsupported'
      | 'cancelled'
      | 'preview_failed';
  };

/** Author-only saved-policy preview through the canonical export and shared order authority. */
export class AssessmentQuestionOrderPreviews {
  constructor(private readonly database: QflowDatabase) {}

  /** Read one consistent snapshot; never save order, edit content or create a learner attempt. */
  async preview(
    ctx: RequestContext,
    assessmentId: string,
    expectedVersion: string,
    options: { readonly seed: string | number; readonly signal?: AbortSignal },
  ): Promise<QuestionOrderPreviewResult> {
    if (options.signal?.aborted) return { ok: false, code: 'cancelled' };
    try {
      const snapshot = await this.database.transaction(async (tx) => {
        if (!await hasWorkspaceCapability(ctx, 'manage_content', tx)) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const assessment = await getAssessment(ctx, assessmentId, tx);
        if (!assessment) return { ok: false, code: 'assessment_not_found' } as const;
        if (assessment.adaptivePlan) return { ok: false, code: 'adaptive_managed' } as const;
        const version = await assessmentArrangementVersion(assessmentId, assessment.parts);
        if (version !== expectedVersion) return { ok: false, code: 'stale_arrangement' } as const;
        const references = assessment.parts.flatMap((part) =>
          assessmentQuestionPlacements(part.placements).map((placement) => ({
            placementId: placement.id,
            itemId: placement.itemId,
            revision: placement.snapshotRev,
          }))
        );
        if (references.length === 0) return { ok: false, code: 'empty_assessment' } as const;
        const [exported, rows] = await Promise.all([
          loadAssessmentItemExports(tx, ctx, toAssessmentExportSelectionDocument(assessment)),
          loadPlacementQuestionRevisionRows(
            tx,
            ctx.tenantId,
            normalizePlacementRevisionSelectors(references),
          ),
        ]);
        return {
          ok: true,
          version,
          document: exported.document,
          views: projectPlacementQuestionViews(references, rows),
        } as const;
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
      // Database/schema adapters do not accept signals; check the caller's lifetime after each.
      if (options.signal?.aborted) return { ok: false, code: 'cancelled' };
      if (!snapshot.ok) return snapshot;
      const exported = await buildValidatedQti3Assessment(snapshot.document);
      if (options.signal?.aborted) return { ok: false, code: 'cancelled' };
      if (!exported.validation.ok) return { ok: false, code: 'invalid_assessment' };
      return buildQuestionOrderPreview({
        xml: exported.xml,
        document: snapshot.document,
        views: snapshot.views,
        version: snapshot.version,
        seed: options.seed,
      });
    } catch (cause: unknown) {
      if (options.signal?.aborted) return { ok: false, code: 'cancelled' };
      if (cause instanceof AssessmentExportError) return { ok: false, code: 'invalid_assessment' };
      console.error(JSON.stringify({
        event: 'assessment_question_order_preview_failed',
        assessmentId,
        cause: safeErrorSummary(cause),
      }));
      return { ok: false, code: 'preview_failed' };
    }
  }
}

import type { AssessmentArrangementSnapshot } from '../assessment_arrangement_version.ts';
import type { AssessmentQuestionOrderPreview } from '../assessment_question_order_preview.ts';
import { parseQuestionOrderPreview } from '../assessment_question_order_preview_response.ts';

/** Read failures keep changed policy and unsupported sequencing visible to the author. */
export type QuestionOrderPreviewRead =
  | { readonly ok: true; readonly value: AssessmentQuestionOrderPreview }
  | {
    readonly ok: false;
    readonly kind: 'stale' | 'empty' | 'managed' | 'unsupported' | 'failed' | 'cancelled';
  };

/** Read a saved-version example with caller-owned cancellation and strict response binding. */
export async function readQuestionOrderPreview(input: {
  readonly assessmentId: string;
  readonly version: string;
  readonly parts: AssessmentArrangementSnapshot;
  readonly signal: AbortSignal;
}): Promise<QuestionOrderPreviewRead> {
  try {
    const response = await fetch(
      `/api/assessments/${input.assessmentId}/question-order-preview?version=${input.version}`,
      { cache: 'no-store', signal: input.signal },
    );
    if (response.status === 409) return { ok: false, kind: 'stale' };
    const body: unknown = await response.json();
    if (response.ok) {
      const value = parseQuestionOrderPreview(body, input.version, input.parts);
      return value ? { ok: true, value } : { ok: false, kind: 'failed' };
    }
    if (response.status === 422 && body !== null && typeof body === 'object') {
      if ('error' in body) {
        if (body.error === 'empty_assessment') return { ok: false, kind: 'empty' };
        if (body.error === 'adaptive_managed') return { ok: false, kind: 'managed' };
        if (body.error === 'ordering_unsupported') return { ok: false, kind: 'unsupported' };
      }
    }
    return { ok: false, kind: 'failed' };
  } catch (_cause: unknown) {
    return { ok: false, kind: input.signal.aborted ? 'cancelled' : 'failed' };
  }
}

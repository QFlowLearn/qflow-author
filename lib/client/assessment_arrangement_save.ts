import type { AssessmentArrangementSnapshot } from '../assessment_arrangement_version.ts';
import type { AssessmentCanvasMove } from '../assessment_canvas_move.ts';

/** Captured arrangement command reused verbatim after an uncertain response. */
export type AssessmentArrangementSaveCommand = {
  readonly expectedVersion: string;
  readonly parts: AssessmentArrangementSnapshot;
  readonly canvasMove?: AssessmentCanvasMove;
};

/** Browser-visible save outcome; serialized responses never become trusted by assertion. */
export type AssessmentArrangementSaveOutcome =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly kind: 'conflict' | 'rejected' | 'uncertain' | 'cancelled' };

/** Save one captured arrangement with caller-owned cancellation and strict success parsing. */
export async function saveAssessmentArrangement(
  assessmentId: string,
  command: AssessmentArrangementSaveCommand,
  signal: AbortSignal,
): Promise<AssessmentArrangementSaveOutcome> {
  try {
    const response = await fetch(`/api/assessments/${assessmentId}/arrange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: command.expectedVersion,
        canvasMove: command.canvasMove,
        parts: command.parts.map((part) => ({
          id: part.id,
          title: part.title,
          options: part.options,
          placements: part.placements.map((placement) =>
            'content' in placement ? placement : ({
              id: placement.id,
              itemId: placement.itemId,
              snapshotRev: placement.snapshotRev ?? undefined,
              blueprintTargetId: placement.blueprintTargetId ?? undefined,
              fixed: placement.fixed,
            })
          ),
        })),
      }),
      signal,
    });
    if (response.status === 409) return { ok: false, kind: 'conflict' };
    if (!response.ok) {
      return { ok: false, kind: response.status >= 500 ? 'uncertain' : 'rejected' };
    }
    const value: unknown = await response.json();
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, kind: 'uncertain' };
    }
    if (
      !('ok' in value) || value.ok !== true || !('version' in value) ||
      typeof value.version !== 'string' || !/^[0-9a-f]{64}$/.test(value.version)
    ) return { ok: false, kind: 'uncertain' };
    return { ok: true, version: value.version };
  } catch (_cause: unknown) {
    return { ok: false, kind: signal.aborted ? 'cancelled' : 'uncertain' };
  }
}

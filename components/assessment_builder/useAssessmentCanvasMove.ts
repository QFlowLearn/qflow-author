import { useEffect, useRef, useState } from 'preact/hooks';
import type { AssessmentCanvasMove } from '../../lib/assessment_canvas_move.ts';
import { moveAssessmentCanvasPlacement } from '../../lib/assessment_canvas_move.ts';
import type { AssessmentArrangementSaveCommand } from '../../lib/client/assessment_arrangement_save.ts';
import type { CapturedAssessmentParts } from './useAssessmentParts.ts';
import type { Part } from '../../islands/assessment_builder/types.ts';

/** Persistence notices for movement; they never represent the question draft's save state. */
export type CanvasMoveStatus =
  | { readonly kind: 'idle' }
  | {
    readonly kind: 'saving' | 'uncertain' | 'conflict' | 'rejected' | 'saved';
    readonly move: AssessmentCanvasMove;
  };

/** Save through Arrange, retaining the captured command and the active question editor independently. */
export function useAssessmentCanvasMove(
  assessmentId: string,
  captureOrder: () => CapturedAssessmentParts,
) {
  const [status, setStatus] = useState<CanvasMoveStatus>({ kind: 'idle' });
  const pending = useRef<
    {
      capture: CapturedAssessmentParts;
      ordered: Part[];
      move: AssessmentCanvasMove;
      command?: AssessmentArrangementSaveCommand;
    } | null
  >(null);
  const inFlight = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const focusFrame = useRef<number | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      inFlight.current?.abort();
      pending.current?.capture.release();
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    };
  }, []);
  useEffect(() => {
    if (status.kind !== 'saving' && status.kind !== 'uncertain') return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener('beforeunload', warn);
    return () => globalThis.removeEventListener('beforeunload', warn);
  }, [status.kind]);

  async function persist() {
    const write = pending.current;
    if (!write || inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setStatus({ kind: 'saving', move: write.move });
    try {
      const [{ assessmentArrangementVersion }, { saveAssessmentArrangement }] = await Promise.all([
        import('../../lib/assessment_arrangement_version.ts'),
        import('../../lib/client/assessment_arrangement_save.ts'),
      ]);
      if (controller.signal.aborted) return;
      write.command ??= {
        expectedVersion: await assessmentArrangementVersion(assessmentId, write.capture.parts),
        parts: write.ordered,
        canvasMove: write.move,
      };
      if (controller.signal.aborted) return;
      const outcome = await saveAssessmentArrangement(
        assessmentId,
        write.command,
        controller.signal,
      );
      if (!alive.current || controller.signal.aborted) return;
      if (outcome.ok) {
        const focused = document.activeElement;
        write.capture.confirm(write.ordered);
        pending.current = null;
        setStatus({ kind: 'saved', move: write.move });
        // Keyed Preact movement retains the editor instance; restore only focus lost by a DOM move.
        // A different focused input or newly chosen control always keeps ownership of focus.
        focusFrame.current = requestAnimationFrame(() => {
          focusFrame.current = null;
          if (
            alive.current && focused instanceof HTMLElement && focused.isConnected &&
            document.activeElement === document.body
          ) {
            focused.focus({ preventScroll: true });
          }
        });
      } else if (outcome.kind !== 'cancelled') {
        const kind = outcome.kind === 'uncertain'
          ? 'uncertain'
          : outcome.kind === 'conflict'
          ? 'conflict'
          : 'rejected';
        if (kind !== 'uncertain') {
          write.capture.release();
          pending.current = null;
        }
        setStatus({ kind, move: write.move });
      }
    } catch (_cause: unknown) {
      if (alive.current && !controller.signal.aborted) {
        setStatus({ kind: 'uncertain', move: write.move });
      }
    } finally {
      inFlight.current = null;
    }
  }

  async function move(move: AssessmentCanvasMove) {
    if (pending.current || status.kind === 'conflict') return;
    const capture = captureOrder();
    const source = capture.parts.find((part) => part.id === move.partId);
    if (
      source?.placements.findIndex((placement) => placement.id === move.placementId) ===
        move.position
    ) {
      capture.release();
      return;
    }
    const ordered = moveAssessmentCanvasPlacement(capture.parts, move);
    if (!ordered.ok) {
      capture.release();
      return;
    }
    pending.current = { capture, ordered: ordered.parts, move };
    await persist();
  }
  return {
    status,
    move,
    retry: persist,
    blocked: status.kind === 'saving' || status.kind === 'uncertain' || status.kind === 'conflict',
  };
}

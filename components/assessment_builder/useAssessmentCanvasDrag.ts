import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import {
  type AssessmentCanvasMove,
  moveAssessmentCanvasPlacement,
} from '../../lib/assessment_canvas_move.ts';
import type { Part, Placement } from '../../islands/assessment_builder/types.ts';

/** Only drags started on this canvas's handle can move a placement; outside and cross-part drops do nothing. */
export function useAssessmentCanvasDrag(
  blocked: boolean,
  move: (move: AssessmentCanvasMove) => Promise<void>,
) {
  const source = useRef<{ partId: string; placementId: string } | null>(null);
  const [target, setTarget] = useState<{ placementId: string; after: boolean } | null>(null);
  function end() {
    source.current = null;
    setTarget(null);
  }
  function start(
    part: Part,
    placement: Placement,
    event: JSX.TargetedDragEvent<HTMLButtonElement>,
  ) {
    if (
      blocked || placement.fixed === true || part.options?.navigationMode === 'linear' ||
      !event.dataTransfer
    ) {
      event.preventDefault();
      return;
    }
    source.current = { partId: part.id, placementId: placement.id };
    event.currentTarget.focus({ preventScroll: true });
    event.dataTransfer.setData('application/x-qflow-placement', placement.id);
    event.dataTransfer.effectAllowed = 'move';
  }
  function destination(
    part: Part,
    placement: Placement,
    event: JSX.TargetedDragEvent<HTMLDivElement>,
  ) {
    const dragged = source.current;
    if (
      blocked || !dragged || dragged.partId !== part.id ||
      part.options?.navigationMode === 'linear' || dragged.placementId === placement.id
    ) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY >= rect.top + rect.height / 2;
    const from = part.placements.findIndex((entry) => entry.id === dragged.placementId);
    const boundary = part.placements.findIndex((entry) => entry.id === placement.id) +
      (after ? 1 : 0);
    if (from < 0) return null;
    const move = { ...dragged, position: boundary - (from < boundary ? 1 : 0) };
    return moveAssessmentCanvasPlacement([part], move).ok ? { move, after } : null;
  }
  function over(part: Part, placement: Placement, event: JSX.TargetedDragEvent<HTMLDivElement>) {
    const result = destination(part, placement, event);
    if (!result) {
      setTarget(null);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setTarget({ placementId: placement.id, after: result.after });
  }
  async function drop(
    part: Part,
    placement: Placement,
    event: JSX.TargetedDragEvent<HTMLDivElement>,
  ) {
    const result = destination(part, placement, event);
    if (!result) return;
    event.preventDefault();
    end();
    await move(result.move);
  }
  return { target, start, end, over, drop };
}

/** An explicit ordinary within-part move, checked by the canonical arrangement writer. */
export type AssessmentCanvasMove = {
  readonly partId: string;
  readonly placementId: string;
  readonly position: number;
};

type MovablePart = {
  readonly id: string;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly placements: readonly { readonly id: string; readonly fixed?: boolean }[];
};

/** Inclusive destinations that keep fixed slots intact; a single destination permits no move. */
export type AssessmentCanvasMoveBounds = {
  readonly first: number;
  readonly last: number;
};

/** Compute every placement's available destinations in one linear pass per part. */
export function assessmentCanvasMoveBounds(
  part: MovablePart,
): ReadonlyMap<string, AssessmentCanvasMoveBounds> {
  const bounds = new Map<string, AssessmentCanvasMoveBounds>();
  const count = part.placements.length;
  if (part.options?.navigationMode === 'linear') {
    for (const [index, placement] of part.placements.entries()) {
      bounds.set(placement.id, { first: index, last: index });
    }
    return bounds;
  }
  let first = 0;
  for (let index = 0; index <= count; index++) {
    if (index < count && part.placements[index].fixed !== true) continue;
    for (let free = first; free < index; free++) {
      bounds.set(part.placements[free].id, { first, last: index - 1 });
    }
    if (index < count) bounds.set(part.placements[index].id, { first: index, last: index });
    first = index + 1;
  }
  return bounds;
}

/** Move an existing placement without changing membership, selectors or part settings. */
export function moveAssessmentCanvasPlacement<P extends MovablePart>(
  parts: readonly P[],
  move: AssessmentCanvasMove,
): { readonly ok: true; readonly parts: P[] } | {
  readonly ok: false;
  readonly reason: 'missing' | 'constrained' | 'position';
} {
  const part = parts.find((entry) => entry.id === move.partId);
  if (!part) return { ok: false, reason: 'missing' };
  if (part.options?.navigationMode === 'linear') return { ok: false, reason: 'constrained' };
  const from = part.placements.findIndex((entry) => entry.id === move.placementId);
  if (from < 0) return { ok: false, reason: 'missing' };
  if (
    !Number.isSafeInteger(move.position) || move.position < 0 ||
    move.position >= part.placements.length
  ) {
    return { ok: false, reason: 'position' };
  }
  const bounds = assessmentCanvasMoveBounds(part).get(move.placementId);
  if (!bounds || move.position < bounds.first || move.position > bounds.last) {
    return { ok: false, reason: 'constrained' };
  }
  const placements = [...part.placements];
  const [placement] = placements.splice(from, 1);
  placements.splice(move.position, 0, placement);
  return {
    ok: true,
    parts: parts.map((entry) => entry.id === part.id ? { ...entry, placements } : entry),
  };
}

import { assessmentQuestionPlacements } from '../../lib/assessment_content.ts';
import { useCallback, useRef, useState } from 'preact/hooks';
import type { Part } from '../../islands/assessment_builder/types.ts';

/** A captured order write can replay confirmed own mutations that finish while it is pending. */
export type CapturedAssessmentParts = {
  readonly parts: Part[];
  readonly confirm: (ordered: Part[]) => void;
  readonly release: () => void;
};

export function useAssessmentParts(input: {
  assessmentId: string;
  parts: Part[];
}) {
  const [parts, renderParts] = useState<Part[]>(() => structuredClone(input.parts));
  const confirmed = useRef(parts);
  const pending = useRef<{ updates: Array<(parts: Part[]) => Part[]> } | null>(null);
  // This setter is only called after a canonical server mutation succeeds.
  const setParts = useCallback((update: (parts: Part[]) => Part[]) => {
    confirmed.current = update(confirmed.current);
    pending.current?.updates.push(update);
    renderParts(confirmed.current);
  }, []);
  const captureOrder = useCallback((): CapturedAssessmentParts => {
    if (pending.current) throw new Error('An assessment order write is already pending.');
    const capture: { updates: Array<(parts: Part[]) => Part[]> } = { updates: [] };
    pending.current = capture;
    return {
      parts: structuredClone(confirmed.current),
      confirm(ordered) {
        if (pending.current !== capture) return;
        confirmed.current = capture.updates.reduce((value, update) => update(value), ordered);
        pending.current = null;
        renderParts(confirmed.current);
      },
      release() {
        if (pending.current === capture) pending.current = null;
      },
    };
  }, []);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(`qflow-collapsed-${input.assessmentId}`);
      return raw ? JSON.parse(raw) : {};
    } catch (_err) {
      return {};
    }
  });

  function togglePart(pid: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [pid]: !prev[pid] };
      try {
        localStorage.setItem(`qflow-collapsed-${input.assessmentId}`, JSON.stringify(next));
      } catch (_err) {
        /* ignore storage errors */
      }
      return next;
    });
  }

  function findItemNumber(
    partId?: string,
    placementId?: string,
    itemId?: string,
  ): string | null {
    if (partId) {
      const partIndex = parts.findIndex((part) => part.id === partId);
      if (partIndex >= 0) {
        const part = parts[partIndex];
        const placements = assessmentQuestionPlacements(part.placements);
        if (placementId) {
          const idx = placements.findIndex((pl) => pl.id === placementId);
          if (idx >= 0) return `${partIndex + 1}.${idx + 1}`;
        }
        if (itemId) {
          const idx = placements.findIndex((pl) => pl.itemId === itemId);
          if (idx >= 0) return `${partIndex + 1}.${idx + 1}`;
        }
      }
    }
    for (const [pIndex, part] of parts.entries()) {
      const placements = assessmentQuestionPlacements(part.placements);
      if (placementId) {
        const idx = placements.findIndex((pl) => pl.id === placementId);
        if (idx >= 0) return `${pIndex + 1}.${idx + 1}`;
      }
      if (itemId) {
        const idx = placements.findIndex((pl) => pl.itemId === itemId);
        if (idx >= 0) return `${pIndex + 1}.${idx + 1}`;
      }
    }
    return null;
  }

  return {
    parts,
    setParts,
    captureOrder,
    collapsed,
    togglePart,
    findItemNumber,
  };
}

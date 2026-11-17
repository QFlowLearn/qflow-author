import { useLayoutEffect } from 'preact/hooks';
import type { Part } from './types.ts';
import type { ArrangeSelection } from './useArrangeDnD.ts';

/** Register movement with the current selection before the next keyboard interaction. */
export function useArrangeBoardKeyboard(options: {
  containerRef: { current: HTMLDivElement | null };
  sel: ArrangeSelection;
  setSel: (sel: ArrangeSelection) => void;
  parts: Part[];
  onSave: () => void;
  movePart: (i: number, dir: -1 | 1) => void;
  moveItem: (partIdx: number, idx: number, dir: -1 | 1) => void;
  moveItemTo: (partIdx: number, idx: number, destPartIdx: number) => void;
}) {
  const { containerRef, sel, setSel, parts, onSave, movePart, moveItem, moveItemTo } = options;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave();
        return;
      }
      if (!sel) return;
      const { partIdx, idx } = sel;
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        movePart(partIdx, dir);
        setSel({ partIdx: Math.max(0, Math.min(parts.length - 1, partIdx + dir)), idx });
        return;
      }
      if (idx == null) return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveItem(partIdx, idx, -1);
        setSel({ partIdx, idx: Math.max(0, idx - 1) });
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveItem(partIdx, idx, 1);
        setSel({ partIdx, idx: Math.min((parts[partIdx]?.placements?.length ?? 1) - 1, idx + 1) });
        return;
      }
      if (e.key === 'ArrowLeft' && partIdx > 0) {
        e.preventDefault();
        moveItemTo(partIdx, idx, partIdx - 1);
        const destLen = (parts[partIdx - 1]?.placements?.length ?? 0) + 1;
        setSel({ partIdx: partIdx - 1, idx: destLen - 1 });
        return;
      }
      if (e.key === 'ArrowRight' && partIdx < parts.length - 1) {
        e.preventDefault();
        moveItemTo(partIdx, idx, partIdx + 1);
        const destLen = (parts[partIdx + 1]?.placements?.length ?? 0) + 1;
        setSel({ partIdx: partIdx + 1, idx: destLen - 1 });
      }
    };

    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [containerRef, sel, parts, onSave, movePart, moveItem, moveItemTo, setSel]);
}

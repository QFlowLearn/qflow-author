import type { Part } from './types.ts';

export type ArrangeDragState =
  | { kind: 'part'; partIdx: number; idx?: undefined }
  | { kind: 'item'; partIdx: number; idx: number }
  | null;

export type ArrangeSelection = { partIdx: number; idx?: number } | null;

export function createArrangeMutations(
  setParts: (updater: (prev: Part[]) => Part[]) => void,
) {
  const movePart = (i: number, dir: -1 | 1) => {
    setParts((prev) => {
      const arr = [...prev];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return prev;
      const [x] = arr.splice(i, 1);
      arr.splice(j, 0, x);
      return arr;
    });
  };

  const moveItem = (partIdx: number, idx: number, dir: -1 | 1) => {
    setParts((prev) => {
      const arr = [...prev];
      const list = [...arr[partIdx].placements];
      const j = idx + dir;
      if (j < 0 || j >= list.length) return prev;
      const [x] = list.splice(idx, 1);
      list.splice(j, 0, x);
      arr[partIdx] = { ...arr[partIdx], placements: list };
      return arr;
    });
  };

  const removeItem = (partIdx: number, idx: number) => {
    setParts((prev) =>
      prev.map((p, i) =>
        i === partIdx ? { ...p, placements: p.placements.filter((_, j) => j !== idx) } : p
      )
    );
  };

  const moveItemTo = (partIdx: number, idx: number, destPartIdx: number) => {
    if (destPartIdx === partIdx) return;
    setParts((prev) => {
      const arr = [...prev];
      const src = { ...arr[partIdx], placements: [...arr[partIdx].placements] };
      const [pl] = src.placements.splice(idx, 1);
      arr[partIdx] = src;
      const dst = { ...arr[destPartIdx] };
      dst.placements = [...dst.placements, pl];
      arr[destPartIdx] = dst;
      return arr;
    });
  };

  const dropPart = (drag: ArrangeDragState, targetIdx: number) => {
    if (!drag || drag.kind !== 'part') return;
    setParts((prev) => {
      const arr = [...prev];
      const [x] = arr.splice(drag.partIdx, 1);
      arr.splice(targetIdx, 0, x);
      return arr;
    });
  };

  const dropItem = (drag: ArrangeDragState, partIdx: number, idx?: number) => {
    if (!drag || drag.kind !== 'item') return;
    const sourceIdx = drag.idx;
    setParts((prev) => {
      const arr = [...prev];
      const srcList = [...arr[drag.partIdx].placements];
      const [x] = srcList.splice(sourceIdx, 1);
      arr[drag.partIdx] = { ...arr[drag.partIdx], placements: srcList };
      const dstList = [...arr[partIdx].placements];
      let insertAt = idx ?? dstList.length;
      if (drag.partIdx === partIdx && sourceIdx < insertAt) insertAt -= 1;
      insertAt = Math.max(0, Math.min(insertAt, dstList.length));
      dstList.splice(insertAt, 0, x);
      arr[partIdx] = { ...arr[partIdx], placements: dstList };
      return arr;
    });
  };

  return { movePart, moveItem, removeItem, moveItemTo, dropPart, dropItem };
}

export function createArrangeDnDHandlers(options: {
  drag: ArrangeDragState;
  setDrag: (drag: ArrangeDragState) => void;
  dropPart: (targetIdx: number) => void;
  dropItem: (partIdx: number, idx?: number) => void;
}) {
  const { drag, setDrag, dropPart, dropItem } = options;

  return {
    onPartDragStart: (e: DragEvent, i: number) => {
      e.dataTransfer?.setData('text/plain', 'part');
      setDrag({ kind: 'part', partIdx: i });
    },
    onPartDragOver: (e: Event) => {
      if (!drag || drag.kind !== 'part') return;
      e.preventDefault();
    },
    onPartDrop: (i: number) => {
      if (!drag || drag.kind !== 'part') return;
      dropPart(i);
      setDrag(null);
    },
    onItemDragStart: (e: DragEvent, pi: number, idx: number) => {
      e.dataTransfer?.setData('text/plain', 'item');
      setDrag({ kind: 'item', partIdx: pi, idx });
    },
    onItemDragOver: (e: Event) => {
      if (!drag || drag.kind !== 'item') return;
      e.preventDefault();
    },
    onItemDrop: (pi: number, idx?: number) => {
      if (!drag || drag.kind !== 'item') return;
      dropItem(pi, idx);
      setDrag(null);
    },
    clearDrag: () => setDrag(null),
  };
}

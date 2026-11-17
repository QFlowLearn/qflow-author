import type { ImageEditState } from './image_edit.ts';
import { imageEditStatesEqual } from './image_edit.ts';

/** Maximum number of committed editor states retained for undo and redo. */
export const MAX_IMAGE_EDIT_HISTORY = 50;

/** Bounded image-editor history with one selected committed state. */
export type ImageEditHistoryState = {
  readonly entries: readonly ImageEditState[];
  readonly index: number;
};

/** Create history containing only the initial editor state. */
export function createImageEditHistory(initial: ImageEditState): ImageEditHistoryState {
  return { entries: [initial], index: 0 };
}

/** Commit a state, discarding redo entries and the oldest overflow entry. */
export function commitImageEditHistory(
  history: ImageEditHistoryState,
  next: ImageEditState,
): ImageEditHistoryState {
  const current = history.entries[history.index];
  if (current && imageEditStatesEqual(current, next)) return history;
  const appended = [...history.entries.slice(0, history.index + 1), next];
  const entries = appended.slice(-MAX_IMAGE_EDIT_HISTORY);
  return { entries, index: entries.length - 1 };
}

/** Select the previous committed state when one exists. */
export function undoImageEditHistory(history: ImageEditHistoryState): ImageEditHistoryState {
  return { ...history, index: Math.max(0, history.index - 1) };
}

/** Select the next committed state when one exists. */
export function redoImageEditHistory(history: ImageEditHistoryState): ImageEditHistoryState {
  return {
    ...history,
    index: Math.min(history.entries.length - 1, history.index + 1),
  };
}

/** Return the selected committed state. */
export function currentImageEditState(history: ImageEditHistoryState): ImageEditState {
  const current = history.entries[history.index];
  if (!current) throw new Error('Image edit history must contain a selected state.');
  return current;
}

import { useCallback, useState } from 'preact/hooks';

import type { ImageEditState } from '../../lib/client/image_edit.ts';
import {
  commitImageEditHistory,
  createImageEditHistory,
  currentImageEditState,
  redoImageEditHistory,
  undoImageEditHistory,
} from '../../lib/client/image_edit_history.ts';

type ImageEditHistory = {
  readonly state: ImageEditState;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly preview: (next: ImageEditState) => void;
  readonly cancelPreview: () => void;
  readonly commit: (next: ImageEditState) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly reset: () => void;
};

/** Manage bounded committed history while allowing uncommitted pointer previews. */
export function useImageEditHistory(initial: ImageEditState): ImageEditHistory {
  const [history, setHistory] = useState(() => createImageEditHistory(initial));
  const [previewState, setPreviewState] = useState<ImageEditState | null>(null);
  const state = previewState ?? currentImageEditState(history);

  const commit = useCallback((next: ImageEditState) => {
    setHistory((current) => commitImageEditHistory(current, next));
    setPreviewState(null);
  }, []);

  const cancelPreview = useCallback(() => setPreviewState(null), []);

  const undo = useCallback(() => {
    setHistory(undoImageEditHistory);
    setPreviewState(null);
  }, []);

  const redo = useCallback(() => {
    setHistory(redoImageEditHistory);
    setPreviewState(null);
  }, []);

  const reset = useCallback(() => {
    setHistory(createImageEditHistory(initial));
    setPreviewState(null);
  }, [initial]);

  return {
    state,
    canUndo: history.index > 0,
    canRedo: history.index < history.entries.length - 1,
    preview: setPreviewState,
    cancelPreview,
    commit,
    undo,
    redo,
    reset,
  };
}

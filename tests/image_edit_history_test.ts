import { expect, test as testCase } from 'vitest';

import {
  createInitialImageEditState,
  imageEditStatesEqual,
  serializeImageEditState,
  setCropZoom,
} from '../lib/client/image_edit.ts';
import {
  commitImageEditHistory,
  createImageEditHistory,
  currentImageEditState,
  MAX_IMAGE_EDIT_HISTORY,
  redoImageEditHistory,
  undoImageEditHistory,
} from '../lib/client/image_edit_history.ts';

testCase('image edit history supports undo, redo, and redo truncation', () => {
  const initial = createInitialImageEditState(800, 600);
  const zoomed = setCropZoom(initial, 2);
  const closer = setCropZoom(initial, 3);
  let history = createImageEditHistory(initial);
  history = commitImageEditHistory(history, zoomed);
  history = commitImageEditHistory(history, closer);
  history = undoImageEditHistory(history);
  expect(currentImageEditState(history)).toStrictEqual(zoomed);
  history = redoImageEditHistory(history);
  expect(currentImageEditState(history)).toStrictEqual(closer);
  history = undoImageEditHistory(history);
  history = commitImageEditHistory(history, setCropZoom(initial, 4));
  expect(history.entries.length).toStrictEqual(3);
  expect(history.index).toStrictEqual(2);
});

testCase('image edit history retains at most fifty committed states', () => {
  const initial = createInitialImageEditState(800, 600);
  let history = createImageEditHistory(initial);
  for (let index = 0; index < 75; index += 1) {
    history = commitImageEditHistory(history, {
      ...initial,
      transform: { ...initial.transform, straighten: index / 10 },
    });
  }
  expect(history.entries.length).toStrictEqual(MAX_IMAGE_EDIT_HISTORY);
  expect(history.index).toStrictEqual(MAX_IMAGE_EDIT_HISTORY - 1);
});

testCase('image edit state equality follows the canonical serialized form', () => {
  const initial = createInitialImageEditState(800, 600);
  const zoomed = setCropZoom(initial, 2);
  expect(imageEditStatesEqual(initial, initial)).toStrictEqual(true);
  expect(imageEditStatesEqual(initial, zoomed)).toStrictEqual(false);
  expect(serializeImageEditState(zoomed)).toStrictEqual(
    serializeImageEditState(setCropZoom(initial, 2)),
  );
});

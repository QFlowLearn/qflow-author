import { expect, test as testCase } from 'vitest';

import {
  applyCropDelta,
  centerCrop,
  createInitialImageEditState,
  cropZoom,
  MAX_IMAGE_OUTPUT_DIMENSION,
  moveCrop,
  planImageEdit,
  resizeCrop,
  rotateQuarterTurn,
  setCropAspect,
  setCropZoom,
  setOutputDimension,
  setOutputLocked,
} from '../lib/client/image_edit.ts';

testCase('image edit plan combines crop, rotation, straightening, and flips', () => {
  let state = createInitialImageEditState(1600, 900);
  state = setCropAspect(state, 'four-three');
  state = rotateQuarterTurn(state, 'right');
  state = {
    ...state,
    transform: {
      ...state.transform,
      straighten: 2.5,
      flipHorizontal: true,
      flipVertical: true,
    },
  };

  expect(planImageEdit(state)).toStrictEqual({
    crop: { x: 200, y: 0, width: 1200, height: 900 },
    outputWidth: 900,
    outputHeight: 1200,
    transform: {
      quarterTurn: 90,
      straighten: 2.5,
      flipHorizontal: true,
      flipVertical: true,
    },
  });
});

testCase('moving a crop clamps it to every source edge', () => {
  const crop = { x: 100, y: 100, width: 400, height: 300 };
  expect(moveCrop(crop, -500, -500, 1000, 800)).toStrictEqual({
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  expect(moveCrop(crop, 1000, 1000, 1000, 800)).toStrictEqual({
    x: 600,
    y: 500,
    width: 400,
    height: 300,
  });
});

testCase('centering a crop preserves its dimensions and output intent', () => {
  let state = createInitialImageEditState(1000, 800);
  state = setCropAspect(state, 'four-three');
  state = applyCropDelta(state, 'move', 300, 100);
  state = setOutputDimension(state, 'width', 1600);
  const output = state.output;

  state = centerCrop(state);

  expect(state.crop).toStrictEqual({
    x: 0,
    y: 25,
    width: 1000,
    height: 750,
  });
  expect(state.output).toStrictEqual(output);
});

testCase('all crop handles remain inside the source and respect a locked ratio', () => {
  const handles = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
  const deltas = [-2000, -200, -20, 0, 20, 200, 2000];
  for (const handle of handles) {
    for (const deltaX of deltas) {
      for (const deltaY of deltas) {
        const crop = resizeCrop(
          { x: 200, y: 150, width: 400, height: 300 },
          handle,
          deltaX,
          deltaY,
          1000,
          800,
          'four-three',
        );
        const context = `${handle}: ${deltaX}, ${deltaY}`;
        expect(crop.x >= 0, context).toStrictEqual(true);
        expect(crop.y >= 0, context).toStrictEqual(true);
        expect(crop.x + crop.width <= 1000, context).toStrictEqual(true);
        expect(crop.y + crop.height <= 800, context).toStrictEqual(true);
        expect(Math.min(crop.width, crop.height) >= 16, context).toStrictEqual(true);
        expect(Math.abs(crop.width / crop.height - 4 / 3) < 0.0001, context).toStrictEqual(true);
      }
    }
  }
});

testCase('zoom scales the crop around its current position from one to four times', () => {
  let state = createInitialImageEditState(1600, 900);
  state = setCropZoom(state, 2);
  expect(state.crop).toStrictEqual({ x: 400, y: 225, width: 800, height: 450 });
  expect(cropZoom(state)).toStrictEqual(2);

  state = setCropZoom(state, 10);
  expect(cropZoom(state)).toStrictEqual(4);
  expect(state.crop).toStrictEqual({ x: 600, y: 337.5, width: 400, height: 225 });
});

testCase('output dimensions lock ratios, allow explicit upscaling, and enforce caps', () => {
  let state = createInitialImageEditState(800, 600);
  state = setOutputDimension(state, 'width', 1600);
  expect(state.output).toStrictEqual({
    width: 1600,
    height: 1200,
    locked: true,
    sizing: 'custom',
  });
  state = setOutputDimension(state, 'height', 900);
  expect(state.output).toStrictEqual({
    width: 1200,
    height: 900,
    locked: true,
    sizing: 'custom',
  });
  state = setOutputLocked(state, false);
  state = setOutputDimension(state, 'width', 10000);
  expect(state.output.width).toStrictEqual(MAX_IMAGE_OUTPUT_DIMENSION);
  expect(state.output.height).toStrictEqual(900);
});

testCase('crop and transform changes preserve explicit output intent', () => {
  let state = createInitialImageEditState(800, 600);
  state = setOutputDimension(state, 'width', 1600);
  state = setOutputLocked(state, false);
  const explicitOutput = state.output;

  state = applyCropDelta(state, 'move', 10, 10);
  expect(state.output).toStrictEqual(explicitOutput);
  state = applyCropDelta(state, 'se', -100, -100);
  expect(state.output).toStrictEqual(explicitOutput);
  state = setCropZoom(state, 2);
  expect(state.output).toStrictEqual(explicitOutput);
  state = setCropAspect(state, 'square');
  expect(state.output).toStrictEqual(explicitOutput);
  state = rotateQuarterTurn(state, 'right');
  expect(state.output).toStrictEqual(explicitOutput);
});

testCase('automatic output follows geometry without overriding the lock choice', () => {
  let state = createInitialImageEditState(800, 600);
  state = setOutputLocked(state, false);
  state = setCropAspect(state, 'square');
  expect(state.output).toStrictEqual({
    width: 600,
    height: 600,
    locked: false,
    sizing: 'automatic',
  });
  state = rotateQuarterTurn(state, 'right');
  expect(state.output).toStrictEqual({
    width: 600,
    height: 600,
    locked: false,
    sizing: 'automatic',
  });
});

testCase('image edit state rejects impossible source dimensions', () => {
  expect(() => createInitialImageEditState(0, 900)).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('positive')
    ),
  );
});

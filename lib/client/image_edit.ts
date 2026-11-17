/** Crop ratios available in the authoring image editor. */
export type CropAspect = 'free' | 'original' | 'square' | 'four-three' | 'sixteen-nine';

/** Rectangle expressed in source-image pixels. */
export type CropRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Handles exposed by the interactive crop overlay. */
export type CropHandle = 'move' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Direction and presentation metadata shared by crop geometry and controls. */
export type CropHandleDefinition = {
  readonly xDirection: -1 | 0 | 1;
  readonly yDirection: -1 | 0 | 1;
  readonly cursor: string;
};

/** Canonical crop-handle definitions in keyboard navigation order. */
export const CROP_HANDLE_DEFINITIONS: Readonly<Record<CropHandle, CropHandleDefinition>> = {
  move: {
    xDirection: 0,
    yDirection: 0,
    cursor: 'move',
  },
  n: {
    xDirection: 0,
    yDirection: -1,
    cursor: 'n-resize',
  },
  ne: {
    xDirection: 1,
    yDirection: -1,
    cursor: 'ne-resize',
  },
  e: {
    xDirection: 1,
    yDirection: 0,
    cursor: 'e-resize',
  },
  se: {
    xDirection: 1,
    yDirection: 1,
    cursor: 'se-resize',
  },
  s: {
    xDirection: 0,
    yDirection: 1,
    cursor: 's-resize',
  },
  sw: {
    xDirection: -1,
    yDirection: 1,
    cursor: 'sw-resize',
  },
  w: {
    xDirection: -1,
    yDirection: 0,
    cursor: 'w-resize',
  },
  nw: {
    xDirection: -1,
    yDirection: -1,
    cursor: 'nw-resize',
  },
};

/** Resize handles in clockwise keyboard navigation order. */
export const CROP_RESIZE_HANDLES = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
] as const satisfies readonly Exclude<CropHandle, 'move'>[];

/** Image transformations applied around the crop center. */
export type ImageTransform = {
  readonly quarterTurn: 0 | 90 | 180 | 270;
  readonly straighten: number;
  readonly flipHorizontal: boolean;
  readonly flipVertical: boolean;
};

/** Requested dimensions for the generated PNG. */
export type ImageOutputSize = {
  readonly width: number;
  readonly height: number;
  readonly locked: boolean;
  readonly sizing: 'automatic' | 'custom';
};

/** Complete, valid state for one image-editing session. */
export type ImageEditState = {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly aspect: CropAspect;
  readonly crop: CropRect;
  readonly transform: ImageTransform;
  readonly output: ImageOutputSize;
};

/** Deterministic geometry shared by result preview and PNG export. */
export type ImageEditPlan = {
  readonly crop: CropRect;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly transform: ImageTransform;
};

/** Largest generated width or height accepted by the editor. */
export const MAX_IMAGE_OUTPUT_DIMENSION = 4096;

/** Smallest crop edge that remains usable with pointer and keyboard controls. */
const MIN_CROP_EDGE = 16;

/** Parse a crop ratio selected by the controlled authoring form. */
export function parseCropAspect(value: string): CropAspect {
  switch (value) {
    case 'free':
    case 'original':
    case 'square':
    case 'four-three':
    case 'sixteen-nine':
      return value;
    default:
      throw new Error(`Unsupported crop aspect: ${value}`);
  }
}

/** Create the initial full-image editor state. */
export function createInitialImageEditState(
  sourceWidth: number,
  sourceHeight: number,
): ImageEditState {
  assertSourceDimensions(sourceWidth, sourceHeight);
  const crop = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  return {
    sourceWidth,
    sourceHeight,
    aspect: 'original',
    crop,
    transform: {
      quarterTurn: 0,
      straighten: 0,
      flipHorizontal: false,
      flipVertical: false,
    },
    output: naturalOutputSize(crop, 0),
  };
}

/** Select a ratio while retaining as much of the current crop as possible. */
export function setCropAspect(state: ImageEditState, aspect: CropAspect): ImageEditState {
  const ratio = aspectRatio(aspect, state.sourceWidth / state.sourceHeight);
  if (ratio === null) return { ...state, aspect };

  const centerX = state.crop.x + state.crop.width / 2;
  const centerY = state.crop.y + state.crop.height / 2;
  const fitted = largestRectForRatio(state.crop.width, state.crop.height, ratio);
  const crop = positionCrop(
    fitted.width,
    fitted.height,
    centerX,
    centerY,
    { xDirection: 0, yDirection: 0 },
    state.sourceWidth,
    state.sourceHeight,
  );
  return refreshAutomaticOutput({ ...state, aspect, crop });
}

/** Replace the crop rectangle and refresh its natural output dimensions. */
function setCropRect(state: ImageEditState, crop: CropRect): ImageEditState {
  return refreshAutomaticOutput({
    ...state,
    crop: constrainCropRect(crop, state.sourceWidth, state.sourceHeight),
  });
}

/** Center the current crop without changing its dimensions. */
export function centerCrop(state: ImageEditState): ImageEditState {
  return setCropRect(state, {
    ...state.crop,
    x: (state.sourceWidth - state.crop.width) / 2,
    y: (state.sourceHeight - state.crop.height) / 2,
  });
}

/** Apply one crop-handle delta through the editor's canonical geometry path. */
export function applyCropDelta(
  state: ImageEditState,
  handle: CropHandle,
  deltaX: number,
  deltaY: number,
): ImageEditState {
  const crop = handle === 'move'
    ? moveCrop(
      state.crop,
      deltaX,
      deltaY,
      state.sourceWidth,
      state.sourceHeight,
    )
    : resizeCrop(
      state.crop,
      handle,
      deltaX,
      deltaY,
      state.sourceWidth,
      state.sourceHeight,
      state.aspect,
    );
  return setCropRect(state, crop);
}

/** Move a crop rectangle while keeping it inside the source image. */
export function moveCrop(
  crop: CropRect,
  deltaX: number,
  deltaY: number,
  sourceWidth: number,
  sourceHeight: number,
): CropRect {
  return constrainCropRect(
    {
      ...crop,
      x: crop.x + deltaX,
      y: crop.y + deltaY,
    },
    sourceWidth,
    sourceHeight,
  );
}

/** Resize a crop from one of its eight handles. */
export function resizeCrop(
  crop: CropRect,
  handle: Exclude<CropHandle, 'move'>,
  deltaX: number,
  deltaY: number,
  sourceWidth: number,
  sourceHeight: number,
  aspect: CropAspect,
): CropRect {
  const ratio = aspectRatio(aspect, sourceWidth / sourceHeight);
  const direction = CROP_HANDLE_DEFINITIONS[handle];
  return ratio === null
    ? resizeFreeCrop(crop, direction, deltaX, deltaY, sourceWidth, sourceHeight)
    : resizeRatioCrop(
      crop,
      direction,
      deltaX,
      deltaY,
      sourceWidth,
      sourceHeight,
      ratio,
    );
}

/** Set crop zoom, where 1 fits the selected ratio and 4 is the closest view. */
export function setCropZoom(state: ImageEditState, zoom: number): ImageEditState {
  const normalizedZoom = clamp(zoom, 1, 4);
  const ratio = aspectRatio(state.aspect, state.sourceWidth / state.sourceHeight) ??
    state.crop.width / state.crop.height;
  const fitted = largestRectForRatio(state.sourceWidth, state.sourceHeight, ratio);
  const width = fitted.width / normalizedZoom;
  const height = fitted.height / normalizedZoom;
  const centerX = state.crop.x + state.crop.width / 2;
  const centerY = state.crop.y + state.crop.height / 2;
  const crop = positionCrop(
    width,
    height,
    centerX,
    centerY,
    { xDirection: 0, yDirection: 0 },
    state.sourceWidth,
    state.sourceHeight,
  );
  return refreshAutomaticOutput({ ...state, crop });
}

/** Return the zoom represented by the current crop. */
export function cropZoom(state: ImageEditState): number {
  const ratio = aspectRatio(state.aspect, state.sourceWidth / state.sourceHeight) ??
    state.crop.width / state.crop.height;
  const fitted = largestRectForRatio(state.sourceWidth, state.sourceHeight, ratio);
  return clamp(Math.min(fitted.width / state.crop.width, fitted.height / state.crop.height), 1, 4);
}

/** Update the generated width or height and optionally preserve its ratio. */
export function setOutputDimension(
  state: ImageEditState,
  dimension: 'width' | 'height',
  value: number,
): ImageEditState {
  const normalized = Math.round(clamp(value, 1, MAX_IMAGE_OUTPUT_DIMENSION));
  if (!state.output.locked) {
    return {
      ...state,
      output: { ...state.output, [dimension]: normalized, sizing: 'custom' },
    };
  }
  const ratio = state.output.width / state.output.height;
  const width = dimension === 'width'
    ? normalized
    : Math.round(clamp(normalized * ratio, 1, MAX_IMAGE_OUTPUT_DIMENSION));
  const height = dimension === 'height'
    ? normalized
    : Math.round(clamp(normalized / ratio, 1, MAX_IMAGE_OUTPUT_DIMENSION));
  return {
    ...state,
    output: { ...state.output, width, height, sizing: 'custom' },
  };
}

/** Update the output aspect-lock setting. */
export function setOutputLocked(state: ImageEditState, locked: boolean): ImageEditState {
  return { ...state, output: { ...state.output, locked } };
}

/** Rotate the image one quarter turn while retaining the crop. */
export function rotateQuarterTurn(
  state: ImageEditState,
  direction: 'left' | 'right',
): ImageEditState {
  const delta = direction === 'right' ? 90 : 270;
  const quarterTurn = ((state.transform.quarterTurn + delta) % 360) as
    | 0
    | 90
    | 180
    | 270;
  return refreshAutomaticOutput({
    ...state,
    transform: { ...state.transform, quarterTurn },
  });
}

/** Produce the rendering plan for an editor state. */
export function planImageEdit(state: ImageEditState): ImageEditPlan {
  assertSourceDimensions(state.sourceWidth, state.sourceHeight);
  return {
    crop: constrainCropRect(
      state.crop,
      state.sourceWidth,
      state.sourceHeight,
    ),
    outputWidth: Math.round(clamp(state.output.width, 1, MAX_IMAGE_OUTPUT_DIMENSION)),
    outputHeight: Math.round(clamp(state.output.height, 1, MAX_IMAGE_OUTPUT_DIMENSION)),
    transform: {
      ...state.transform,
      straighten: clamp(state.transform.straighten, -10, 10),
    },
  };
}

/** Constrain a rectangle to valid source-image geometry. */
function constrainCropRect(
  crop: CropRect,
  sourceWidth: number,
  sourceHeight: number,
): CropRect {
  assertSourceDimensions(sourceWidth, sourceHeight);
  const minimumWidth = Math.min(MIN_CROP_EDGE, sourceWidth);
  const minimumHeight = Math.min(MIN_CROP_EDGE, sourceHeight);
  const width = clamp(crop.width, minimumWidth, sourceWidth);
  const height = clamp(crop.height, minimumHeight, sourceHeight);
  return {
    x: clamp(crop.x, 0, sourceWidth - width),
    y: clamp(crop.y, 0, sourceHeight - height),
    width,
    height,
  };
}

function refreshAutomaticOutput(state: ImageEditState): ImageEditState {
  if (state.output.sizing === 'custom') return state;
  return {
    ...state,
    output: naturalOutputSize(
      state.crop,
      state.transform.quarterTurn,
      state.output.locked,
    ),
  };
}

function naturalOutputSize(
  crop: CropRect,
  quarterTurn: ImageTransform['quarterTurn'],
  locked = true,
): ImageOutputSize {
  const swapsDimensions = quarterTurn === 90 || quarterTurn === 270;
  const naturalWidth = swapsDimensions ? crop.height : crop.width;
  const naturalHeight = swapsDimensions ? crop.width : crop.height;
  const scale = Math.min(
    1,
    MAX_IMAGE_OUTPUT_DIMENSION / Math.max(naturalWidth, naturalHeight),
  );
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
    locked,
    sizing: 'automatic',
  };
}

function resizeFreeCrop(
  crop: CropRect,
  direction: Pick<CropHandleDefinition, 'xDirection' | 'yDirection'>,
  deltaX: number,
  deltaY: number,
  sourceWidth: number,
  sourceHeight: number,
): CropRect {
  const anchorX = cropAnchor(crop.x, crop.width, direction.xDirection);
  const anchorY = cropAnchor(crop.y, crop.height, direction.yDirection);
  const maximumWidth = availableSize(anchorX, sourceWidth, direction.xDirection);
  const maximumHeight = availableSize(anchorY, sourceHeight, direction.yDirection);
  const width = direction.xDirection === 0 ? crop.width : clamp(
    crop.width + direction.xDirection * deltaX,
    Math.min(MIN_CROP_EDGE, maximumWidth),
    maximumWidth,
  );
  const height = direction.yDirection === 0 ? crop.height : clamp(
    crop.height + direction.yDirection * deltaY,
    Math.min(MIN_CROP_EDGE, maximumHeight),
    maximumHeight,
  );
  return positionCrop(
    width,
    height,
    anchorX,
    anchorY,
    direction,
    sourceWidth,
    sourceHeight,
  );
}

function resizeRatioCrop(
  crop: CropRect,
  direction: Pick<CropHandleDefinition, 'xDirection' | 'yDirection'>,
  deltaX: number,
  deltaY: number,
  sourceWidth: number,
  sourceHeight: number,
  ratio: number,
): CropRect {
  const anchorX = cropAnchor(crop.x, crop.width, direction.xDirection);
  const anchorY = cropAnchor(crop.y, crop.height, direction.yDirection);
  const maximumWidth = availableSize(anchorX, sourceWidth, direction.xDirection);
  const maximumHeight = availableSize(anchorY, sourceHeight, direction.yDirection);
  const maximumRatioHeight = Math.min(maximumHeight, maximumWidth / ratio);
  const minimumRatioHeight = Math.min(
    maximumRatioHeight,
    Math.max(MIN_CROP_EDGE, MIN_CROP_EDGE / ratio),
  );
  const widthDrivenHeight = (crop.width + direction.xDirection * deltaX) / ratio;
  const heightDrivenHeight = crop.height + direction.yDirection * deltaY;
  const proposedHeight = direction.xDirection === 0
    ? heightDrivenHeight
    : direction.yDirection === 0
    ? widthDrivenHeight
    : Math.abs(widthDrivenHeight - crop.height) >=
        Math.abs(heightDrivenHeight - crop.height)
    ? widthDrivenHeight
    : heightDrivenHeight;
  const height = clamp(proposedHeight, minimumRatioHeight, maximumRatioHeight);
  return positionCrop(
    height * ratio,
    height,
    anchorX,
    anchorY,
    direction,
    sourceWidth,
    sourceHeight,
  );
}

function cropAnchor(position: number, size: number, direction: -1 | 0 | 1): number {
  if (direction === -1) return position + size;
  if (direction === 1) return position;
  return position + size / 2;
}

function availableSize(anchor: number, sourceSize: number, direction: -1 | 0 | 1): number {
  if (direction === -1) return anchor;
  if (direction === 1) return sourceSize - anchor;
  return 2 * Math.min(anchor, sourceSize - anchor);
}

function positionCrop(
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
  direction: Pick<CropHandleDefinition, 'xDirection' | 'yDirection'>,
  sourceWidth: number,
  sourceHeight: number,
): CropRect {
  return {
    x: cropPosition(anchorX, width, direction.xDirection, sourceWidth),
    y: cropPosition(anchorY, height, direction.yDirection, sourceHeight),
    width,
    height,
  };
}

function cropPosition(
  anchor: number,
  size: number,
  direction: -1 | 0 | 1,
  sourceSize: number,
): number {
  const position = direction === -1 ? anchor - size : direction === 1 ? anchor : anchor - size / 2;
  return clamp(position, 0, sourceSize - size);
}

function aspectRatio(aspect: CropAspect, originalRatio: number): number | null {
  switch (aspect) {
    case 'free':
      return null;
    case 'square':
      return 1;
    case 'four-three':
      return 4 / 3;
    case 'sixteen-nine':
      return 16 / 9;
    case 'original':
      return originalRatio;
  }
}

function largestRectForRatio(
  sourceWidth: number,
  sourceHeight: number,
  ratio: number,
): { readonly width: number; readonly height: number } {
  const sourceRatio = sourceWidth / sourceHeight;
  return sourceRatio > ratio
    ? { width: sourceHeight * ratio, height: sourceHeight }
    : { width: sourceWidth, height: sourceWidth / ratio };
}

function assertSourceDimensions(sourceWidth: number, sourceHeight: number): void {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) {
    throw new Error('Image dimensions must be finite.');
  }
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Image dimensions must be positive.');
  }
}

/** Serialize editor state for stable equality checks in history management. */
export function serializeImageEditState(state: ImageEditState): string {
  return JSON.stringify(state);
}

/** Compare two editor states using the canonical serialized form. */
export function imageEditStatesEqual(
  left: ImageEditState,
  right: ImageEditState,
): boolean {
  return serializeImageEditState(left) === serializeImageEditState(right);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

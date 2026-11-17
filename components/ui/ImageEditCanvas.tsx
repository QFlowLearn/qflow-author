import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';

import {
  applyCropDelta,
  CROP_HANDLE_DEFINITIONS,
  CROP_RESIZE_HANDLES,
  type CropHandle,
  type CropRect,
  type ImageEditState,
} from '../../lib/client/image_edit.ts';
import {
  IMAGE_EDIT_CANVAS_BACKDROP,
  IMAGE_EDIT_CANVAS_OVERLAY,
  IMAGE_EDIT_CHECKERBOARD_DARK,
  IMAGE_EDIT_CHECKERBOARD_LIGHT,
  IMAGE_EDIT_GUIDE_SHADOW,
  IMAGE_EDIT_GUIDE_STROKE,
} from '../../lib/client/image_edit_canvas.ts';

type Props = {
  readonly image: HTMLImageElement;
  readonly state: ImageEditState;
  readonly showGuides: boolean;
  readonly disabled?: boolean;
  readonly onPreview: (state: ImageEditState) => void;
  readonly onCommit: (state: ImageEditState) => void;
  readonly onCancel: () => void;
};

type Viewport = {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
};

type Drag = {
  readonly handle: CropHandle;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly state: ImageEditState;
};

/** Render a source-image crop workspace with pointer and keyboard controls. */
export default function ImageEditCanvas(
  { image, state, showGuides, disabled = false, onPreview, onCommit, onCancel }: Props,
) {
  const i18n = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const latestRef = useRef(state);
  const [containerWidth, setContainerWidth] = useState(0);
  latestRef.current = state;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const viewport = useMemo(
    () => createViewport(containerWidth, state.sourceWidth, state.sourceHeight),
    [containerWidth, state.sourceHeight, state.sourceWidth],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewport.width <= 0) return;
    const deviceScale = globalThis.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(viewport.width * deviceScale));
    canvas.height = Math.max(1, Math.round(viewport.height * deviceScale));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);
    context.fillStyle = IMAGE_EDIT_CANVAS_BACKDROP;
    context.fillRect(0, 0, viewport.width, viewport.height);
    drawCheckerboard(
      context,
      viewport.offsetX,
      viewport.offsetY,
      state.sourceWidth * viewport.scale,
      state.sourceHeight * viewport.scale,
    );
    context.drawImage(
      image,
      viewport.offsetX,
      viewport.offsetY,
      state.sourceWidth * viewport.scale,
      state.sourceHeight * viewport.scale,
    );

    const crop = sourceToCanvas(state.crop, viewport);
    context.fillStyle = IMAGE_EDIT_CANVAS_OVERLAY;
    context.beginPath();
    context.rect(
      viewport.offsetX,
      viewport.offsetY,
      state.sourceWidth * viewport.scale,
      state.sourceHeight * viewport.scale,
    );
    context.rect(crop.x, crop.y, crop.width, crop.height);
    context.fill('evenodd');
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.strokeRect(crop.x, crop.y, crop.width, crop.height);
    if (showGuides) drawRuleOfThirds(context, crop);
  }, [image, showGuides, state.crop, state.sourceHeight, state.sourceWidth, viewport]);

  const cropBox = sourceToCanvas(state.crop, viewport);

  const startDrag = (
    handle: CropHandle,
    event: JSX.TargetedPointerEvent<HTMLButtonElement>,
  ) => {
    if (disabled || viewport.scale <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      state,
    };
  };

  const continueDrag = (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || viewport.scale <= 0) return;
    const deltaX = (event.clientX - drag.startX) / viewport.scale;
    const deltaY = (event.clientY - drag.startY) / viewport.scale;
    const next = applyCropDelta(drag.state, drag.handle, deltaX, deltaY);
    latestRef.current = next;
    onPreview(next);
  };

  const finishDrag = (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    onCommit(latestRef.current);
  };

  const cancelDrag = (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    latestRef.current = drag.state;
    onCancel();
  };

  const adjustWithKeyboard = (
    handle: CropHandle,
    event: JSX.TargetedKeyboardEvent<HTMLButtonElement>,
  ) => {
    const direction = arrowDelta(event.key, event.shiftKey ? 10 : 1);
    if (!direction) return;
    event.preventDefault();
    onCommit(applyCropDelta(state, handle, direction.x, direction.y));
  };

  return (
    <div
      ref={containerRef}
      class='relative min-h-60 w-full overflow-hidden rounded-lg bg-neutral text-neutral-content'
      style={{ height: `${viewport.height}px` }}
    >
      <canvas ref={canvasRef} aria-hidden='true' class='block' />
      {viewport.width > 0 && (
        <>
          <button
            type='button'
            class='absolute cursor-move border-0 bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
            style={cropButtonStyle(cropBox)}
            aria-label={i18n.t('editor.cropHandleMove')}
            disabled={disabled}
            onPointerDown={(event) => startDrag('move', event)}
            onPointerMove={continueDrag}
            onPointerUp={finishDrag}
            onPointerCancel={cancelDrag}
            onKeyDown={(event) => adjustWithKeyboard('move', event)}
          />
          {CROP_RESIZE_HANDLES.map((handle) => (
            <button
              key={handle}
              type='button'
              class='absolute h-5 w-5 rounded-full border-2 border-neutral bg-base-100 shadow-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
              style={handleStyle(handle, cropBox)}
              aria-label={i18n.t(`editor.cropHandle${handle.toUpperCase()}`)}
              disabled={disabled}
              onPointerDown={(event) => startDrag(handle, event)}
              onPointerMove={continueDrag}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
              onKeyDown={(event) => adjustWithKeyboard(handle, event)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function drawCheckerboard(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const tileSize = 12;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.fillStyle = IMAGE_EDIT_CHECKERBOARD_LIGHT;
  context.fillRect(x, y, width, height);
  context.fillStyle = IMAGE_EDIT_CHECKERBOARD_DARK;
  const columns = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  for (let row = 0; row < rows; row += 1) {
    for (let column = row % 2; column < columns; column += 2) {
      context.fillRect(
        x + column * tileSize,
        y + row * tileSize,
        tileSize,
        tileSize,
      );
    }
  }
  context.restore();
}

function drawRuleOfThirds(context: CanvasRenderingContext2D, crop: CropRect): void {
  const xThird = crop.width / 3;
  const yThird = crop.height / 3;
  context.save();
  context.beginPath();
  context.rect(crop.x, crop.y, crop.width, crop.height);
  context.clip();
  context.strokeStyle = IMAGE_EDIT_GUIDE_STROKE;
  context.lineWidth = 1;
  context.setLineDash([5, 4]);
  context.shadowColor = IMAGE_EDIT_GUIDE_SHADOW;
  context.shadowBlur = 2;
  context.beginPath();
  for (const offset of [1, 2]) {
    context.moveTo(crop.x + xThird * offset, crop.y);
    context.lineTo(crop.x + xThird * offset, crop.y + crop.height);
    context.moveTo(crop.x, crop.y + yThird * offset);
    context.lineTo(crop.x + crop.width, crop.y + yThird * offset);
  }
  context.stroke();
  context.restore();
}

function createViewport(
  availableWidth: number,
  sourceWidth: number,
  sourceHeight: number,
): Viewport {
  const width = Math.max(0, availableWidth);
  const height = width === 0
    ? 240
    : Math.min(480, Math.max(240, width * sourceHeight / sourceWidth));
  const scale = width === 0 ? 0 : Math.min(width / sourceWidth, height / sourceHeight);
  return {
    width,
    height,
    scale,
    offsetX: (width - sourceWidth * scale) / 2,
    offsetY: (height - sourceHeight * scale) / 2,
  };
}

function sourceToCanvas(crop: CropRect, viewport: Viewport): CropRect {
  return {
    x: viewport.offsetX + crop.x * viewport.scale,
    y: viewport.offsetY + crop.y * viewport.scale,
    width: crop.width * viewport.scale,
    height: crop.height * viewport.scale,
  };
}

function cropButtonStyle(crop: CropRect): JSX.CSSProperties {
  return {
    left: `${crop.x}px`,
    top: `${crop.y}px`,
    width: `${crop.width}px`,
    height: `${crop.height}px`,
    touchAction: 'none',
  };
}

function handleStyle(
  handle: Exclude<CropHandle, 'move'>,
  crop: CropRect,
): JSX.CSSProperties {
  const definition = CROP_HANDLE_DEFINITIONS[handle];
  const horizontal = handlePosition(crop.x, crop.width, definition.xDirection);
  const vertical = handlePosition(crop.y, crop.height, definition.yDirection);
  return {
    left: `${horizontal}px`,
    top: `${vertical}px`,
    translate: '-50% -50%',
    touchAction: 'none',
    cursor: definition.cursor,
  };
}

function handlePosition(position: number, size: number, direction: -1 | 0 | 1): number {
  if (direction === -1) return position;
  if (direction === 1) return position + size;
  return position + size / 2;
}

function arrowDelta(
  key: string,
  step: number,
): { readonly x: number; readonly y: number } | null {
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -step };
    case 'ArrowDown':
      return { x: 0, y: step };
    default:
      return null;
  }
}

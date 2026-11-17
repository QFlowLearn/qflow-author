import { type ImageEditPlan, type ImageEditState, planImageEdit } from './image_edit.ts';

/** Canvas colors for transparency previews in the image editor workspace. */
export const IMAGE_EDIT_CANVAS_BACKDROP = '#111827';
export const IMAGE_EDIT_CANVAS_OVERLAY = 'rgba(17, 24, 39, 0.58)';
export const IMAGE_EDIT_CHECKERBOARD_LIGHT = '#f8fafc';
export const IMAGE_EDIT_CHECKERBOARD_DARK = '#cbd5e1';
export const IMAGE_EDIT_GUIDE_STROKE = 'rgba(255, 255, 255, 0.9)';
export const IMAGE_EDIT_GUIDE_SHADOW = 'rgba(15, 23, 42, 0.9)';

/** Load a browser image from a URL while honoring the caller's cancellation lifetime. */
export async function loadEditableImage(
  src: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<HTMLImageElement> {
  options.signal?.throwIfAborted();
  if (isInlineImageSource(src)) return await decodeImage(src, options.signal);

  let response: Response;
  try {
    response = await fetch(src, { signal: options.signal });
  } catch (cause: unknown) {
    if (options.signal?.aborted) options.signal.throwIfAborted();
    throw new Error(
      'QFlowLearn could not load this image. Check that the image is still available and try again.',
      { cause },
    );
  }
  if (!response.ok) throw new Error('QFlowLearn could not load this image for editing.');
  const sourceBlob = await response.blob();
  options.signal?.throwIfAborted();
  const sourceUrl = URL.createObjectURL(sourceBlob);
  try {
    return await decodeImage(sourceUrl, options.signal);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function isInlineImageSource(src: string): boolean {
  return src.startsWith('data:') || src.startsWith('blob:');
}

/** Draw an image-edit plan to a canvas, optionally scaled down for preview. */
export function drawImageEdit(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  plan: ImageEditPlan,
  options: { readonly maxDimension?: number } = {},
): void {
  const maxDimension = options.maxDimension ?? Number.POSITIVE_INFINITY;
  const previewScale = Math.min(
    1,
    maxDimension / Math.max(plan.outputWidth, plan.outputHeight),
  );
  canvas.width = Math.max(1, Math.round(plan.outputWidth * previewScale));
  canvas.height = Math.max(1, Math.round(plan.outputHeight * previewScale));

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image editing is not available in this browser.');
  const swapsDimensions = plan.transform.quarterTurn === 90 ||
    plan.transform.quarterTurn === 270;
  const baseWidth = swapsDimensions ? plan.crop.height : plan.crop.width;
  const baseHeight = swapsDimensions ? plan.crop.width : plan.crop.height;
  context.setTransform(previewScale, 0, 0, previewScale, 0, 0);
  context.clearRect(0, 0, plan.outputWidth, plan.outputHeight);
  context.translate(plan.outputWidth / 2, plan.outputHeight / 2);
  context.scale(plan.outputWidth / baseWidth, plan.outputHeight / baseHeight);
  context.rotate(
    (plan.transform.quarterTurn + plan.transform.straighten) * Math.PI / 180,
  );
  const straightenScale = rotatedCoverScale(
    baseWidth,
    baseHeight,
    plan.transform.straighten,
  );
  context.scale(straightenScale, straightenScale);
  context.scale(
    plan.transform.flipHorizontal ? -1 : 1,
    plan.transform.flipVertical ? -1 : 1,
  );
  context.translate(
    -(plan.crop.x + plan.crop.width / 2),
    -(plan.crop.y + plan.crop.height / 2),
  );
  context.drawImage(image, 0, 0);
}

/** Export a loaded image with one edit state as a PNG suitable for upload. */
export async function exportEditedImage(
  image: HTMLImageElement,
  state: ImageEditState,
): Promise<File> {
  const canvas = document.createElement('canvas');
  drawImageEdit(canvas, image, planImageEdit(state));
  const editedBlob = await canvasBlob(canvas);
  return new File([editedBlob], 'edited-image.png', { type: 'image/png' });
}

function decodeImage(src: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const abort = () => {
      image.src = '';
      reject(signal?.reason ?? new DOMException('Image loading was cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    image.onload = () => {
      signal?.removeEventListener('abort', abort);
      resolve(image);
    };
    image.onerror = () => {
      signal?.removeEventListener('abort', abort);
      reject(new Error('QFlowLearn could not decode this image.'));
    };
    image.src = src;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('QFlowLearn could not create the edited image.'));
    }, 'image/png');
  });
}

function rotatedCoverScale(width: number, height: number, angleDegrees: number): number {
  const angle = Math.abs(angleDegrees) * Math.PI / 180;
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  return Math.max(
    (width * cosine + height * sine) / width,
    (width * sine + height * cosine) / height,
  );
}

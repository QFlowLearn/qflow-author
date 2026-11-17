import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import { hasImageMimeType, resolveImageMimeType } from './image_asset.ts';
import {
  type Qti3DrawingAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
} from './qti3_writer_adapter.ts';

export type DrawingDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  responseIdentifier?: string;
  drawingClassName?: string;
  drawingImageSrc?: string;
  drawingImageAlt?: string;
  drawingImageLongDesc?: string;
  drawingImageType?: string;
  drawingImageWidth?: number;
  drawingImageHeight?: number;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

export function defaultsDrawing(): DrawingDraft {
  return {
    title: 'Drawing',
    promptHtml: '<p>Annotate the image below.</p>',
    bodyHtml: '<p>Provide instructions for the drawing interaction.</p>',
    responseIdentifier: 'RESPONSE',
    drawingClassName: '',
    drawingImageSrc: 'image.png',
    drawingImageAlt: 'Drawing canvas',
    drawingImageLongDesc: '',
  };
}

export function validateDrawing(draft: DrawingDraft): string[] {
  const errs: string[] = [];
  if (!draft.title?.trim()) errs.push('Title is required.');
  const bodyText = (draft.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');

  const responseId = (draft.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }

  const src = (draft.drawingImageSrc ?? '').trim();
  if (!src) errs.push('Drawing image src is required.');
  if (!(draft.drawingImageAlt ?? '').trim()) errs.push('Drawing image alt text is required.');
  const imageType = (draft.drawingImageType ?? '').trim();
  if (!hasImageMimeType({ source: src, mimeType: imageType })) {
    errs.push('Drawing image type is required when it cannot be inferred from the image src.');
  }

  const width = draft.drawingImageWidth;
  if (width != null && (!Number.isFinite(width) || Number(width) <= 0)) {
    errs.push('Drawing image width must be a positive number.');
  }
  const height = draft.drawingImageHeight;
  if (height != null && (!Number.isFinite(height) || Number(height) <= 0)) {
    errs.push('Drawing image height must be a positive number.');
  }

  return errs;
}

export function toQti3DrawingAuthoringItem(
  draft: DrawingDraft,
  opts: BuildOptions,
): Qti3DrawingAuthoringItem {
  const className = (draft.drawingClassName ?? '').trim();
  return {
    interactionType: 'drawing',
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    object: {
      data: (draft.drawingImageSrc ?? '').trim(),
      alt: (draft.drawingImageAlt ?? '').trim(),
      type: resolveImageMimeType({
        source: draft.drawingImageSrc ?? '',
        mimeType: draft.drawingImageType,
      }),
      width: draft.drawingImageWidth,
      height: draft.drawingImageHeight,
      longDescription: (draft.drawingImageLongDesc ?? '').trim() || undefined,
    },
    classNames: className ? [className] : [],
  };
}

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';

import { type ImageEditState, planImageEdit } from '../../lib/client/image_edit.ts';
import {
  drawImageEdit,
  IMAGE_EDIT_CANVAS_BACKDROP,
  IMAGE_EDIT_CHECKERBOARD_DARK,
  IMAGE_EDIT_CHECKERBOARD_LIGHT,
} from '../../lib/client/image_edit_canvas.ts';
import ImageQuestionCompositionPreview, {
  type ImageCompositionContext,
} from './ImageQuestionCompositionPreview.tsx';
import SegmentedControl from './SegmentedControl.tsx';
import Select from './Select.tsx';

type Props = {
  readonly image: HTMLImageElement;
  readonly state: ImageEditState;
  readonly composition?: ImageCompositionContext;
  readonly disabled: boolean;
};

type PreviewBackground = 'checkerboard' | 'white' | 'dark' | 'question';
type PreviewMode = 'image' | 'question';

/** Render an edited image alone or within its current question composition. */
export default function ImageEditResultPreview(
  { image, state, composition, disabled }: Props,
) {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [requestedMode, setRequestedMode] = useState<PreviewMode>(
    composition ? 'question' : 'image',
  );
  const [background, setBackground] = useState<PreviewBackground>('checkerboard');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const mode = composition ? requestedMode : 'image';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      drawImageEdit(canvas, image, planImageEdit(state), { maxDimension: 520 });
      setPreviewError(null);
    } catch (_cause: unknown) {
      setPreviewError(
        i18n.t('editor.imageEditPreviewFailed'),
      );
    }
  }, [i18n, image, mode, state]);

  return (
    <figure class='space-y-2'>
      <figcaption class='text-sm font-semibold'>{i18n.t('editor.resultPreview')}</figcaption>
      {composition && (
        <SegmentedControl
          value={mode}
          options={[
            { value: 'image', label: i18n.t('editor.imageOnly') },
            { value: 'question', label: i18n.t('editor.inQuestion') },
          ]}
          onChange={(value) => setRequestedMode(parsePreviewMode(value))}
          ariaLabel={i18n.t('editor.previewMode')}
          class='w-full'
        />
      )}

      {mode === 'image' && (
        <label class='ds-form-control'>
          <span class='text-xs'>{i18n.t('editor.previewBackground')}</span>
          <Select
            size='xs'
            value={background}
            disabled={disabled}
            onInput={(event) => setBackground(parsePreviewBackground(event.currentTarget.value))}
          >
            <option value='checkerboard'>{i18n.t('editor.transparencyGrid')}</option>
            <option value='white'>{i18n.t('editor.white')}</option>
            <option value='dark'>{i18n.t('editor.dark')}</option>
            <option value='question'>{i18n.t('editor.questionBackground')}</option>
          </Select>
        </label>
      )}

      {mode === 'question' && composition
        ? (
          <ImageQuestionCompositionPreview
            composition={composition}
          >
            <canvas
              ref={canvasRef}
              class='max-h-96 max-w-full object-contain'
              role='img'
              aria-label={composition.accessibleDescription.trim() ||
                i18n.t('editor.noAccessibleDescription')}
            />
          </ImageQuestionCompositionPreview>
        )
        : (
          <div
            class='flex min-h-48 items-center justify-center overflow-hidden rounded-lg p-2'
            style={previewBackgroundStyle(background)}
            data-image-preview-background={background}
          >
            <canvas
              ref={canvasRef}
              class='max-h-96 max-w-full object-contain'
              role='img'
              aria-label={i18n.t('editor.imagePreview')}
            />
          </div>
        )}

      <p class='text-xs text-base-content/70'>
        {mode === 'question'
          ? i18n.t('editor.compositionPreview')
          : i18n.t('editor.previewBackgroundHelp')}
      </p>
      <p aria-live='polite' class={previewError ? 'text-sm text-error' : 'sr-only'}>
        {previewError ?? ''}
      </p>
    </figure>
  );
}

function parsePreviewBackground(value: string): PreviewBackground {
  switch (value) {
    case 'checkerboard':
    case 'white':
    case 'dark':
    case 'question':
      return value;
    default:
      throw new Error(`Unsupported image preview background: ${value}`);
  }
}

function parsePreviewMode(value: string): PreviewMode {
  switch (value) {
    case 'image':
    case 'question':
      return value;
    default:
      throw new Error(`Unsupported image preview mode: ${value}`);
  }
}

function previewBackgroundStyle(background: PreviewBackground): JSX.CSSProperties {
  switch (background) {
    case 'checkerboard':
      return {
        backgroundColor: IMAGE_EDIT_CHECKERBOARD_LIGHT,
        backgroundImage:
          `linear-gradient(45deg, ${IMAGE_EDIT_CHECKERBOARD_DARK} 25%, transparent 25%), linear-gradient(-45deg, ${IMAGE_EDIT_CHECKERBOARD_DARK} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${IMAGE_EDIT_CHECKERBOARD_DARK} 75%), linear-gradient(-45deg, transparent 75%, ${IMAGE_EDIT_CHECKERBOARD_DARK} 75%)`,
        backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
        backgroundSize: '12px 12px',
      };
    case 'white':
      return { backgroundColor: '#ffffff' };
    case 'dark':
      return { backgroundColor: IMAGE_EDIT_CANVAS_BACKDROP };
    case 'question':
      return {
        backgroundColor: 'var(--fallback-b1, oklch(var(--b1) / 1))',
      };
  }
}

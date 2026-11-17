import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';

import {
  centerCrop,
  createInitialImageEditState,
  cropZoom,
  type ImageEditState,
} from '../../lib/client/image_edit.ts';
import { exportEditedImage, loadEditableImage } from '../../lib/client/image_edit_canvas.ts';
import { UPLOAD_POLICIES } from '../../lib/upload_policy.ts';
import { type AssetSelectionResult, assetUploadErrorMessage } from './AssetUpload.tsx';
import Button from './Button.tsx';
import ImageEditCanvas from './ImageEditCanvas.tsx';
import ImageEditControls from './ImageEditControls.tsx';
import ImageEditResultPreview from './ImageEditResultPreview.tsx';
import type { ImageCompositionContext } from './ImageQuestionCompositionPreview.tsx';
import { useImageEditHistory } from './useImageEditHistory.ts';

type Props = {
  readonly src: string;
  readonly composition?: ImageCompositionContext;
  readonly disabled?: boolean;
  readonly onApply: (file: File) => Promise<AssetSelectionResult>;
};

/** Load an image and expose its nondestructive, inline editing workflow. */
export default function ImageEditor({ src, composition, disabled = false, onApply }: Props) {
  const i18n = useI18n();
  const [editing, setEditing] = useState(false);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    void loadEditableImage(src, { signal: controller.signal })
      .then((loaded) => setImage(loaded))
      .catch((_cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(
          i18n.t('editor.imageEditLoadFailed'),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [editing, i18n, src]);

  return (
    <div class='space-y-3'>
      {!editing && (
        <img
          src={src}
          alt=''
          class='max-h-80 max-w-full rounded-lg bg-base-200 object-contain'
        />
      )}

      <Button
        size='xs'
        type='button'
        disabled={disabled}
        onClick={() => {
          setLoadError(null);
          setImage(null);
          setEditing((current) => !current);
        }}
      >
        {editing ? i18n.t('editor.imageEditClose') : i18n.t('editor.imageEdit')}
      </Button>

      {editing && loading && (
        <p class='text-sm text-base-content/70' role='status'>
          {i18n.t('editor.imageEditLoading')}
        </p>
      )}
      {editing && image && (
        <LoadedImageEditor
          key={`${src}:${image.naturalWidth}x${image.naturalHeight}`}
          image={image}
          composition={composition}
          disabled={disabled}
          onApply={onApply}
          onClose={() => setEditing(false)}
        />
      )}
      <p aria-live='polite' class={loadError ? 'text-sm text-error' : 'sr-only'}>
        {loadError ?? ''}
      </p>
    </div>
  );
}

function LoadedImageEditor(
  {
    image,
    composition,
    disabled,
    onApply,
    onClose,
  }: {
    readonly image: HTMLImageElement;
    readonly composition: Props['composition'];
    readonly disabled: boolean;
    readonly onApply: (file: File) => Promise<AssetSelectionResult>;
    readonly onClose: () => void;
  },
) {
  const i18n = useI18n();
  const initial = useMemo(
    () => createInitialImageEditState(image.naturalWidth, image.naturalHeight),
    [image],
  );
  const history = useImageEditHistory(initial);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [showGuides, setShowGuides] = useState(false);

  const commit = useCallback((state: ImageEditState, message = i18n.t('editor.cropUpdated')) => {
    history.commit(state);
    setAnnouncement(message);
  }, [history, i18n]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      if (isTextEntry(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) {
        history.redo();
        setAnnouncement(i18n.t('editor.imageEditRestored'));
      } else {
        history.undo();
        setAnnouncement(i18n.t('editor.imageEditUndone'));
      }
    };
    globalThis.addEventListener('keydown', handleShortcut);
    return () => globalThis.removeEventListener('keydown', handleShortcut);
  }, [history]);

  const apply = useCallback(async () => {
    setApplying(true);
    setApplyError(null);
    try {
      const file = await exportEditedImage(image, history.state);
      if (file.size > UPLOAD_POLICIES.image.maxBytes) {
        setApplyError(
          i18n.t('editor.imageEditTooLarge', { max: UPLOAD_POLICIES.image.maxMebibytes }),
        );
        return;
      }
      const result = await onApply(file);
      if (result._tag === 'error') {
        setApplyError(assetUploadErrorMessage(i18n, result.error));
        return;
      }
      onClose();
    } catch (_cause: unknown) {
      setApplyError(i18n.t('editor.imageEditApplyFailed'));
    } finally {
      setApplying(false);
    }
  }, [history.state, i18n, image, onApply, onClose]);

  return (
    <section
      class='space-y-4 border-t border-base-200 pt-4'
      aria-label={i18n.t('editor.imageEditRegion')}
    >
      <div class='grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(15rem,0.42fr)]'>
        <div class='space-y-2'>
          <div>
            <h3 class='text-sm font-semibold'>{i18n.t('editor.cropHeading')}</h3>
            <p class='text-xs text-base-content/70'>{i18n.t('editor.cropHelp')}</p>
          </div>
          <div class='flex flex-wrap items-center justify-between gap-2'>
            <output class='text-xs font-medium text-base-content/80'>
              {i18n.t('editor.cropSummary', {
                width: Math.round(history.state.crop.width),
                height: Math.round(history.state.crop.height),
                zoom: cropZoom(history.state),
              })}
            </output>
            <div
              class='flex flex-wrap gap-2'
              role='group'
              aria-label={i18n.t('editor.cropControls')}
            >
              <Button
                size='xs'
                type='button'
                disabled={disabled || applying}
                onClick={() => commit(centerCrop(history.state), i18n.t('editor.cropCentered'))}
              >
                {i18n.t('editor.centerCrop')}
              </Button>
              <Button
                size='xs'
                type='button'
                aria-pressed={showGuides}
                disabled={disabled || applying}
                onClick={() => setShowGuides((current) => !current)}
              >
                {i18n.t('editor.ruleOfThirds')}
              </Button>
            </div>
          </div>
          <ImageEditCanvas
            image={image}
            state={history.state}
            showGuides={showGuides}
            disabled={disabled || applying}
            onPreview={history.preview}
            onCommit={commit}
            onCancel={history.cancelPreview}
          />
        </div>
        <ImageEditResultPreview
          image={image}
          state={history.state}
          composition={composition}
          disabled={disabled || applying}
        />
      </div>

      <ImageEditControls
        state={history.state}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        disabled={disabled || applying}
        onPreview={history.preview}
        onCommit={commit}
        onUndo={() => {
          history.undo();
          setAnnouncement(i18n.t('editor.imageEditUndone'));
        }}
        onRedo={() => {
          history.redo();
          setAnnouncement(i18n.t('editor.imageEditRestored'));
        }}
        onReset={() => {
          history.reset();
          setAnnouncement(i18n.t('editor.imageReset'));
        }}
      />

      <div class='flex flex-wrap items-center gap-2 border-t border-base-200 pt-4'>
        <Button
          size='sm'
          type='button'
          variant='primary'
          disabled={disabled || applying}
          aria-busy={applying}
          onClick={() => void apply()}
        >
          {applying ? i18n.t('editor.applyingEdits') : i18n.t('editor.applyEdits')}
        </Button>
        <p class='text-xs text-base-content/70'>
          {i18n.t('editor.applyHelp')}
        </p>
      </div>

      <p aria-live='polite' class={applyError ? 'text-sm text-error' : 'sr-only'}>
        {applyError ?? announcement}
      </p>
    </section>
  );
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
}

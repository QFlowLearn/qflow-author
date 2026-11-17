import { useCallback } from 'preact/hooks';

import { safeMediaUrl } from '../../lib/client/safe_media_url.ts';
import { uploadFile } from '../../lib/client/upload_file.ts';
import type { MediaKind, MediaSource } from '../../lib/types/media.ts';
import {
  classifyUploadHint,
  MAX_UPLOAD_MEBIBYTES,
  uploadAcceptForMediaKind,
  validateUploadHintStructured,
} from '../../lib/upload_policy.ts';
import AssetUpload, { type AssetSelectionResult } from './AssetUpload.tsx';
import Button from './Button.tsx';
import ImageEditor from './ImageEditor.tsx';
import type { ImageCompositionContext } from './ImageQuestionCompositionPreview.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';

type Props = {
  readonly kind: MediaKind;
  readonly source?: MediaSource;
  readonly imageComposition?: ImageCompositionContext;
  readonly disabled?: boolean;
  readonly onChange: (source: MediaSource) => void;
  readonly onClear: () => void;
};

/** Upload, preview, replace, and edit the primary source for a QTI media interaction. */
export default function MediaFileUpload(
  { kind, source, imageComposition, disabled = false, onChange, onClear }: Props,
) {
  const i18n = useI18n();
  const sourceUrl = source?.src.trim() ?? '';
  const sourceType = source?.type?.trim() ?? '';
  const previewUrl = safeMediaUrl(sourceUrl);
  const sourceKind = classifyUploadHint(sourceUrl, sourceType);
  const typeLabel = kind === 'audio'
    ? i18n.t('editor.mediaKindAudio')
    : kind === 'video'
    ? i18n.t('editor.mediaKindVideo')
    : i18n.t('editor.mediaKindImagePdf');

  const upload = useCallback(async (file: File): Promise<AssetSelectionResult> => {
    const validationError = validateUploadHintStructured(file, kind);
    if (validationError) return { _tag: 'error', error: validationError };

    try {
      const uploaded = await uploadFile(file);
      onChange({ src: uploaded.url, type: uploaded.type });
      return { _tag: 'ok' };
    } catch (_cause: unknown) {
      return {
        _tag: 'error',
        error: { code: 'processing-failed' },
      };
    }
  }, [kind, onChange]);

  return (
    <div class='space-y-3'>
      <AssetUpload
        accept={uploadAcceptForMediaKind(kind)}
        buttonLabel={sourceUrl
          ? i18n.t('editor.mediaReplace', { kind: typeLabel })
          : i18n.t('editor.mediaUpload', { kind: typeLabel })}
        busyLabel={i18n.t('editor.uploading')}
        helperText={`${i18n.t('editor.mediaUploadHelper', { kind: typeLabel })} ${
          kind === 'object'
            ? i18n.t('editor.mediaLimit')
            : i18n.t('editor.mediaLimitSingle', { max: MAX_UPLOAD_MEBIBYTES })
        }`}
        disabled={disabled}
        onSelected={upload}
      />

      {sourceUrl && previewUrl && (
        <div class='space-y-3 rounded-lg border border-base-300 bg-base-100 p-4'>
          {sourceKind === 'image'
            ? (
              <ImageEditor
                src={previewUrl}
                composition={imageComposition}
                disabled={disabled}
                onApply={upload}
              />
            )
            : (
              <MediaPreview
                kind={kind}
                src={previewUrl}
                type={sourceType}
                noPreview={i18n.t('editor.mediaNoPreview')}
              />
            )}
          <div class='flex flex-wrap gap-2'>
            <Button
              size='xs'
              type='button'
              href={previewUrl}
              target='_blank'
              rel='noopener noreferrer'
            >
              {i18n.t('editor.mediaOpenFile')}
            </Button>
            <Button
              size='xs'
              type='button'
              variant='danger-ghost'
              disabled={disabled}
              onClick={onClear}
            >
              {i18n.t('editor.mediaRemoveFile')}
            </Button>
          </div>
        </div>
      )}

      {sourceUrl && !previewUrl && (
        <p class='text-sm text-warning'>
          {i18n.t('editor.mediaBlockedSource')}
        </p>
      )}
    </div>
  );
}

function MediaPreview(
  props: {
    readonly kind: MediaKind;
    readonly src: string;
    readonly type: string;
    readonly noPreview: string;
  },
) {
  if (props.kind === 'video') {
    return (
      <video class='max-h-80 w-full rounded-lg bg-black' controls>
        <source src={props.src} type={props.type || undefined} />
      </video>
    );
  }
  if (props.kind === 'audio') {
    return (
      <audio class='w-full' controls>
        <source src={props.src} type={props.type || undefined} />
      </audio>
    );
  }
  return (
    <p class='text-sm text-base-content/70'>
      {props.noPreview}
    </p>
  );
}

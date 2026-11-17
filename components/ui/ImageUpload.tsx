import { useCallback } from 'preact/hooks';
import AssetUpload, { type AssetSelectionResult } from './AssetUpload.tsx';
import Button from './Button.tsx';
import Input from './Input.tsx';
import { uploadFile } from '../../lib/client/upload_file.ts';
import { safeMediaUrl } from '../../lib/client/safe_media_url.ts';
import { type UploadHintError, validateUploadHintStructured } from '../../lib/upload_policy.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

export type ImageUploadMetadata = {
  mimeType?: string;
  width?: number;
  height?: number;
};

type Props = {
  label: string;
  value: string;
  alt?: string;
  disabled?: boolean;
  compact?: boolean;
  class?: string;
  onChange: (src: string) => void;
  onMetadata?: (metadata: ImageUploadMetadata) => void;
};

async function readImageDimensions(
  file: File,
): Promise<Pick<ImageUploadMetadata, 'width' | 'height'>> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{ width?: number; height?: number }>((resolve) => {
      const img = new Image();
      img.onload = () =>
        resolve({ width: img.naturalWidth || undefined, height: img.naturalHeight || undefined });
      img.onerror = () => resolve({});
      img.src = objectUrl;
    });
    return dimensions;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function validateImageFile(file: File): UploadHintError | null {
  return validateUploadHintStructured(file, 'image');
}

export default function ImageUpload(
  { label, value, alt, disabled = false, compact = false, class: cls, onChange, onMetadata }: Props,
) {
  const i18n = useI18n();
  const previewUrl = safeMediaUrl(value);
  const hasUnsafeUrl = value.trim().length > 0 && !previewUrl;
  const isEmbeddedImage = value.trim().startsWith('data:image/');
  const missingAltText = value.trim().length > 0 && !hasUnsafeUrl &&
    (alt ?? '').trim().length === 0;

  const handleUpload = useCallback(async (file: File): Promise<AssetSelectionResult> => {
    const validationError = validateImageFile(file);
    if (validationError) {
      return { _tag: 'error', error: validationError };
    }
    try {
      const [uploaded, dimensions] = await Promise.all([
        uploadFile(file),
        readImageDimensions(file),
      ]);
      onChange(uploaded.url);
      onMetadata?.({
        mimeType: file.type || uploaded.type || undefined,
        width: dimensions.width,
        height: dimensions.height,
      });
      return { _tag: 'ok' };
    } catch (_cause: unknown) {
      return {
        _tag: 'error',
        error: { code: 'processing-failed' },
      };
    }
  }, [onChange, onMetadata]);

  return (
    <div class={['flex flex-col space-y-2', cls || ''].filter(Boolean).join(' ')}>
      <span>{label}</span>
      <AssetUpload
        accept='image/*'
        buttonLabel={value ? i18n.t('editor.replaceImage') : i18n.t('editor.uploadImage')}
        busyLabel={i18n.t('editor.uploading')}
        helperText={i18n.t('editor.uploadHelper')}
        buttonSize={compact ? 'xs' : 'sm'}
        disabled={disabled}
        onSelected={handleUpload}
      />
      {value && (
        <div class='grid gap-3 rounded-lg border border-base-300 bg-base-100 p-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start'>
          {previewUrl
            ? (
              <img
                src={previewUrl}
                alt={alt ?? ''}
                class={compact
                  ? 'h-20 w-auto max-w-full rounded-sm border border-base-200 object-contain'
                  : 'h-28 w-auto max-w-full rounded-sm border border-base-200 object-contain'}
              />
            )
            : null}
          <div class='min-w-0 space-y-2'>
            {isEmbeddedImage
              ? (
                <div>
                  <span class='block text-xs text-base-content/60'>
                    {i18n.t('editor.imageSource')}
                  </span>
                  <span class='text-sm text-base-content/80'>{i18n.t('editor.embeddedImage')}</span>
                </div>
              )
              : (
                <label class='flex flex-col'>
                  <span class='text-xs'>{i18n.t('editor.currentUrl')}</span>
                  <Input size='sm' value={value} readOnly />
                </label>
              )}
            <div class='flex flex-wrap items-center gap-1'>
              {previewUrl && (
                <Button
                  size='xs'
                  type='button'
                  href={previewUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  {i18n.t('editor.openImage')}
                </Button>
              )}
              <Button
                size='xs'
                type='button'
                variant='danger-ghost'
                disabled={disabled}
                onClick={() => {
                  onChange('');
                  onMetadata?.({ mimeType: undefined, width: undefined, height: undefined });
                }}
              >
                {i18n.t('editor.clearImage')}
              </Button>
            </div>
          </div>
        </div>
      )}
      {missingAltText && (
        <p class='text-xs text-warning'>
          {i18n.t('editor.altGuidance')}
        </p>
      )}
      {hasUnsafeUrl && (
        <p class='text-xs text-error' role='alert'>{i18n.t('editor.imageBlockedRecovery')}</p>
      )}
    </div>
  );
}

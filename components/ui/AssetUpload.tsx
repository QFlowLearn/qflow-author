import type { JSX } from 'preact';
import { useCallback, useRef, useState } from 'preact/hooks';

import Button from './Button.tsx';
import Input from './Input.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { UploadHintError } from '../../lib/upload_policy.ts';

/** Expected result of selecting and processing one authoring asset. */
export type AssetSelectionResult =
  | { readonly _tag: 'ok' }
  | {
    readonly _tag: 'error';
    readonly error: UploadHintError | { readonly code: 'processing-failed' };
  };

export function assetUploadErrorMessage(
  i18n: {
    t: (id: string, values?: Readonly<Record<string, string | number | boolean | Date>>) => string;
  },
  error: unknown,
): string {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return i18n.t('editor.uploadFailed');
  }
  const value = error as Record<string, unknown>;
  if (value.code === 'processing-failed' && Object.keys(value).length === 1) {
    return i18n.t('editor.uploadFailed');
  }
  if (value.code === 'empty' && Object.keys(value).length === 1) {
    return i18n.t('editor.uploadEmpty');
  }
  if (value.code === 'wrong-kind' && typeof value.expected === 'string') {
    const kind = value.expected === 'object'
      ? i18n.t('editor.mediaKindImagePdf')
      : value.expected === 'image'
      ? i18n.t('editor.mediaKindImage')
      : value.expected === 'pdf'
      ? i18n.t('editor.mediaKindPdf')
      : value.expected === 'audio'
      ? i18n.t('editor.mediaKindAudio')
      : value.expected === 'video'
      ? i18n.t('editor.mediaKindVideo')
      : value.expected === 'captions'
      ? i18n.t('editor.mediaKindCaptions')
      : null;
    if (!kind) return i18n.t('editor.uploadFailed');
    return i18n.t('editor.uploadWrongKind', { kind });
  }
  if (
    value.code === 'too-large' && typeof value.kind === 'string' &&
    typeof value.maxMebibytes === 'number' && Number.isFinite(value.maxMebibytes) &&
    value.maxMebibytes > 0
  ) {
    const kind = value.kind === 'image'
      ? i18n.t('editor.mediaKindImage')
      : value.kind === 'pdf'
      ? i18n.t('editor.mediaKindPdf')
      : value.kind === 'audio'
      ? i18n.t('editor.mediaKindAudio')
      : value.kind === 'video'
      ? i18n.t('editor.mediaKindVideo')
      : value.kind === 'captions'
      ? i18n.t('editor.mediaKindCaptions')
      : null;
    return kind
      ? i18n.t('editor.uploadTooLarge', { kind, max: value.maxMebibytes })
      : i18n.t('editor.uploadFailed');
  }
  return i18n.t('editor.uploadFailed');
}

type Props = {
  readonly accept: string;
  readonly buttonLabel: string;
  readonly busyLabel: string;
  readonly helperText: string;
  readonly buttonSize?: 'xs' | 'sm' | 'md';
  readonly disabled?: boolean;
  readonly onSelected: (file: File) => Promise<AssetSelectionResult>;
};

/** Accessible file picker and drag target shared by authoring upload controls. */
export default function AssetUpload(
  {
    accept,
    buttonLabel,
    busyLabel,
    helperText,
    buttonSize = 'sm',
    disabled = false,
    onSelected,
  }: Props,
) {
  const i18n = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectFiles = useCallback(async (files: FileList | null, _source: 'select' | 'drop') => {
    if (!files?.length) return;
    if (files.length !== 1) {
      setError(i18n.t('editor.uploadOneFile'));
      setDragActive(false);
      return;
    }

    const file = files.item(0);
    if (!file) return;

    setError(null);
    setBusy(true);
    try {
      const result = await onSelected(file);
      if (result._tag === 'error') {
        setError(assetUploadErrorMessage(i18n, result.error));
      }
    } catch (_cause: unknown) {
      setError(i18n.t('editor.uploadFailed'));
    } finally {
      setBusy(false);
      setDragActive(false);
    }
  }, [i18n, onSelected]);

  const onDrop = useCallback((event: JSX.TargetedDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || busy) return;
    void selectFiles(event.dataTransfer?.files ?? null, 'drop');
  }, [busy, disabled, selectFiles]);

  return (
    <div class='space-y-2'>
      <div
        class={[
          'rounded-lg border border-dashed p-4 transition-colors',
          dragActive ? 'border-primary bg-primary/5' : 'border-base-300 bg-base-100',
        ].join(' ')}
        onDrop={onDrop}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled && !busy) setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
      >
        <Input
          ref={inputRef}
          type='file'
          accept={accept}
          class='hidden'
          disabled={disabled || busy}
          aria-label={buttonLabel}
          onChange={(event) => {
            const input = event.currentTarget;
            void selectFiles(input.files, 'select');
            input.value = '';
          }}
        />
        <div class='flex flex-wrap items-center gap-3'>
          <Button
            size={buttonSize}
            type='button'
            disabled={disabled || busy}
            aria-busy={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? busyLabel : buttonLabel}
          </Button>
          <p class='text-sm text-base-content/70'>{helperText}</p>
        </div>
      </div>
      <p
        role={error ? 'alert' : undefined}
        aria-live='polite'
        class={error ? 'text-sm text-error' : 'sr-only'}
      >
        {error ?? ''}
      </p>
    </div>
  );
}

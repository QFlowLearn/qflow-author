import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Checkbox from '../../components/ui/Checkbox.tsx';
import Input from '../../components/ui/Input.tsx';
import Textarea from '../../components/ui/Textarea.tsx';
import { ImageIcon } from '../../components/icons/RichTextIcons.tsx';
import type { Editor } from '@prosekit/core';
import { uploadFile } from '../../lib/client/upload_file.ts';
import type { RichTextExtension } from './editor_types.ts';
import { sliceFromHtml } from './slice_from_html.ts';
import { ToolbarButton } from './toolbar.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import EditorToolPanel from '../../components/ui/EditorToolPanel.tsx';

type ImagePopoverProps = {
  editor: Editor<RichTextExtension>;
  disabled: boolean;
  contentScope: 'inline' | 'body';
  sanitize: (html: string) => string;
};

export function ImageInsertPopover(
  { editor, disabled, contentScope, sanitize }: ImagePopoverProps,
) {
  const i18n = useI18n();
  const instanceId = useDomId();
  const popoverId = `rte-image-popover-${instanceId}`;
  const titleId = `rte-image-title-${instanceId}`;
  const urlId = `rte-image-url-${instanceId}`;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [longDescription, setLongDescription] = useState('');
  const [decorative, setDecorative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const resetState = useCallback(() => {
    setUrl('');
    setFile(null);
    setAlt('');
    setLongDescription('');
    setDecorative(false);
    setBusy(false);
    setError(null);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    resetState();
  }, [resetState]);

  useLayoutEffect(() => {
    if (!open) return;
    containerRef.current?.querySelector<HTMLInputElement>('input[type="url"]')?.focus();
    function handleClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [close, open]);

  const handleFileChange = useCallback((event: Event) => {
    const node = event.target as HTMLInputElement;
    const selected = node.files?.[0] ?? null;
    setFile(selected);
    if (selected) {
      setUrl('');
      setError(null);
    }
  }, []);

  const insertImageMarkup = useCallback(
    (src: string, altText: string, descText: string, isDecorative: boolean) => {
      const safeAlt = isDecorative ? '' : altText.trim();
      const safeDesc = isDecorative ? '' : descText.trim();
      const descId = safeDesc ? `qti-longdesc-${crypto.randomUUID()}` : '';
      const descTag = contentScope === 'inline' ? 'span' : 'div';
      const descBlock = safeDesc
        ? `<${descTag} id="${descId}" class="qti-visually-hidden" data-qti-a11y-content-role="long-description">${safeDesc}</${descTag}>`
        : '';
      const ariaDesc = descId ? ` aria-describedby="${descId}"` : '';
      const markup = `<img src="${src}" alt="${safeAlt}"${ariaDesc}/>${
        descBlock ? ` ${descBlock}` : ''
      }`;
      const clean = sanitize(markup);
      const slice = sliceFromHtml(clean, editor.schema, contentScope === 'inline');
      if (!slice) return;
      const view = editor.view;
      if (!view) return;
      const tr = view.state.tr.replaceSelection(slice).scrollIntoView();
      view.dispatch(tr);
    },
    [contentScope, editor, sanitize],
  );

  const handleSubmit = useCallback(async () => {
    if (busy) return;
    setError(null);
    const trimmedAlt = alt.trim();
    if (!decorative && !trimmedAlt) {
      setError(i18n.t('editor.imageAltRequired'));
      return;
    }
    const trimmedUrl = url.trim();
    if (trimmedUrl) {
      insertImageMarkup(trimmedUrl, trimmedAlt, longDescription, decorative);
      close();
      return;
    }
    if (file) {
      setBusy(true);
      try {
        const uploaded = await uploadFile(file);
        insertImageMarkup(uploaded.url, trimmedAlt, longDescription, decorative);
        close();
      } catch {
        setError(i18n.t('editor.imageUploadFailed'));
      } finally {
        setBusy(false);
      }
    }
  }, [
    alt,
    busy,
    close,
    decorative,
    file,
    insertImageMarkup,
    longDescription,
    url,
    i18n,
  ]);

  const canSubmit = (url.trim().length > 0 || Boolean(file)) && !busy;

  return (
    <div class='relative' ref={containerRef}>
      <ToolbarButton
        label={<ImageIcon />}
        tooltip={i18n.t('editor.imageOpen')}
        ariaLabel={i18n.t('editor.imageOpen')}
        expanded={open}
        controls={popoverId}
        active={open}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      />
      {open && (
        <EditorToolPanel
          id={popoverId}
          labelledBy={titleId}
          trigger={containerRef.current?.querySelector('button') ?? null}
        >
          <div class='flex flex-col gap-3'>
            <h2 id={titleId} class='font-semibold'>{i18n.t('editor.imageTitle')}</h2>
            <label class='ds-form-control' htmlFor={urlId}>
              <span>{i18n.t('editor.imageUrl')}</span>
              <Input
                id={urlId}
                type='url'
                placeholder='https://example.com/image.png'
                value={url}
                onInput={(event) => {
                  const value = (event.target as HTMLInputElement).value;
                  setUrl(value);
                  if (value.trim()) {
                    setFile(null);
                    setError(null);
                  }
                }}
              />
            </label>
            <div class='text-center text-xs text-base-content/60 dark:text-base-content/60'>
              {i18n.t('editor.imageOrUpload')}
            </div>
            <label class='ds-form-control'>
              <span>{i18n.t('editor.imageSelectFile')}</span>
              <Input
                type='file'
                accept='image/*'
                onChange={handleFileChange}
              />
            </label>
            <label class='ds-form-control'>
              <span>{i18n.t('editor.imageAlt')}</span>
              <Input
                value={alt}
                onInput={(event) => {
                  setAlt((event.target as HTMLInputElement).value);
                  setDecorative(false);
                  if (error) setError(null);
                }}
                placeholder={i18n.t('editor.imageAltPlaceholder')}
                disabled={decorative}
              />
            </label>
            <label class='flex items-center gap-2 text-xs text-base-content/70 dark:text-base-content/70'>
              <Checkbox
                checked={decorative}
                onChange={(event) => {
                  const checked = (event.target as HTMLInputElement).checked;
                  setDecorative(checked);
                  if (checked) {
                    setAlt('');
                    setLongDescription('');
                  }
                }}
              />
              <span>{i18n.t('editor.imageDecorative')}</span>
            </label>
            <label class='ds-form-control'>
              <span>{i18n.t('editor.imageLongDescription')}</span>
              <Textarea
                value={longDescription}
                onInput={(event) => setLongDescription((event.target as HTMLTextAreaElement).value)}
                placeholder={i18n.t('editor.imageLongDescriptionPlaceholder')}
                disabled={decorative}
              />
            </label>
            {error && (
              <p role='alert' aria-live='polite' class='text-xs text-error dark:text-error'>
                {error}
              </p>
            )}
            <div class='flex justify-end gap-2 pt-1'>
              <Button type='button' variant='ghost' size='sm' onClick={close}>
                {i18n.t('editor.cancel')}
              </Button>
              <Button
                type='button'
                variant='primary'
                size='sm'
                disabled={!canSubmit || disabled}
                onClick={handleSubmit}
              >
                {busy ? i18n.t('editor.imageUploading') : i18n.t('editor.insert')}
              </Button>
            </div>
          </div>
        </EditorToolPanel>
      )}
    </div>
  );
}

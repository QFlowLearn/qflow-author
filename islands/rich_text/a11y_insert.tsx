import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Checkbox from '../../components/ui/Checkbox.tsx';
import Input from '../../components/ui/Input.tsx';
import Select from '../../components/ui/Select.tsx';
import Textarea from '../../components/ui/Textarea.tsx';
import { AccessibilityIcon } from '../../components/icons/RichTextIcons.tsx';
import type { Editor } from '@prosekit/core';
import type { RichTextExtension } from './editor_types.ts';
import { escapeHtmlAttr, escapeHtmlText } from './html_escape.ts';
import { sliceFromHtml } from './slice_from_html.ts';
import { ToolbarButton } from './toolbar.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import EditorToolPanel from '../../components/ui/EditorToolPanel.tsx';

type A11yStyle = 'none' | 'keyword' | 'hidden';
type ReadingType = '' | 'computer-read-aloud' | 'screen-reader';

/** Build the sanitized-independent QTI markup while preserving machine attributes. */
export function buildA11yMarkup(input: {
  text: string;
  style: A11yStyle;
  elementId?: string;
  a11yRole?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  catalogIdRef?: string;
  ariaHidden?: boolean;
  suppressTts?: boolean;
  ssmlJson?: string;
  readingType?: ReadingType;
}): string {
  const classes: string[] = [];
  if (input.style === 'keyword') classes.push('qti-keyword-emphasis');
  if (input.style === 'hidden') classes.push('qti-visually-hidden');
  const attrs: Record<string, string> = {};
  if (classes.length) attrs.class = classes.join(' ');
  if (input.elementId?.trim()) attrs.id = input.elementId.trim();
  if (input.a11yRole?.trim()) attrs['data-qti-a11y-content-role'] = input.a11yRole.trim();
  if (input.ariaLabel?.trim()) attrs['data-qti-aria-label'] = input.ariaLabel.trim();
  if (input.ariaLabelledBy?.trim()) attrs['data-qti-aria-labelledby'] = input.ariaLabelledBy.trim();
  if (input.ariaDescribedBy?.trim()) {
    attrs['data-qti-aria-describedby'] = input.ariaDescribedBy.trim();
  }
  if (input.catalogIdRef?.trim()) attrs['data-catalog-idref'] = input.catalogIdRef.trim();
  if (input.ariaHidden) attrs['data-qti-aria-hidden'] = 'true';
  if (input.suppressTts) attrs['data-qti-suppress-tts'] = 'true';
  if (input.ssmlJson?.trim()) attrs['data-ssml'] = input.ssmlJson.trim();
  if (input.readingType) attrs['data-reading-type'] = input.readingType;
  const attrsStr = Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeHtmlAttr(value)}"`)
    .join('');
  return `<span${attrsStr}>${escapeHtmlText(input.text.trim())}</span>`;
}

type A11yPopoverProps = {
  editor: Editor<RichTextExtension>;
  disabled: boolean;
  contentScope: 'inline' | 'body';
  sanitize: (html: string) => string;
  catalogIds: readonly string[];
};

export function A11yInsertPopover(
  { editor, disabled, contentScope, sanitize, catalogIds }: A11yPopoverProps,
) {
  const i18n = useI18n();
  const instanceId = useDomId();
  const popoverId = `rte-a11y-popover-${instanceId}`;
  const titleId = `rte-a11y-title-${instanceId}`;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [style, setStyle] = useState<A11yStyle>('keyword');
  const [elementId, setElementId] = useState('');
  const [a11yRole, setA11yRole] = useState('');
  const [ariaLabel, setAriaLabel] = useState('');
  const [ariaLabelledBy, setAriaLabelledBy] = useState('');
  const [ariaDescribedBy, setAriaDescribedBy] = useState('');
  const [catalogIdRef, setCatalogIdRef] = useState('');
  const [ariaHidden, setAriaHidden] = useState(false);
  const [suppressTts, setSuppressTts] = useState(false);
  const [ssmlJson, setSsmlJson] = useState('');
  const [readingType, setReadingType] = useState<ReadingType>('');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const resetState = useCallback(() => {
    setText('');
    setStyle('keyword');
    setElementId('');
    setA11yRole('');
    setAriaLabel('');
    setAriaLabelledBy('');
    setAriaDescribedBy('');
    setCatalogIdRef('');
    setAriaHidden(false);
    setSuppressTts(false);
    setSsmlJson('');
    setReadingType('');
    setError(null);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    resetState();
  }, [resetState]);

  useLayoutEffect(() => {
    if (!open) return;
    containerRef.current?.querySelector<HTMLInputElement>('input[name="a11y-text"]')?.focus();
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

  const insertMarkup = useCallback(
    (html: string) => {
      const clean = sanitize(html);
      if (!clean) return;
      const slice = sliceFromHtml(clean, editor.schema, contentScope === 'inline');
      if (!slice) return;
      const view = editor.view;
      if (!view) return;
      const tr = view.state.tr.replaceSelection(slice).scrollIntoView();
      view.dispatch(tr);
    },
    [contentScope, editor, sanitize],
  );

  const handleSubmit = useCallback(() => {
    if (disabled) return;
    setError(null);
    const value = text.trim();
    if (!value) {
      setError(i18n.t('editor.a11yTextRequired'));
      return;
    }
    const ssmlValue = ssmlJson.trim();
    if (ssmlValue) {
      try {
        JSON.parse(ssmlValue);
      } catch {
        setError(i18n.t('editor.a11yInvalidSsml'));
        return;
      }
    }
    const html = buildA11yMarkup({
      text: value,
      style,
      elementId,
      a11yRole,
      ariaLabel,
      ariaLabelledBy,
      ariaDescribedBy,
      catalogIdRef,
      ariaHidden,
      suppressTts,
      ssmlJson: ssmlValue,
      readingType,
    });
    insertMarkup(html);
    close();
  }, [
    a11yRole,
    ariaDescribedBy,
    ariaHidden,
    ariaLabel,
    ariaLabelledBy,
    catalogIdRef,
    close,
    disabled,
    elementId,
    insertMarkup,
    readingType,
    ssmlJson,
    style,
    suppressTts,
    text,
    i18n,
  ]);

  const canSubmit = !disabled;

  return (
    <div class='relative' ref={containerRef}>
      <ToolbarButton
        label={<AccessibilityIcon />}
        tooltip={i18n.t('editor.a11yOpen')}
        ariaLabel={i18n.t('editor.a11yOpen')}
        expanded={open}
        controls={popoverId}
        active={open}
        disabled={disabled}
        onClick={() => {
          if (!open) {
            const selection = editor.view?.state.selection;
            const selectedText = selection && !selection.empty
              ? editor.view?.state.doc.textBetween(selection.from, selection.to, ' ')
              : '';
            if (selectedText) setText(selectedText);
          }
          setOpen((prev) => !prev);
        }}
      />
      {open && (
        <EditorToolPanel
          id={popoverId}
          labelledBy={titleId}
          trigger={containerRef.current?.querySelector('button') ?? null}
        >
          <div class='flex flex-col gap-3'>
            <h2 id={titleId} class='font-semibold'>{i18n.t('editor.a11yTitle')}</h2>
            <label class='ds-form-control'>
              <span>{i18n.t('editor.a11yText')}</span>
              <Input
                name='a11y-text'
                value={text}
                onInput={(event) => setText((event.target as HTMLInputElement).value)}
                placeholder={i18n.t('editor.a11yTextPlaceholder')}
              />
            </label>
            <label class='ds-form-control'>
              <span>{i18n.t('editor.a11yStyle')}</span>
              <Select
                value={style}
                onInput={(event) =>
                  setStyle((event.target as HTMLSelectElement).value as A11yStyle)}
              >
                <option value='none'>{i18n.t('editor.a11yNone')}</option>
                <option value='keyword'>{i18n.t('editor.a11yKeyword')}</option>
                <option value='hidden'>{i18n.t('editor.a11yHidden')}</option>
              </Select>
            </label>
            <label class='ds-form-control'>
              <span>{i18n.t('editor.a11yRole')}</span>
              <Input
                value={a11yRole}
                onInput={(event) => setA11yRole((event.target as HTMLInputElement).value)}
                placeholder={i18n.t('editor.a11yRolePlaceholder')}
              />
            </label>
            <label class='ds-form-control'>
              <span>{i18n.t('editor.a11yElementId')}</span>
              <Input
                value={elementId}
                onInput={(event) => setElementId((event.target as HTMLInputElement).value)}
                placeholder={i18n.t('editor.a11yElementIdPlaceholder')}
              />
            </label>
            <div class='grid gap-3 sm:grid-cols-2'>
              <label class='ds-form-control'>
                <span>{i18n.t('editor.a11yAriaLabel')}</span>
                <Input
                  value={ariaLabel}
                  onInput={(event) => setAriaLabel((event.target as HTMLInputElement).value)}
                  placeholder='data-qti-aria-label'
                />
              </label>
              <label class='ds-form-control'>
                <span>{i18n.t('editor.a11yAriaLabelledby')}</span>
                <Input
                  value={ariaLabelledBy}
                  onInput={(event) => setAriaLabelledBy((event.target as HTMLInputElement).value)}
                  placeholder='data-qti-aria-labelledby'
                />
              </label>
              <label class='ds-form-control'>
                <span>{i18n.t('editor.a11yAriaDescribedby')}</span>
                <Input
                  value={ariaDescribedBy}
                  onInput={(event) => setAriaDescribedBy((event.target as HTMLInputElement).value)}
                  placeholder='data-qti-aria-describedby'
                />
              </label>
              <label class='ds-form-control'>
                <span>{i18n.t('editor.a11yCatalogReference')}</span>
                <Select
                  value={catalogIdRef}
                  onInput={(event) => setCatalogIdRef((event.target as HTMLSelectElement).value)}
                >
                  <option value=''>{i18n.t('editor.a11yNone')}</option>
                  {catalogIds.map((catalogId) => (
                    <option key={catalogId} value={catalogId}>{catalogId}</option>
                  ))}
                </Select>
              </label>
            </div>
            <label class='flex items-center gap-2 text-xs text-base-content/70 dark:text-base-content/70'>
              <Checkbox
                checked={ariaHidden}
                onChange={(event) => setAriaHidden((event.target as HTMLInputElement).checked)}
              />
              <span>{i18n.t('editor.a11yHide')}</span>
            </label>
            <label class='flex items-center gap-2 text-xs text-base-content/70 dark:text-base-content/70'>
              <Checkbox
                checked={suppressTts}
                onChange={(event) => setSuppressTts((event.target as HTMLInputElement).checked)}
              />
              <span>{i18n.t('editor.a11ySuppressTts')}</span>
            </label>
            <label class='ds-form-control'>
              <span>{i18n.t('editor.a11ySsml')}</span>
              <Textarea
                value={ssmlJson}
                onInput={(event) => setSsmlJson((event.target as HTMLTextAreaElement).value)}
                placeholder={i18n.t('editor.a11ySsmlPlaceholder')}
              />
            </label>
            <label class='ds-form-control'>
              <span>{i18n.t('editor.a11yReadingType')}</span>
              <Select
                value={readingType}
                onInput={(event) =>
                  setReadingType((event.target as HTMLSelectElement).value as ReadingType)}
              >
                <option value=''>{i18n.t('editor.a11yNone')}</option>
                <option value='computer-read-aloud'>computer-read-aloud</option>
                <option value='screen-reader'>screen-reader</option>
              </Select>
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
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                {i18n.t('editor.insert')}
              </Button>
            </div>
          </div>
        </EditorToolPanel>
      )}
    </div>
  );
}

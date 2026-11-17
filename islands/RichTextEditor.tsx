/* eslint-disable react/no-danger */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { sanitizeBodyHtml, sanitizeInlineHtml } from '../lib/sanitize.ts';
import { ProseKit, useDocChange } from '@prosekit/preact';
import { createEditor, union } from '@prosekit/core';
import { definePlaceholder } from '@prosekit/extensions/placeholder';
import { defineTextEntryBlank } from './rich_text/text_entry_blank_extension.ts';
import { defineInlineChoiceSlot } from './rich_text/inline_choice_slot_extension.ts';
import { defineGapMatchSlot } from './rich_text/gap_match_slot_extension.ts';
import { defineHottextSlot } from './rich_text/hottext_slot_extension.ts';
import { defineQFlowBasicExtension } from './rich_text/qflow_basic_extension.ts';
import { EditorSurface } from './rich_text/editor_surface.tsx';
import { Toolbar } from './rich_text/toolbar.tsx';
import type { RichTextEditorApi, RichTextExtension } from './rich_text/editor_types.ts';
import { sliceFromHtml } from './rich_text/slice_from_html.ts';
import { useI18n } from '../lib/i18n/context.tsx';
import RichTextFrame from '../components/ui/RichTextFrame.tsx';
import FormattingOverflow from '../components/ui/FormattingOverflow.tsx';

export type { RichTextEditorApi, TextEntryBlankInput } from './rich_text/editor_types.ts';

const DEFAULT_BODY_HEIGHT = 140;
const DEFAULT_INLINE_HEIGHT = 72;

type Props = {
  valueHtml: string;
  onChangeHtml: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  class?: string;
  registerApi?: (api: RichTextEditorApi | null) => void;
  toolbarExtras?: ComponentChildren;
  contentScope?: 'inline' | 'body';
  catalogIds?: readonly string[];
  ariaLabelledBy?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  autoFocus?: boolean;
  appearance?: 'field' | 'question';
};

export default function RichTextEditor(props: Props) {
  const i18n = useI18n();
  const sanitize = props.contentScope === 'body' ? sanitizeBodyHtml : sanitizeInlineHtml;
  const safeValueHtml = sanitize(props.valueHtml || '');
  const [browserReady, setBrowserReady] = useState(false);
  useEffect(() => setBrowserReady(true), []);
  if (!browserReady) {
    return (
      <RichTextFrame appearance={props.appearance ?? 'field'} class={props.class}>
        <span role='status' aria-live='polite'>{i18n.t('editor.loadingRichText')}</span>
        {safeValueHtml && (
          <div
            aria-label={i18n.t('editor.currentContent')}
            dangerouslySetInnerHTML={{ __html: safeValueHtml }}
          />
        )}
      </RichTextFrame>
    );
  }
  return <BrowserRichTextEditor {...props} />;
}

function BrowserRichTextEditor(
  {
    valueHtml,
    onChangeHtml,
    placeholder,
    minHeight,
    class: className,
    registerApi,
    toolbarExtras,
    contentScope = 'inline',
    catalogIds = [],
    ariaLabelledBy,
    ariaInvalid,
    ariaDescribedBy,
    autoFocus = false,
    appearance = 'field',
  }: Props,
) {
  const sanitize = useMemo(
    () => contentScope === 'body' ? sanitizeBodyHtml : sanitizeInlineHtml,
    [contentScope],
  );
  const normalizedValue = useMemo(() => sanitize(valueHtml || ''), [sanitize, valueHtml]);
  const i18n = useI18n();
  const placeholderText = placeholder?.trim() || i18n.t('editor.startTyping');
  const initialContentRef = useRef<string | null>(null);
  if (initialContentRef.current === null) {
    initialContentRef.current = normalizedValue || '<p></p>';
  }

  const extension = useMemo(() =>
    union(
      defineQFlowBasicExtension(),
      definePlaceholder({ placeholder: placeholderText }),
      defineTextEntryBlank(),
      defineInlineChoiceSlot(),
      defineGapMatchSlot(),
      defineHottextSlot(),
    ), [placeholderText]);

  const editor = useMemo(() =>
    createEditor<RichTextExtension>({
      extension,
      defaultContent: initialContentRef.current || '<p></p>',
    }), [extension]);

  const latestHtmlRef = useRef(initialContentRef.current || '');
  const applyingValueRef = useRef(false);
  const onChangeRef = useRef(onChangeHtml);
  const autoFocusAppliedRef = useRef(false);
  useLayoutEffect(() => {
    onChangeRef.current = onChangeHtml;
  }, [onChangeHtml]);

  useDocChange(
    useCallback(() => {
      const html = sanitize(editor.getDocHTML());
      latestHtmlRef.current = html;
      if (applyingValueRef.current) return;
      onChangeRef.current(html);
    }, [editor, sanitize]),
    { editor },
  );

  useLayoutEffect(() => {
    if (normalizedValue === latestHtmlRef.current) return;
    latestHtmlRef.current = normalizedValue;
    // Do not echo a parent-provided value through onChange as an author edit.
    applyingValueRef.current = true;
    try {
      editor.setContent(normalizedValue || '<p></p>', 'end');
    } finally {
      applyingValueRef.current = false;
    }
  }, [editor, normalizedValue]);

  useEffect(() => () => editor.unmount(), [editor]);

  useEffect(() => {
    if (!autoFocus || autoFocusAppliedRef.current) return;
    autoFocusAppliedRef.current = true;
    const frame = requestAnimationFrame(() => {
      // An author may already have started editing another field before this frame runs.
      if (
        document.activeElement?.closest('input, textarea, select, [contenteditable="true"]')
      ) return;
      editor.view?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, editor]);

  useEffect(() => {
    if (!registerApi) return;
    const api: RichTextEditorApi = {
      focus: () => editor.view?.focus(),
      insertHtml: (snippet: string) => {
        const clean = sanitize(snippet || '');
        if (!clean) return;
        const slice = sliceFromHtml(clean, editor.schema, contentScope === 'inline');
        if (!slice) return;
        const view = editor.view;
        if (!view) return;
        const tr = view.state.tr.replaceSelection(slice).scrollIntoView();
        view.dispatch(tr);
      },
      insertTextEntryBlank: (blank) => {
        const command = editor.commands.insertTextEntryBlank;
        if (!command) return;
        command({
          slotId: blank.id,
          label: blank.label?.trim() || blank.id,
          widthClass: blank.widthClass ?? '',
        });
        editor.view?.focus();
      },
    };
    registerApi(api);
    return () => registerApi(null);
  }, [contentScope, editor, registerApi, sanitize]);

  const resolvedMinHeight = minHeight ??
    (contentScope === 'body' ? DEFAULT_BODY_HEIGHT : DEFAULT_INLINE_HEIGHT);

  return (
    <RichTextFrame appearance={appearance} class={className}>
      <ProseKit editor={editor}>
        {appearance === 'field' && (
          <Toolbar
            toolbarExtras={toolbarExtras}
            contentScope={contentScope}
            sanitize={sanitize}
            catalogIds={catalogIds}
          />
        )}
        <EditorSurface
          minHeight={resolvedMinHeight}
          ariaLabelledBy={ariaLabelledBy}
          ariaInvalid={ariaInvalid}
          ariaDescribedBy={ariaDescribedBy}
        />
        {appearance === 'question' && (
          <FormattingOverflow
            label={i18n.t('editor.format')}
            accessibleLabel={i18n.t('editor.format')}
            layout='toolbar'
          >
            <Toolbar
              toolbarExtras={toolbarExtras}
              contentScope={contentScope}
              sanitize={sanitize}
              catalogIds={catalogIds}
            />
          </FormattingOverflow>
        )}
      </ProseKit>
    </RichTextFrame>
  );
}

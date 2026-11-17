import { useCallback } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  BlockquoteIcon,
  BoldIcon,
  BulletListIcon,
  ItalicIcon,
  LinkIcon,
  OrderedListIcon,
  UnderlineIcon,
  UnlinkIcon,
} from '../../components/icons/RichTextIcons.tsx';
import type { Editor } from '@prosekit/core';
import { useEditor, useEditorDerivedValue } from '@prosekit/preact';
import { A11yInsertPopover } from './a11y_insert.tsx';
import type { RichTextExtension } from './editor_types.ts';
import { ImageInsertPopover } from './image_insert.tsx';
import { normalizeLinkInput } from './link_input.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import FormattingOverflow from '../../components/ui/FormattingOverflow.tsx';

type ToolbarButtonProps = {
  active?: boolean;
  disabled?: boolean;
  label: ComponentChildren;
  tooltip: string;
  ariaLabel: string;
  pressed?: boolean;
  expanded?: boolean;
  controls?: string;
  onClick: () => void;
};

export function ToolbarButton(
  { active, disabled, label, tooltip, ariaLabel, pressed, expanded, controls, onClick }:
    ToolbarButtonProps,
) {
  return (
    <button
      type='button'
      aria-label={ariaLabel}
      title={tooltip}
      aria-pressed={pressed === undefined ? undefined : pressed ? 'true' : 'false'}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      data-state={active ? 'on' : 'off'}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      class='outline-hidden focus-visible:outline-hidden flex h-8 min-w-[2rem] items-center justify-center rounded-md px-1.5 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-neutral-800 dark:focus-visible:ring-neutral-300 disabled:pointer-events-none text-neutral-900 dark:text-neutral-50 disabled:text-neutral-900/40 dark:disabled:text-neutral-50/40 bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800 data-[state=on]:bg-neutral-200 dark:data-[state=on]:bg-neutral-700'
    >
      {label}
    </button>
  );
}

type CommandState = {
  bold?: { canExec: boolean; active: boolean };
  italic?: { canExec: boolean; active: boolean };
  underline?: { canExec: boolean; active: boolean };
  blockquote?: { canExec: boolean; active: boolean };
  bullet?: { canExec: boolean; active: boolean };
  ordered?: { canExec: boolean; active: boolean };
  link?: { active: boolean };
  unlink?: { canExec: boolean };
  insertImage?: { canExec: boolean };
};

export function Toolbar(
  { toolbarExtras, contentScope, sanitize, catalogIds }: {
    toolbarExtras?: ComponentChildren;
    contentScope: 'inline' | 'body';
    sanitize: (html: string) => string;
    catalogIds: readonly string[];
  },
) {
  const i18n = useI18n();
  const editor = useEditor({ update: true }) as Editor<RichTextExtension>;
  const commandState = useEditorDerivedValue(() => ({
    bold: editor.commands.toggleBold
      ? {
        canExec: editor.commands.toggleBold.canExec(),
        active: editor.marks.bold?.isActive() ?? false,
      }
      : undefined,
    italic: editor.commands.toggleItalic
      ? {
        canExec: editor.commands.toggleItalic.canExec(),
        active: editor.marks.italic?.isActive() ?? false,
      }
      : undefined,
    underline: editor.commands.toggleUnderline
      ? {
        canExec: editor.commands.toggleUnderline.canExec(),
        active: editor.marks.underline?.isActive() ?? false,
      }
      : undefined,
    blockquote: editor.commands.toggleBlockquote
      ? {
        canExec: editor.commands.toggleBlockquote.canExec(),
        active: editor.nodes.blockquote?.isActive() ?? false,
      }
      : undefined,
    bullet: editor.commands.toggleList
      ? {
        canExec: editor.commands.toggleList.canExec({ kind: 'bullet' }),
        active: editor.nodes.list?.isActive({ kind: 'bullet' }) ?? false,
      }
      : undefined,
    insertImage: editor.commands.insertImage
      ? { canExec: editor.commands.insertImage.canExec() }
      : undefined,
    ordered: editor.commands.toggleList
      ? {
        canExec: editor.commands.toggleList.canExec({ kind: 'ordered' }),
        active: editor.nodes.list?.isActive({ kind: 'ordered' }) ?? false,
      }
      : undefined,
    link: editor.marks.link ? { active: editor.marks.link.isActive() ?? false } : undefined,
    unlink: editor.commands.removeLink
      ? { canExec: editor.commands.removeLink.canExec() }
      : undefined,
  }), { editor }) as CommandState;

  const exec = useCallback((action?: () => boolean) => {
    if (!action) return;
    action();
    editor.view?.focus();
  }, [editor]);

  const toggleList = useCallback((kind: 'bullet' | 'ordered') => {
    exec(() => editor.commands.toggleList?.({ kind }));
  }, [editor, exec]);

  const addLink = useCallback(() => {
    const input = prompt(i18n.t('editor.linkPrompt'));
    if (!input) return;
    const href = normalizeLinkInput(input);
    if (!href) return;
    exec(() =>
      editor.commands.toggleLink?.({ href, target: '_blank', rel: 'noopener noreferrer' })
    );
  }, [editor, exec, i18n]);

  return (
    <div
      class='rte-toolbar z-10 box-border border-b border-neutral-200 dark:border-neutral-800 bg-base-100 dark:bg-base-200 flex flex-wrap items-center'
      role='toolbar'
      aria-label={i18n.t('editor.toolbar')}
    >
      {commandState.bold && editor.commands.toggleBold && (
        <ToolbarButton
          label={<BoldIcon />}
          tooltip={i18n.t('editor.bold')}
          ariaLabel={i18n.t('editor.bold')}
          active={commandState.bold.active}
          pressed={commandState.bold.active}
          disabled={!commandState.bold.canExec}
          onClick={() => exec(editor.commands.toggleBold)}
        />
      )}
      {commandState.italic && editor.commands.toggleItalic && (
        <ToolbarButton
          label={<ItalicIcon />}
          tooltip={i18n.t('editor.italic')}
          ariaLabel={i18n.t('editor.italic')}
          active={commandState.italic.active}
          pressed={commandState.italic.active}
          disabled={!commandState.italic.canExec}
          onClick={() => exec(editor.commands.toggleItalic)}
        />
      )}
      {commandState.bullet && (
        <ToolbarButton
          label={<BulletListIcon />}
          tooltip={i18n.t('editor.bulletList')}
          ariaLabel={i18n.t('editor.bulletList')}
          active={commandState.bullet.active}
          pressed={commandState.bullet.active}
          disabled={!commandState.bullet.canExec}
          onClick={() => toggleList('bullet')}
        />
      )}
      {commandState.link && editor.commands.toggleLink && (
        <ToolbarButton
          label={<LinkIcon />}
          tooltip={i18n.t('editor.addLink')}
          ariaLabel={i18n.t('editor.addLink')}
          active={commandState.link.active}
          pressed={commandState.link.active}
          disabled={!editor.commands.toggleLink}
          onClick={addLink}
        />
      )}
      {commandState.insertImage && (
        <ImageInsertPopover
          editor={editor}
          disabled={!commandState.insertImage.canExec}
          contentScope={contentScope}
          sanitize={sanitize}
        />
      )}
      <A11yInsertPopover
        editor={editor}
        disabled={false}
        contentScope={contentScope}
        sanitize={sanitize}
        catalogIds={catalogIds}
      />
      <FormattingOverflow
        label={i18n.t('editor.more')}
        accessibleLabel={i18n.t('editor.moreFormatting')}
      >
        {commandState.underline && editor.commands.toggleUnderline && (
          <ToolbarButton
            label={
              <>
                <UnderlineIcon />
                {i18n.t('editor.underline')}
              </>
            }
            tooltip={i18n.t('editor.underline')}
            ariaLabel={i18n.t('editor.underline')}
            active={commandState.underline.active}
            pressed={commandState.underline.active}
            disabled={!commandState.underline.canExec}
            onClick={() => exec(editor.commands.toggleUnderline)}
          />
        )}
        {commandState.blockquote && editor.commands.toggleBlockquote && (
          <ToolbarButton
            label={
              <>
                <BlockquoteIcon />
                {i18n.t('editor.blockquote')}
              </>
            }
            tooltip={i18n.t('editor.blockquote')}
            ariaLabel={i18n.t('editor.blockquote')}
            active={commandState.blockquote.active}
            pressed={commandState.blockquote.active}
            disabled={!commandState.blockquote.canExec}
            onClick={() => exec(editor.commands.toggleBlockquote)}
          />
        )}
        {commandState.ordered && (
          <ToolbarButton
            label={
              <>
                <OrderedListIcon />
                {i18n.t('editor.numberedList')}
              </>
            }
            tooltip={i18n.t('editor.numberedList')}
            ariaLabel={i18n.t('editor.numberedList')}
            active={commandState.ordered.active}
            pressed={commandState.ordered.active}
            disabled={!commandState.ordered.canExec}
            onClick={() => toggleList('ordered')}
          />
        )}
        {commandState.unlink && editor.commands.removeLink && (
          <ToolbarButton
            label={
              <>
                <UnlinkIcon />
                {i18n.t('editor.removeLink')}
              </>
            }
            tooltip={i18n.t('editor.removeLink')}
            ariaLabel={i18n.t('editor.removeLink')}
            disabled={!commandState.unlink.canExec}
            onClick={() => exec(editor.commands.removeLink)}
          />
        )}
      </FormattingOverflow>
      <span class='rte-right' />
      {toolbarExtras}
    </div>
  );
}

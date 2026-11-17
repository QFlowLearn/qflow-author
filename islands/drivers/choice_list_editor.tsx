import { useDomId } from '../../lib/rendering/island_context.tsx';
import AnswerOptionRow, {
  AnswerOptionLabelButton,
  RemoveAnswerButton,
} from '../../components/ui/AnswerOptionRow.tsx';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import ChoiceHistoryNotice from '../../components/ui/ChoiceHistoryNotice.tsx';
import Button from '../../components/ui/Button.tsx';
import Checkbox from '../../components/ui/Checkbox.tsx';
import CorrectBadge from '../../components/ui/CorrectBadge.tsx';
import Input from '../../components/ui/Input.tsx';
import Textarea from '../../components/ui/Textarea.tsx';
import RichTextEditor, { type RichTextEditorApi } from '../RichTextEditor.tsx';
import { choiceLabel } from '../../lib/choice_labels.ts';
import type { FieldKey } from '../../lib/validation_fields.ts';
import type { Choice } from './types.ts';
import type { ChoiceListState } from './use_choice_list.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import { isChoiceEmpty, parseChoicePaste } from './choice_paste.ts';

export type ChoiceListShellProps = {
  useRteForChoices: boolean;
  plainTextValue: (text?: string, html?: string) => string;
  renderPromptField: (placeholder: string) => ComponentChildren;
  fieldHasIssue: (field: FieldKey) => boolean;
  fieldIssueText: (field: FieldKey) => string | undefined;
};

export type ChoiceListEditorProps = ChoiceListShellProps & {
  /** Dropdown answers do not have authored option labels. */
  editableLabels?: boolean;
  points?: ComponentChildren;
  list: ChoiceListState;
  promptPlaceholder: string;
  isChoiceCorrect: (choiceId: string) => boolean;
  renderCorrectControl: (
    choice: Choice,
    index: number,
    isCorrect: boolean,
    issueId: string | undefined,
  ) => ComponentChildren;
};

export function ChoiceListEditor(props: ChoiceListEditorProps) {
  const i18n = useI18n();
  const issueId = useDomId();
  const { list } = props;
  const root = useRef<HTMLDivElement>(null);
  const focusedHistorySequence = useRef(0);
  useLayoutEffect(() => {
    if (list.historyFocus.sequence === 0) return;
    const row = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-choice-id]') ?? [])
      .find((element) => element.dataset.choiceId === list.historyFocus.choiceId);
    const target = row?.querySelector<HTMLElement>('textarea, [contenteditable="true"]') ?? row ??
      root.current?.querySelector<HTMLElement>('[data-undo-choice-removal]');
    target?.focus({ preventScroll: true });
    if (target && target !== row) focusedHistorySequence.current = list.historyFocus.sequence;
  }, [list.historyFocus.sequence]);
  const focusRestoredRichText = (choiceId: string, api: RichTextEditorApi | null) => {
    if (
      !api || list.historyFocus.choiceId !== choiceId ||
      list.historyFocus.sequence === focusedHistorySequence.current
    ) return;
    focusedHistorySequence.current = list.historyFocus.sequence;
    const activeRow = document.activeElement?.closest<HTMLElement>('[data-choice-id]');
    if (activeRow?.dataset.choiceId === choiceId) api.focus();
  };
  const handleHistoryKey = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const target = event.target;
    if (
      !(target instanceof HTMLElement) || !target.closest('[data-choice-id], [data-choice-history]')
    ) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const redo = (key === 'z' && event.shiftKey) ||
      (key === 'y' && event.ctrlKey && !event.metaKey);
    const undo = key === 'z' && !event.shiftKey;
    if (list.keyboardHistory && ((undo && list.canUndoRemoval) || (redo && list.canRedoRemoval))) {
      event.preventDefault();
      event.stopPropagation();
      if (redo) list.redoRemoval();
      else list.undoRemoval();
    }
  };
  const handlePaste = (event: ClipboardEvent, index: number) => {
    const choice = list.choices[index];
    if (!choice || !event.clipboardData) return;
    const target = choiceContentTarget(event, props.useRteForChoices);
    if (!target || (!isChoiceEmpty(choice) && !hasWholeChoiceSelected(target))) return;
    const paste = parseChoicePaste(
      event.clipboardData.getData('text/plain'),
      event.clipboardData.getData('text/html'),
    );
    if (paste.entries.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    list.pasteChoices(index, paste, props.useRteForChoices);
  };
  return (
    <div class='space-y-3' ref={root} onKeyDownCapture={handleHistoryKey}>
      {props.renderPromptField(props.promptPlaceholder)}
      <div class='flex items-center justify-between'>
        <strong>{i18n.t('driver.choices')}</strong>
        <Button size='sm' type='button' onClick={list.addChoice}>
          {i18n.t('driver.addChoice')}
        </Button>
      </div>
      <div
        class={list.pastedChoiceCount > 0 ? 'flex flex-wrap items-center gap-2 text-sm' : 'sr-only'}
      >
        <span role='status' aria-live='polite'>
          {list.pastedChoiceCount > 0 &&
            i18n.t('driver.choicesPasted', { count: list.pastedChoiceCount })}
        </span>
        {list.pastedChoiceCount > 0 && (
          <>
            <Button size='xs' variant='ghost' type='button' onClick={list.undoPaste}>
              {i18n.t('driver.undoChoicePaste')}
            </Button>
            <Button size='xs' variant='ghost' type='button' onClick={list.keepPasteAsOne}>
              {i18n.t('driver.keepPasteAsOneChoice')}
            </Button>
          </>
        )}
      </div>
      {(list.canUndoRemoval || list.canRedoRemoval) && (
        <ChoiceHistoryNotice
          message={i18n.t(
            list.historyFocus.choiceId ? 'driver.choiceRestored' : 'driver.choiceRemoved',
          )}
          undoLabel={i18n.t('driver.undoChoiceRemoval')}
          redoLabel={i18n.t('driver.redoChoiceRemoval')}
          canUndo={list.canUndoRemoval}
          canRedo={list.canRedoRemoval}
          onUndo={list.undoRemoval}
          onRedo={list.redoRemoval}
        />
      )}
      {props.fieldHasIssue('choices') && (
        <p id={`${issueId}-choices`} class='text-xs text-error'>
          {props.fieldIssueText('choices')}
        </p>
      )}
      {props.fieldHasIssue('correct') && (
        <p id={`${issueId}-correct`} class='text-xs text-error'>
          {props.fieldIssueText('correct')}
        </p>
      )}
      {list.choices.map((choice, index) => {
        const empty = !(choice.html ?? choice.text ?? '').trim();
        const isCorrect = props.isChoiceCorrect(choice.id);
        const labelText = choiceLabel(choice, index, list.choiceLabelOptions);
        const editingThisLabel = list.labelEditing?.id === choice.id;
        return (
          <AnswerOptionRow
            key={choice.id}
            choiceId={choice.id}
            selection={props.renderCorrectControl(
              choice,
              index,
              isCorrect,
              props.fieldHasIssue('correct') ? `${issueId}-correct` : undefined,
            )}
            label={props.editableLabels === false
              ? (
                <span class='inline-grid min-h-11 place-items-center text-sm text-base-content/65'>
                  {labelText}
                </span>
              )
              : editingThisLabel
              ? (
                <Input
                  autoFocus
                  size='sm'
                  class='text-center text-sm'
                  value={list.labelEditing?.value ?? ''}
                  onInput={(e) =>
                    list.onLabelEditInput(choice.id, (e.target as HTMLInputElement).value)}
                  onBlur={list.commitLabelEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      list.commitLabelEdit();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      list.onLabelEditInput(choice.id, labelText);
                      list.commitLabelEdit();
                    }
                  }}
                  placeholder={labelText}
                  aria-label={i18n.t('driver.choiceLabel')}
                />
              )
              : (
                <AnswerOptionLabelButton
                  text={labelText}
                  editLabel={i18n.t('driver.editChoice', { label: labelText })}
                  onEdit={() => list.beginLabelEdit(choice, index)}
                />
              )}
            content={
              <div
                onPasteCapture={(event) => handlePaste(event, index)}
                onKeyDownCapture={(event) => {
                  if (
                    list.pastedChoiceCount > 0 &&
                    choiceContentTarget(event, props.useRteForChoices) &&
                    (event.ctrlKey || event.metaKey) &&
                    !event.shiftKey && event.key.toLowerCase() === 'z'
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    list.undoPaste();
                  }
                }}
              >
                {props.useRteForChoices
                  ? (
                    <RichTextEditor
                      valueHtml={choice.html ?? (choice.text ? choice.text : '')}
                      onChangeHtml={(html) => list.updateChoiceHtml(index, html)}
                      registerApi={(api) => focusRestoredRichText(choice.id, api)}
                      placeholder={i18n.t('driver.choicePlaceholder', { id: choice.id })}
                      minHeight={48}
                      ariaInvalid={props.fieldHasIssue('choices') || undefined}
                      ariaDescribedBy={props.fieldHasIssue('choices')
                        ? `${issueId}-choices`
                        : undefined}
                      class={`${empty ? 'border-error/60 ring-1 ring-error/40' : ''} w-full`}
                    />
                  )
                  : (
                    <Textarea
                      rows={1}
                      appearance='quiet'
                      autoSize
                      class={`ds-textarea-sm ${empty ? 'ds-textarea-error' : ''}`}
                      value={props.plainTextValue(choice.text, choice.html)}
                      onInput={(event) => list.updateChoiceText(index, event.currentTarget.value)}
                      placeholder={i18n.t('driver.choicePlaceholder', { id: choice.id })}
                      aria-label={i18n.t('driver.choicePlaceholder', { id: choice.id })}
                      aria-invalid={props.fieldHasIssue('choices') || undefined}
                      aria-describedby={props.fieldHasIssue('choices')
                        ? `${issueId}-choices`
                        : undefined}
                    />
                  )}
              </div>
            }
            actions={
              <>
                {isCorrect && <CorrectBadge>{i18n.t('driver.correct')}</CorrectBadge>}
                <RemoveAnswerButton
                  label={i18n.t('driver.removeChoiceLabel', { label: labelText })}
                  onRemove={() => list.removeChoice(index)}
                />
              </>
            }
            pin={list.shuffle && list.allowPins && (
              <label class='flex items-center gap-2 pl-1 text-sm text-base-content/70'>
                <Checkbox
                  checked={!!choice.fixed}
                  onChange={(e) =>
                    list.toggleChoicePin(index, (e.target as HTMLInputElement).checked)}
                />
                <span>{i18n.t('driver.pinChoice')}</span>
              </label>
            )}
          />
        );
      })}
      {props.points}
    </div>
  );
}

function choiceContentTarget(event: Event, richText: boolean): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return null;
  if (richText) {
    const editor = target.closest('[contenteditable="true"]');
    return editor instanceof HTMLElement ? editor : null;
  }
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    ? target
    : null;
}

function hasWholeChoiceSelected(target: HTMLElement): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.selectionStart === 0 && target.selectionEnd === target.value.length;
  }
  const editor = target.closest('[contenteditable="true"]');
  const selection = document.getSelection();
  return Boolean(
    editor && selection?.anchorNode && selection.focusNode &&
      editor.contains(selection.anchorNode) && editor.contains(selection.focusNode) &&
      selection.toString() === editor.textContent && !editor.querySelector('img'),
  );
}

import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import type { DriverUiContext } from './view_registry.ts';
import type { Choice, CommonContentProps } from './types.ts';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

export type OrderContentProps = CommonContentProps & {
  choices: Choice[];
  addChoice: () => void;
  plainTextValue: (text?: string, html?: string) => string;
  updateChoiceText: (index: number, text: string) => void;
  removeChoice: (index: number) => void;
  dragIndex: number | null;
  setDragIndex: (index: number | null) => void;
  reorderChoice: (from: number, to: number) => void;
};

function OrderEditor(ctx: DriverUiContext<'order'>) {
  const { editor, draft, update } = ctx;
  const choices = draft.choices;
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const addChoice = () => {
    const nextId = String.fromCharCode(65 + choices.length);
    const nextChoices = [...choices, { id: nextId, text: '' }];
    update({ ...draft, choices: nextChoices, correctOrder: nextChoices.map((c) => c.id) });
  };
  const updateChoiceText = (index: number, text: string) => {
    const nextChoices = choices.map((c, i) => i === index ? { ...c, text, html: undefined } : c);
    update({ ...draft, choices: nextChoices });
  };
  const removeChoice = (index: number) => {
    const nextChoices = choices.filter((_, idx) => idx !== index);
    update({ ...draft, choices: nextChoices, correctOrder: nextChoices.map((c) => c.id) });
    if (dragIndex === index) setDragIndex(null);
  };
  const reorderChoice = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= choices.length || to >= choices.length) return;
    const nextChoices = [...choices];
    const [moved] = nextChoices.splice(from, 1);
    nextChoices.splice(to, 0, moved);
    update({ ...draft, choices: nextChoices, correctOrder: nextChoices.map((c) => c.id) });
  };

  return (
    <OrderContent
      renderPromptField={editor.renderPromptField ?? (() => null)}
      fieldHasIssue={editor.fieldHasIssue ?? (() => false)}
      fieldIssueText={editor.fieldIssueText ?? (() => undefined)}
      choices={choices}
      addChoice={addChoice}
      plainTextValue={editor.plainTextValue ?? ((text) => text ?? '')}
      updateChoiceText={updateChoiceText}
      removeChoice={removeChoice}
      dragIndex={dragIndex}
      setDragIndex={setDragIndex}
      reorderChoice={reorderChoice}
    />
  );
}

export function OrderContent(props: OrderContentProps) {
  const i18n = useI18n();
  const issueId = useDomId();
  return (
    <div class='space-y-3'>
      {props.renderPromptField(i18n.t('driver.orderPrompt'))}
      <div class='flex items-center justify-between gap-2'>
        <strong>{i18n.t('driver.choices')}</strong>
        <Button
          size='sm'
          type='button'
          data-editor-field={props.choices.length === 0 ? 'order' : undefined}
          aria-invalid={props.fieldHasIssue('order') || undefined}
          aria-describedby={props.fieldHasIssue('order') ? issueId : undefined}
          onClick={props.addChoice}
        >
          {i18n.t('driver.addChoice')}
        </Button>
      </div>
      <p class='text-sm text-base-content/65'>
        {i18n.t('driver.reorderHelp')}
      </p>
      {props.fieldHasIssue('order') && (
        <FieldIssueMessage id={issueId} message={props.fieldIssueText('order') ?? ''} />
      )}
      {props.choices.map((choice, index) => (
        <div
          key={choice.id}
          class='space-y-2 rounded-lg border border-dashed border-base-300 bg-base-100 px-3 py-2'
          draggable
          onDragStart={() => props.setDragIndex(index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (props.dragIndex != null) props.reorderChoice(props.dragIndex, index);
            props.setDragIndex(null);
          }}
          data-editor-field='order'
          aria-label={i18n.t('driver.step', { number: index + 1 })}
          aria-invalid={props.fieldHasIssue('order') || undefined}
          aria-describedby={props.fieldHasIssue('order') ? issueId : undefined}
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e as KeyboardEvent).altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
              e.preventDefault();
              if (e.key === 'ArrowUp') props.reorderChoice(index, Math.max(0, index - 1));
              else props.reorderChoice(index, Math.min(props.choices.length - 1, index + 1));
            }
          }}
        >
          <div class='flex items-center justify-between text-sm text-base-content/70'>
            <span class='font-medium'>{i18n.t('driver.step', { number: index + 1 })}</span>
            <span class='text-xs'>{i18n.t('driver.dragToReorder')}</span>
          </div>
          <div class='flex items-center gap-2'>
            <div class='min-w-0 flex-1'>
              <Input
                size='sm'
                aria-label={i18n.t('driver.choicePlaceholder', { id: choice.id })}
                value={props.plainTextValue(choice.text, choice.html)}
                onInput={(e) => props.updateChoiceText(index, (e.target as HTMLInputElement).value)}
                placeholder={i18n.t('driver.choicePlaceholder', { id: choice.id })}
              />
            </div>
            <Button
              size='xs'
              variant='danger-ghost'
              class='shrink-0'
              type='button'
              onClick={() => props.removeChoice(index)}
            >
              {i18n.t('driver.removeChoice')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

attachStandardDriverViews('order', OrderEditor);

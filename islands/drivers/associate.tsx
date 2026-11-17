import { useDomId } from '../../lib/rendering/island_context.tsx';

import Button from '../../components/ui/Button.tsx';
import { RemoveAnswerButton } from '../../components/ui/AnswerOptionRow.tsx';
import { setDraftListFieldValue } from './editor_shell.tsx';
import Input, { AuthoringInputRow, FieldIssueMessage } from '../../components/ui/Input.tsx';
import type { DriverUiContext } from './view_registry.ts';
import type { Choice, CommonContentProps } from './types.ts';
import AssociateMatrix from '../AssociateMatrix.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { AssociationLimitField } from './association_limit_field.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';

export type AssociateContentProps = CommonContentProps & {
  choices: Choice[];
  addChoice: () => void;
  updateChoiceText: (index: number, text: string) => void;
  updateChoiceMatchMax: (index: number, max?: number) => void;
  removeChoice: (index: number) => void;
  pairs: Array<{ sourceId: string; targetId: string }>;
  setPairs: (pairs: Array<{ sourceId: string; targetId: string }>) => void;
  maxAssociations?: number;
  plainTextValue: (text?: string, html?: string) => string;
};

function AssociateEditor(ctx: DriverUiContext<'associate'>) {
  const { editor, draft, update } = ctx;
  const choices = draft.choices;
  const pairs = draft.correctPairs;
  const maxAssociations = draft.maxAssociations;

  const setChoices = (value: Choice[] | ((prev: Choice[]) => Choice[])) =>
    setDraftListFieldValue(editor, draft, update, 'choices', value);

  const addChoice = () => {
    const nextId = String.fromCharCode(65 + choices.length);
    setChoices((prev) => [...prev, { id: nextId, text: '', matchMax: 1 }]);
  };

  const updateChoiceText = (index: number, text: string) => {
    setChoices((prev) =>
      prev.map((choice, i) => i === index ? { ...choice, text, html: undefined } : choice)
    );
  };

  const updateChoiceMatchMax = (index: number, max?: number) => {
    setChoices((prev) =>
      prev.map((choice, i) => i === index ? { ...choice, matchMax: max } : choice)
    );
  };

  const removeChoice = (index: number) => {
    const removed = choices[index]?.id;
    const nextChoices = choices.filter((_, idx) => idx !== index);
    const nextPairs = removed
      ? pairs.filter((pair) => pair.sourceId !== removed && pair.targetId !== removed)
      : pairs;
    update({ ...draft, choices: nextChoices, correctPairs: nextPairs });
  };

  const setPairs = (value: Array<{ sourceId: string; targetId: string }>) =>
    update({ ...draft, correctPairs: value });

  return (
    <AssociateContent
      renderPromptField={editor.renderPromptField ?? (() => null)}
      fieldHasIssue={editor.fieldHasIssue ?? (() => false)}
      fieldIssueText={editor.fieldIssueText ?? (() => undefined)}
      plainTextValue={editor.plainTextValue ?? ((text) => text ?? '')}
      choices={choices}
      addChoice={addChoice}
      updateChoiceText={updateChoiceText}
      updateChoiceMatchMax={updateChoiceMatchMax}
      removeChoice={removeChoice}
      pairs={pairs}
      setPairs={setPairs}
      maxAssociations={maxAssociations}
    />
  );
}

export function AssociateContent(props: AssociateContentProps) {
  const i18n = useI18n();
  const issueId = useDomId();
  return (
    <div class='space-y-3'>
      {props.renderPromptField(i18n.t('driver.associatePrompt'))}
      <div class='flex items-center justify-between'>
        <strong>{i18n.t('driver.choices')}</strong>
        <Button
          size='sm'
          type='button'
          data-editor-field={props.choices.length === 0 ? 'choices' : undefined}
          aria-invalid={props.fieldHasIssue('choices') || undefined}
          aria-describedby={props.fieldHasIssue('choices') ? `${issueId}-choices` : undefined}
          onClick={props.addChoice}
        >
          + {i18n.t('driver.addChoice')}
        </Button>
      </div>
      <p class='text-sm text-base-content/65'>
        {i18n.t('driver.maxAssociationsHint')}
      </p>
      {props.fieldHasIssue('choices') && (
        <FieldIssueMessage
          id={`${issueId}-choices`}
          message={props.fieldIssueText('choices') ?? ''}
        />
      )}
      {props.choices.map((choice, index) => (
        <AuthoringInputRow
          key={`A-${choice.id}`}
          label={`${choice.id}.`}
          content={
            <Input
              size='sm'
              data-editor-field='choices'
              aria-label={i18n.t('driver.choicePlaceholder', { id: choice.id })}
              aria-invalid={props.fieldHasIssue('choices') || undefined}
              aria-describedby={props.fieldHasIssue('choices') ? `${issueId}-choices` : undefined}
              value={props.plainTextValue(choice.text, choice.html)}
              onInput={(e) => props.updateChoiceText(index, (e.target as HTMLInputElement).value)}
              placeholder={i18n.t('driver.choicePlaceholder', { id: choice.id })}
            />
          }
          details={
            <AssociationLimitField
              value={choice.matchMax}
              onChange={(value) => props.updateChoiceMatchMax(index, value)}
              ariaLabel={i18n.t('driver.maximumMatches', { name: choice.id })}
              label={i18n.t('driver.maxAssociations')}
              hint={null}
              layout='inline'
              widthClass='w-full'
            />
          }
          action={
            <RemoveAnswerButton
              label={i18n.t('driver.removeChoiceLabel', { label: choice.id })}
              onRemove={() => props.removeChoice(index)}
            />
          }
        />
      ))}
      <div class='mt-2 flex items-center justify-between'>
        <strong>{i18n.t('driver.correctPairs')}</strong>
      </div>
      {props.fieldHasIssue('matchPairs') && (
        <FieldIssueMessage
          id={`${issueId}-matchPairs`}
          message={props.fieldIssueText('matchPairs') ?? ''}
        />
      )}
      <AssociateMatrix
        issueId={props.fieldHasIssue('matchPairs') ? `${issueId}-matchPairs` : undefined}
        choices={props.choices}
        pairs={props.pairs}
        onChange={props.setPairs}
        maxAssociations={props.maxAssociations}
        rowLabel={i18n.t('driver.choices')}
      />
      <p class='text-xs text-base-content/60'>
        {i18n.t('driver.associationHelp')}
      </p>
    </div>
  );
}

attachStandardDriverViews('associate', AssociateEditor);

import { useDomId } from '../../lib/rendering/island_context.tsx';
import Button from './Button.tsx';
import Select from './Select.tsx';

type Props = {
  readonly value: 'single_select' | 'inline_choice';
  readonly label: string;
  readonly choiceLabel: string;
  readonly dropdownLabel: string;
  readonly reason?: string;
  readonly changedMessage?: string;
  readonly undoLabel: string;
  readonly undoReason?: string;
  readonly canChange: boolean;
  readonly canUndo: boolean;
  readonly busy: boolean;
  readonly onChange: () => void;
  readonly onUndo: () => void;
};

/** Compact, keyboard-native question presentation selector with local Undo and an explicit limit. */
export default function QuestionPresentationControl(props: Props) {
  const id = useDomId();
  return (
    <div class='min-w-0 space-y-1 sm:max-w-56 sm:pt-3' data-question-presentation>
      <div class='flex flex-wrap items-end gap-3'>
        <label class='block w-full' for={id}>
          <span class='sr-only'>{props.label}</span>
          <Select
            id={id}
            name='question-presentation'
            size='sm'
            value={props.value}
            disabled={props.busy}
            aria-describedby={props.reason ? `${id}-reason` : undefined}
            onChange={(event) => {
              if (event.currentTarget.value !== props.value) props.onChange();
            }}
          >
            <option
              value='single_select'
              disabled={props.value !== 'single_select' && !props.canChange}
            >
              {props.choiceLabel}
            </option>
            <option
              value='inline_choice'
              disabled={props.value !== 'inline_choice' && !props.canChange}
            >
              {props.dropdownLabel}
            </option>
          </Select>
        </label>
        {props.changedMessage && (
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={props.busy || !props.canUndo}
            onClick={props.onUndo}
            title={props.undoReason}
          >
            {props.undoLabel}
          </Button>
        )}
      </div>
      {props.reason && (
        <p id={`${id}-reason`} class='text-sm text-base-content/65'>{props.reason}</p>
      )}
      <p
        role='status'
        aria-live='polite'
        aria-atomic='true'
        class={props.changedMessage || props.undoReason
          ? 'text-sm text-base-content/65'
          : 'sr-only'}
      >
        {props.changedMessage}
        {props.undoReason && ` ${props.undoReason}`}
      </p>
    </div>
  );
}

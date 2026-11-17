import type { ComponentChildren } from 'preact';
import Button from './Button.tsx';

/** Keep answer controls aligned while giving the text a full row on narrow screens. */
export default function AnswerOptionRow(props: {
  readonly choiceId: string;
  readonly selection: ComponentChildren;
  readonly label: ComponentChildren;
  readonly content: ComponentChildren;
  readonly actions: ComponentChildren;
  readonly pin?: ComponentChildren;
}) {
  return (
    <div class='space-y-2' data-choice-id={props.choiceId} tabIndex={-1}>
      <div class='grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 py-1 sm:grid-cols-[2.75rem_2.75rem_minmax(0,1fr)_auto] sm:gap-x-3'>
        <div class='flex min-h-11 items-center justify-center' data-choice-selection>
          {props.selection}
        </div>
        <div class='min-w-0 max-w-full justify-self-start'>
          {props.label}
        </div>
        <div
          data-choice-content
          class='col-span-3 row-start-2 min-w-0 [&_textarea]:block sm:col-span-1 sm:col-start-3 sm:row-start-1'
        >
          {props.content}
        </div>
        <div class='col-start-3 row-start-1 flex items-center justify-end gap-2 sm:col-start-4 sm:min-w-32'>
          {props.actions}
        </div>
      </div>
      {props.pin}
    </div>
  );
}

/** Keep long authored labels readable by assistive technology and available in the hover label. */
export function AnswerOptionLabelButton(props: {
  readonly text: string;
  readonly editLabel: string;
  readonly onEdit: () => void;
}) {
  return (
    <button
      type='button'
      title={props.editLabel}
      aria-label={props.editLabel}
      class='inline-grid min-h-11 min-w-11 max-w-full place-items-center rounded px-2 text-sm font-medium text-base-content/80 hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary'
      onClick={props.onEdit}
      onFocus={props.onEdit}
    >
      <span class='block max-w-full truncate'>{props.text}</span>
    </button>
  );
}

/** A labeled trash action with a predictable 44-pixel pointer target. */
export function RemoveAnswerButton(props: {
  readonly label: string;
  readonly onRemove: () => void;
}) {
  return (
    <Button
      size='sm'
      square
      class='min-h-11 min-w-11'
      variant='danger-ghost'
      type='button'
      title={props.label}
      aria-label={props.label}
      onClick={props.onRemove}
    >
      <svg aria-hidden='true' viewBox='0 0 24 24' class='h-4 w-4' fill='none' stroke='currentColor'>
        <path
          d='M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7'
          stroke-width='1.5'
          stroke-linecap='round'
          stroke-linejoin='round'
        />
      </svg>
    </Button>
  );
}

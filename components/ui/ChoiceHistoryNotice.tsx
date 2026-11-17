import Button from './Button.tsx';

/** Local answer-option history stays next to the options it changes. */
export default function ChoiceHistoryNotice(props: {
  readonly message: string;
  readonly undoLabel: string;
  readonly redoLabel: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}) {
  return (
    <div class='flex flex-wrap items-center gap-2 text-sm' data-choice-history>
      <span role='status' aria-live='polite' aria-atomic='true'>{props.message}</span>
      <Button
        type='button'
        size='xs'
        variant='ghost'
        disabled={!props.canUndo}
        onClick={props.onUndo}
        data-undo-choice-removal
      >
        {props.undoLabel}
      </Button>
      <Button
        type='button'
        size='xs'
        variant='ghost'
        disabled={!props.canRedo}
        onClick={props.onRedo}
      >
        {props.redoLabel}
      </Button>
    </div>
  );
}

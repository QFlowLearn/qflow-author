import { uiEvent } from '../../lib/client/ui_event.ts';
import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import Button from './Button.tsx';
import type { AssessmentCanvasMoveBounds } from '../../lib/assessment_canvas_move.ts';

/** A scoped keyboard/drag handle and the same four move actions for mouse and touch. */
export default function QuestionMoveTools(props: {
  readonly id: string;
  readonly position: number;
  readonly bounds: AssessmentCanvasMoveBounds;
  readonly disabled: boolean;
  readonly labels: {
    readonly handle: string;
    readonly hint: string;
    readonly up: string;
    readonly down: string;
    readonly first: string;
    readonly last: string;
  };
  readonly onMove: (position: number) => Promise<void>;
  readonly onDragStart: (event: JSX.TargetedDragEvent<HTMLButtonElement>) => void;
  readonly onDragEnd: () => void;
}) {
  const [open, setOpen] = useState(false);
  function close() {
    setOpen(false);
    document.getElementById(props.id)?.focus({ preventScroll: true });
  }
  async function move(position: number) {
    close();
    if (
      props.disabled || position < props.bounds.first || position > props.bounds.last ||
      position === props.position
    ) {
      return;
    }
    await props.onMove(position);
  }
  return (
    <div
      class='relative shrink-0'
      onFocusOut={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) setOpen(false);
      }}
    >
      <Button
        id={props.id}
        type='button'
        variant='ghost'
        square
        aria-label={props.labels.handle}
        title={props.labels.handle}
        aria-describedby={`${props.id}-hint`}
        aria-disabled={props.disabled}
        aria-expanded={open}
        aria-controls={`${props.id}-actions`}
        draggable={!props.disabled}
        class='cursor-grab active:cursor-grabbing'
        onClick={() => {
          if (!props.disabled) setOpen(!open);
        }}
        onDragStart={(event) => {
          setOpen(false);
          props.onDragStart(event);
        }}
        onDragEnd={props.onDragEnd}
        onKeyDown={uiEvent(async (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
          }
          const position = event.key === 'ArrowUp'
            ? props.position - 1
            : event.key === 'ArrowDown'
            ? props.position + 1
            : event.key === 'Home'
            ? props.bounds.first
            : event.key === 'End'
            ? props.bounds.last
            : undefined;
          if (position === undefined) return;
          event.preventDefault();
          await move(position);
        })}
      >
        <svg aria-hidden='true' width='20' height='20' viewBox='0 0 20 20' fill='currentColor'>
          <circle cx='7' cy='4' r='1.5' />
          <circle cx='13' cy='4' r='1.5' />
          <circle cx='7' cy='10' r='1.5' />
          <circle cx='13' cy='10' r='1.5' />
          <circle cx='7' cy='16' r='1.5' />
          <circle cx='13' cy='16' r='1.5' />
        </svg>
      </Button>
      <span id={`${props.id}-hint`} class='sr-only'>{props.labels.hint}</span>
      {open && (
        <div
          id={`${props.id}-actions`}
          class='absolute left-0 top-full z-30 grid w-44 gap-1 rounded-lg border border-base-300 bg-base-100 p-2'
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        >
          {[
            { label: props.labels.up, position: props.position - 1 },
            { label: props.labels.down, position: props.position + 1 },
            { label: props.labels.first, position: props.bounds.first },
            { label: props.labels.last, position: props.bounds.last },
          ].map((action) => (
            <Button
              key={action.label}
              type='button'
              variant='ghost'
              disabled={props.disabled || action.position < props.bounds.first ||
                action.position > props.bounds.last || action.position === props.position}
              onClick={uiEvent(() => move(action.position))}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

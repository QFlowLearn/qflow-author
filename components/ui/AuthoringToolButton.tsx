import type { ComponentChildren } from 'preact';
import Button from './Button.tsx';

/** An icon tool with an accessible name and a tooltip on pointer hover or keyboard focus. */
export default function AuthoringToolButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly expanded?: boolean;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly children: ComponentChildren;
}) {
  return (
    <div
      class='ds-tooltip ds-tooltip-bottom flex justify-center lg:ds-tooltip-left [&:before]:max-w-28 lg:[&:before]:max-w-48 [&:before]:whitespace-normal [&:not(:hover):not(:has(:focus-visible)):before]:hidden [&:not(:hover):not(:has(:focus-visible)):after]:hidden'
      data-tip={props.label}
    >
      <Button
        type='button'
        variant={props.danger ? 'danger-ghost' : 'ghost'}
        disabled={props.disabled}
        square
        aria-label={props.label}
        aria-expanded={props.expanded}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
        }}
        onClick={props.onClick}
      >
        <span aria-hidden='true'>{props.children}</span>
      </Button>
    </div>
  );
}

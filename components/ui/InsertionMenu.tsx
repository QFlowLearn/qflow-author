import { useRef } from 'preact/hooks';
import Button from './Button.tsx';

/** Compact item menu offering explicit insertion without a pointer hover. */
export default function InsertionMenu(props: {
  readonly label: string;
  readonly beforeLabel: string;
  readonly afterLabel: string;
  readonly disabled: boolean;
  readonly onBefore: () => void;
  readonly onAfter: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  function select(action: () => void) {
    if (menu.current) menu.current.open = false;
    action();
  }
  return (
    <details
      ref={menu}
      class='ds-dropdown ds-dropdown-end absolute right-3 top-3'
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menu.current) {
          menu.current.open = false;
          menu.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        aria-label={props.label}
        class='ds-btn ds-btn-ghost ds-btn-sm ds-btn-square list-none'
      >
        •••
      </summary>
      <ul class='ds-dropdown-content ds-menu z-20 w-52 rounded-box bg-base-100 shadow-lg'>
        <li>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={props.disabled}
            onClick={() => select(props.onBefore)}
          >
            {props.beforeLabel}
          </Button>
        </li>
        <li>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={props.disabled}
            onClick={() => select(props.onAfter)}
          >
            {props.afterLabel}
          </Button>
        </li>
      </ul>
    </details>
  );
}

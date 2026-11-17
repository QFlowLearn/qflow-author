import type { ComponentChildren, RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import Button from './Button.tsx';

/** A nonmodal inspector keeps the authoring canvas mounted and returns keyboard focus. */
export default function SettingsRail(props: {
  readonly open: boolean;
  readonly id: string;
  readonly title: string;
  readonly closeLabel: string;
  readonly returnFocusRef: RefObject<HTMLElement>;
  readonly onClose: () => void;
  readonly actions?: ComponentChildren;
  readonly children: ComponentChildren;
}) {
  const rail = useRef<HTMLElement | null>(null);
  function close() {
    const ownedFocus = rail.current?.contains(document.activeElement);
    props.onClose();
    if (ownedFocus) props.returnFocusRef.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (props.open) {
      rail.current?.querySelector<HTMLButtonElement>('[data-close-settings]')?.focus();
      rail.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    } else if (rail.current?.contains(document.activeElement)) {
      props.returnFocusRef.current?.focus({ preventScroll: true });
    }
  }, [props.open]);
  return (
    <aside
      ref={rail}
      id={props.id}
      hidden={!props.open}
      aria-labelledby={`${props.id}-heading`}
      class={props.open
        ? 'flex max-h-[calc(100dvh-8rem)] w-full min-w-0 scroll-mt-24 flex-col rounded border border-base-300 bg-base-100'
        : 'hidden'}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <div class='shrink-0 space-y-3 border-b border-base-300 p-4 sm:p-5 [&>button]:w-full'>
        <div class='flex items-start justify-between gap-4'>
          <h2 id={`${props.id}-heading`} class='text-base font-semibold'>{props.title}</h2>
          <Button
            data-close-settings
            type='button'
            variant='ghost'
            size='sm'
            square
            aria-label={props.closeLabel}
            onClick={close}
          >
            <span aria-hidden='true'>✕</span>
          </Button>
        </div>
        {props.actions}
      </div>
      <div class='min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5'>{props.children}</div>
    </aside>
  );
}

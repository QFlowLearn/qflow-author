import { useDomId } from '../../lib/rendering/island_context.tsx';
import type { ComponentChildren } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Reveal formatting in a viewport-constrained group without moving the writing surface. */
export default function FormattingOverflow(props: {
  readonly label: string;
  readonly accessibleLabel: string;
  readonly children: ComponentChildren;
  readonly layout?: 'menu' | 'toolbar';
}) {
  const id = useDomId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const position = useCallback(() => {
    const button = trigger.current;
    const root = panel.current;
    if (!button || !root) return;
    const anchor = button.getBoundingClientRect();
    // Computed width is available before opening, unlike offsetWidth on a hidden popover.
    const width = Number.parseFloat(getComputedStyle(root).width);
    const height = root.offsetHeight;
    root.style.left = `${Math.max(12, Math.min(anchor.right - width, innerWidth - width - 12))}px`;
    root.style.top = `${
      anchor.bottom + height + 8 <= innerHeight - 12
        ? anchor.bottom + 8
        : Math.max(12, anchor.top - height - 8)
    }px`;
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    position();
    globalThis.addEventListener('resize', position);
    globalThis.addEventListener('scroll', position, true);
    return () => {
      globalThis.removeEventListener('resize', position);
      globalThis.removeEventListener('scroll', position, true);
    };
  }, [open, position]);
  return (
    <>
      <button
        ref={trigger}
        type='button'
        popovertarget={id}
        aria-label={props.accessibleLabel}
        aria-expanded={open}
        aria-controls={id}
        onMouseDown={(event) => event.preventDefault()}
        class='flex h-8 shrink-0 items-center gap-1 rounded px-2 text-sm text-base-content hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary'
      >
        {props.label}
        <span aria-hidden='true'>▾</span>
      </button>
      <div
        ref={panel}
        id={id}
        popover='auto'
        role='group'
        aria-label={props.accessibleLabel}
        onBeforeToggle={position}
        onToggle={() => {
          position();
          setOpen(panel.current?.matches(':popover-open') ?? false);
        }}
        onClick={(event) => {
          if (
            props.layout !== 'toolbar' && event.target instanceof Element &&
            event.target.closest('button')
          ) {
            panel.current?.hidePopover();
          }
        }}
        class={`fixed inset-auto m-0 max-h-[calc(100dvh-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-2 text-base-content ${
          props.layout === 'toolbar'
            ? 'w-96 [&_.rte-toolbar]:rounded-none [&_.rte-toolbar]:border-0 [&_.rte-toolbar]:bg-transparent [&_.rte-toolbar]:p-0'
            : 'w-60 [&>button]:w-full [&>button]:justify-start [&>button]:gap-3 [&>button]:px-3 [&>button]:py-2'
        }`}
      >
        {props.children}
      </div>
    </>
  );
}

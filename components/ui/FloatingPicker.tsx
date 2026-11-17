import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

/** A nonmodal picker beside persistent tools, with light dismissal and focus restoration. */
export default function FloatingPicker(props: {
  readonly label: string;
  readonly onClose: () => void;
  readonly trigger: HTMLElement | null;
  readonly wide?: boolean;
  readonly children: ComponentChildren;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useLayoutEffect(() => {
    const root = panel.current;
    if (!root) return;
    const trigger = props.trigger;
    const candidateTools = root.closest('[data-authoring-surface]')
      ?.querySelector('[data-authoring-tools]');
    if (!candidateTools) throw new Error('Insertion picker requires its authoring tools.');
    const toolRow = candidateTools;
    // Fixed coordinates avoid dependence on experimental CSS anchor positioning.
    function position() {
      if (!root) return;
      // A collapsed viewport has no usable placement; the next resize positions the picker.
      if (globalThis.innerWidth <= 24 || globalThis.innerHeight <= 24) return;
      const anchor = trigger?.getBoundingClientRect();
      const tools = toolRow.getBoundingClientRect();
      const narrow = globalThis.innerWidth < 1024;
      const width = Math.min(
        props.wide ? 640 : 384,
        narrow ? globalThis.innerWidth - 24 : tools.left - 20,
      );
      if (width <= 0) throw new Error('Insertion picker has no available viewport space.');
      const minimumTop = narrow ? tools.bottom + 8 : tools.top;
      const top = Math.max(minimumTop, Math.min(anchor?.top ?? 64, globalThis.innerHeight - 260));
      const left = narrow
        ? Math.max(
          12,
          Math.min(
            anchor ? anchor.right - width : globalThis.innerWidth - width - 12,
            globalThis.innerWidth - width - 12,
          ),
        )
        : tools.left - width - 8;
      root.style.width = `${width}px`;
      root.style.top = `${top}px`;
      root.style.left = `${left}px`;
      root.style.maxHeight = `${Math.min(560, globalThis.innerHeight - top - 12)}px`;
    }
    position();
    if (document.activeElement === trigger || document.activeElement === document.body) {
      const focusTarget = globalThis.innerWidth < 1024
        ? root
        : root.querySelector<HTMLElement>('[data-picker-focus], [data-focus-type-search]') ?? root;
      focusTarget.focus({
        preventScroll: true,
      });
    }
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
      if (
        event.target instanceof Node && !root?.contains(event.target) &&
        !trigger?.contains(event.target) && !toolRow.contains(event.target)
      ) close.current();
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    }
    document.addEventListener('pointerdown', dismiss);
    root.addEventListener('keydown', escape);
    globalThis.addEventListener('resize', position);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      root.removeEventListener('keydown', escape);
      globalThis.removeEventListener('resize', position);
    };
  }, [props.trigger, props.wide]);
  return (
    <div
      ref={panel}
      role='region'
      tabIndex={-1}
      aria-label={props.label}
      data-floating-picker
      class='fixed z-40 w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-xl border border-base-300 bg-base-100 p-4 shadow-xl'
    >
      {props.children}
    </div>
  );
}

import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

/** Keep a nonmodal editor tool beside its trigger and inside the viewport, above canvas clipping. */
export default function EditorToolPanel(props: {
  readonly id: string;
  readonly labelledBy: string;
  readonly trigger: HTMLElement | null;
  readonly children: ComponentChildren;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = panel.current;
    const trigger = props.trigger;
    if (!root || !trigger) return;
    root.showPopover();
    function position() {
      if (!root || !trigger) return;
      const anchor = trigger.getBoundingClientRect();
      const width = root.offsetWidth, height = root.offsetHeight;
      root.style.left = `${
        Math.max(12, Math.min(anchor.right - width, innerWidth - width - 12))
      }px`;
      root.style.top = `${
        anchor.bottom + height + 8 <= innerHeight - 12
          ? anchor.bottom + 8
          : Math.max(12, anchor.top - height - 8)
      }px`;
    }
    position();
    globalThis.addEventListener('resize', position);
    globalThis.addEventListener('scroll', position, true);
    return () => {
      globalThis.removeEventListener('resize', position);
      globalThis.removeEventListener('scroll', position, true);
      if (root.contains(document.activeElement)) trigger.focus({ preventScroll: true });
      root.hidePopover();
    };
  }, [props.trigger]);
  return (
    <div
      ref={panel}
      id={props.id}
      popover='manual'
      role='dialog'
      aria-labelledby={props.labelledBy}
      class='fixed inset-auto m-0 max-h-[calc(100dvh-1.5rem)] w-96 max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-lg border border-base-300 bg-base-100 p-4 text-sm text-base-content'
    >
      {props.children}
    </div>
  );
}

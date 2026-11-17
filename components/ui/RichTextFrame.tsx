import type { ComponentChildren } from 'preact';

/** Own the framed field and direct question-writing treatments of the shared rich-text editor. */
export default function RichTextFrame(props: {
  readonly appearance: 'field' | 'question';
  readonly class?: string;
  readonly children: ComponentChildren;
}) {
  return (
    <div
      class={`rte min-w-0 ${
        props.appearance === 'question'
          ? '[&_.rte-editor]:border-b [&_.rte-editor]:border-base-300 [&_.rte-editor]:px-1 [&_.rte-editor]:py-3 [&_.rte-editor]:text-lg [&_.rte-editor]:leading-7 [&_.rte-editor]:text-base-content [&_.rte-editor:focus]:border-secondary [&_.rte-editor:focus]:shadow-[0_1px_0_0_currentColor] [&_.rte-editor[aria-invalid=true]]:border-error'
          : 'rounded-[var(--radius-card)] border border-[var(--qf-border)] bg-[var(--card)] [box-shadow:var(--shadow-1)]'
      } ${props.class ?? ''}`}
    >
      {props.children}
    </div>
  );
}

import type { ComponentChildren } from 'preact';

/** Prominent import outcome and next steps, announced when the status changes. */
export default function ImportStatusPanel(props: {
  readonly title: string;
  readonly tone: 'info' | 'error' | 'warning';
  readonly children: ComponentChildren;
}) {
  const tone = {
    info: 'border-info/40 bg-info/10',
    error: 'border-error/40 bg-error/10',
    warning: 'border-warning/40 bg-warning/10',
  }[props.tone];
  return (
    <section class={`rounded-lg border p-5 text-base-content ${tone}`}>
      <div role='status' aria-atomic='true'>
        <h2 class='text-xl font-semibold'>{props.title}</h2>
        <div class='mt-3 max-w-prose space-y-3 leading-6'>{props.children}</div>
      </div>
    </section>
  );
}

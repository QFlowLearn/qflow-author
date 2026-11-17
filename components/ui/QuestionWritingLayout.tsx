import type { ComponentChildren } from 'preact';

/** Put the author's question first, with its presentation beside it on wider screens. */
export default function QuestionWritingLayout(props: {
  readonly children: ComponentChildren;
  readonly presentation: ComponentChildren;
}) {
  return (
    <div class='grid min-w-0 items-start gap-x-5 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto]'>
      <div class='min-w-0'>{props.children}</div>
      {props.presentation}
    </div>
  );
}

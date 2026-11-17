import type { ComponentChildren } from 'preact';

/** Common actions remain visible beside the selected question. */
export default function QuestionActionTools(props: { readonly children: ComponentChildren }) {
  return <div class='flex items-center gap-1'>{props.children}</div>;
}

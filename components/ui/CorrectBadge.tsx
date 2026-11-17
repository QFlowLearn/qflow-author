import type { ComponentChildren } from 'preact';

/** Identifies a correct answer with a green pill and a localized text label. */
export default function CorrectBadge(props: { readonly children: ComponentChildren }) {
  return (
    <span class='ds-badge ds-badge-sm shrink-0 rounded-full border-green-700 bg-green-700 font-medium text-white'>
      {props.children}
    </span>
  );
}

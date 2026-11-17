import type { ComponentChildren } from 'preact';

/** Keep localized section actions aligned and let them wrap inside the question. */
export function AuthoringSectionHeader(props: {
  readonly heading: ComponentChildren;
  readonly children: ComponentChildren;
}) {
  return (
    <div class='flex flex-wrap items-center justify-between gap-2'>
      <div class='min-w-0'>{props.heading}</div>
      <div class='ml-auto flex flex-wrap items-center justify-end gap-2'>{props.children}</div>
    </div>
  );
}

/** Fit local graphic fields to the card's available width, including beside the parts sidebar. */
export function AuthoringFieldGrid(props: {
  readonly selected: boolean;
  readonly children: ComponentChildren;
}) {
  return (
    <div
      class={`grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2 rounded-lg border border-base-200 bg-base-100 p-3 ${
        props.selected ? 'ring-1 ring-primary/40' : ''
      }`}
    >
      {props.children}
    </div>
  );
}

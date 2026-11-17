import type { ComponentChildren, RefObject } from 'preact';

/** Quiet, keyboard-operable updates; callers can return focus after removing a row. */
export function NoticePanel(props: {
  readonly summary: string;
  readonly summaryRef: RefObject<HTMLElement>;
  readonly children: ComponentChildren;
}) {
  return (
    <details class='mb-5 rounded-lg border border-base-300 bg-base-100'>
      <summary ref={props.summaryRef} class='min-h-12 cursor-pointer px-4 py-3 text-sm font-medium'>
        <span role='status'>{props.summary}</span>
      </summary>
      <div class='space-y-3 border-t border-base-200 p-4 text-sm'>{props.children}</div>
    </details>
  );
}

/** Responsive update rows keep collection names readable and actions within reach. */
export function NoticeRow(props: { readonly children: ComponentChildren }) {
  return (
    <li class='flex flex-wrap items-center gap-3 border-b border-base-200 py-3 last:border-0'>
      {props.children}
    </li>
  );
}

/** Long collection names wrap without pushing controls outside a narrow viewport. */
export function NoticeLabel(props: { readonly children: ComponentChildren }) {
  return <p class='min-w-0 basis-full break-words sm:flex-1 sm:basis-auto'>{props.children}</p>;
}

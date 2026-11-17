import type { ComponentChildren } from 'preact';

/** Reserve a notice row on narrow canvases; float beside content on wide screens. */
export default function ActionNotice(props: {
  readonly label: string;
  readonly id: string;
  readonly message: string;
  readonly detail?: string;
  readonly error?: string;
  readonly children: ComponentChildren;
}) {
  return (
    <aside
      aria-label={props.label}
      id={props.id}
      data-action-notice
      class='relative mb-4 w-full rounded-xl border border-base-300 bg-base-100 p-4 text-base-content [&_p]:text-inherit lg:fixed lg:bottom-3 lg:right-3 lg:z-30 lg:mb-0 lg:w-96'
    >
      <p class='break-words font-medium'>{props.message}</p>
      {props.detail && <p id={`${props.id}-detail`} class='mt-1 text-sm'>{props.detail}</p>}
      {props.error && (
        <p id={`${props.id}-error`} role='alert' class='mt-2 text-sm'>{props.error}</p>
      )}
      <div class='mt-3 flex flex-wrap gap-2'>{props.children}</div>
    </aside>
  );
}

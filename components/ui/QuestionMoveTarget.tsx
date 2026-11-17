import type { ComponentChildren, JSX } from 'preact';

/** Stable card wrapper; a full outline and words identify the pending drop without reparenting the editor. */
export default function QuestionMoveTarget(props: {
  readonly children: ComponentChildren;
  readonly active: boolean;
  readonly label: string;
  readonly onDragOver: (event: JSX.TargetedDragEvent<HTMLDivElement>) => void;
  readonly onDrop: (event: JSX.TargetedDragEvent<HTMLDivElement>) => Promise<void>;
}) {
  return (
    <div
      class={props.active ? 'relative rounded-xl ring-2 ring-primary' : 'relative'}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      {props.active && (
        <span class='absolute inset-x-0 top-0 z-10 rounded-t-xl bg-primary px-3 py-1 text-xs text-primary-content pointer-events-none'>
          {props.label}
        </span>
      )}
      {props.children}
    </div>
  );
}

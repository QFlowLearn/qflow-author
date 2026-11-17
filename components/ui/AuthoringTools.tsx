import type { ComponentChildren } from 'preact';

/** Reserves canvas tools below the sticky application header at every screen size. */
export default function AuthoringTools(props: {
  readonly label: string;
  readonly tools: ComponentChildren;
  readonly children: ComponentChildren;
}) {
  return (
    <div
      data-authoring-surface
      class='relative flex min-w-0 flex-col gap-3 lg:grid lg:items-start lg:grid-cols-[minmax(0,1fr)_3.5rem] [@media(min-width:1024px)_and_(max-height:450px)]:grid-cols-[minmax(0,1fr)_7rem]'
    >
      <div
        role='group'
        aria-label={props.label}
        data-authoring-tools
        class='sticky top-24 z-20 grid grid-cols-3 w-full gap-1 rounded-xl border border-base-300 bg-base-100 p-1 shadow-sm sm:flex lg:col-start-2 lg:row-start-1 lg:w-fit lg:flex-col [@media(min-width:1024px)_and_(max-height:450px)]:grid [@media(min-width:1024px)_and_(max-height:450px)]:grid-cols-2 [@media(min-width:1024px)_and_(max-height:450px)]:w-full'
      >
        {props.tools}
      </div>
      <div class='min-w-0 lg:col-start-1 lg:row-start-1'>{props.children}</div>
    </div>
  );
}

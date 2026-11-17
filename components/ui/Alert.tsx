import type { ComponentChildren } from 'preact';

const classes = {
  neutral:
    'ds-alert grid-flow-col grid-cols-[auto_1fr] items-start gap-3 border-base-300 bg-base-200 p-4 text-left text-base-content shadow-none [&_p]:text-inherit',
  info: 'ds-alert ds-alert-info [&_p]:text-inherit',
  warning: 'ds-alert ds-alert-warning [&_p]:text-inherit',
} as const;

/** Alert paragraphs inherit daisyUI's contrasting foreground instead of global muted prose. */
export default function Alert(props: {
  readonly tone: keyof typeof classes;
  readonly role?: 'status' | 'alert';
  readonly id?: string;
  readonly children: ComponentChildren;
}) {
  return (
    <div id={props.id} class={classes[props.tone]} role={props.role ?? 'status'}>
      {props.tone === 'neutral' && (
        <svg
          aria-hidden='true'
          class='h-5 w-5 shrink-0 self-start'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='1.5'
        >
          <circle cx='12' cy='12' r='9' />
          <path stroke-linecap='round' d='M12 11v6M12 7h.01' />
        </svg>
      )}
      {props.children}
    </div>
  );
}

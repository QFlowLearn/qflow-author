import type { ComponentChildren, JSX } from 'preact';

type Props = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: 'xs' | 'sm' | 'md';
};

export default function Input({ size = 'md', class: cls, type, ...rest }: Props) {
  const isFile = type === 'file';
  const classes = [
    isFile ? 'ds-file-input' : 'ds-input',
    'block',
    'w-full',
    !isFile && size === 'xs' ? 'ds-input-xs' : !isFile && size === 'sm' ? 'ds-input-sm' : '',
    cls || '',
  ].filter(Boolean).join(' ');
  return <input class={classes} type={type} {...rest} />;
}

/** Associate a localized error with its control; concealment reserves layout before announcement. */
export function FieldIssueMessage({ id, message, visible = true }: {
  readonly id: string;
  readonly message: string;
  readonly visible?: boolean;
}) {
  return (
    <span
      id={id}
      role={visible ? 'alert' : undefined}
      aria-live={visible ? 'polite' : undefined}
      aria-hidden={visible ? undefined : true}
      class={`text-xs text-error${visible ? '' : ' invisible'}`}
    >
      {message}
    </span>
  );
}

/** Align an authored input, its local details and action without stacking separate panels. */
export function AuthoringInputRow(
  { label, content, details, action, ...attributes }:
    & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'class' | 'content'>
    & {
      readonly label: string;
      readonly content: ComponentChildren;
      readonly details?: ComponentChildren;
      readonly action: ComponentChildren;
    },
) {
  return (
    <div
      {...attributes}
      data-authoring-input-row
      class='grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 sm:grid-cols-[2rem_minmax(0,1fr)_10rem_auto] sm:gap-x-3'
    >
      <span title={label} class='block min-w-0 truncate text-sm font-medium text-base-content/70'>
        {label}
      </span>
      <div class='min-w-0'>{content}</div>
      {details && (
        <div class='col-span-2 col-start-2 row-start-2 min-w-0 max-w-56 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:max-w-none'>
          {details}
        </div>
      )}
      <div class='col-start-3 row-start-1 flex items-center justify-end sm:col-start-4'>
        {action}
      </div>
    </div>
  );
}

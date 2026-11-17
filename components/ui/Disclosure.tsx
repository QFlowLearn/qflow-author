import type { ComponentChildren, JSX } from 'preact';

/** Keyboard-accessible optional details with the shared compact report treatment. */
export default function Disclosure({ summary, children, appearance = 'default', ...attributes }: {
  summary: ComponentChildren;
  children: ComponentChildren;
  appearance?: 'default' | 'quiet';
} & Omit<JSX.HTMLAttributes<HTMLDetailsElement>, 'children' | 'class'>) {
  return (
    <details
      {...attributes}
      class={appearance === 'quiet'
        ? 'border-t border-base-300'
        : 'rounded-lg border border-base-300 bg-base-100'}
    >
      <summary
        class={`min-h-12 cursor-pointer py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary ${
          appearance === 'quiet' ? '' : 'px-4'
        }`}
      >
        {summary}
      </summary>
      <div
        class={appearance === 'quiet'
          ? 'space-y-3 pb-4 text-sm'
          : 'space-y-3 border-t border-base-200 p-4 text-sm'}
      >
        {children}
      </div>
    </details>
  );
}

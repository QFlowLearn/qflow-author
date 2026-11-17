import type { JSX } from 'preact';

type Props = Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  size?: 'xs' | 'sm' | 'md';
};

export default function Select({ size = 'md', class: cls, children, ...rest }: Props) {
  const classes = [
    'ds-select',
    '',
    'peer',
    'block',
    'w-full',
    'appearance-none',
    'bg-none',
    'pe-9',
    size === 'xs' ? 'ds-select-xs' : size === 'sm' ? 'ds-select-sm' : '',
    cls || '',
  ].filter(Boolean).join(' ');
  return (
    <span class='relative block w-full'>
      <select class={classes} {...rest}>{children}</select>
      <svg
        aria-hidden='true'
        focusable='false'
        viewBox='0 0 16 16'
        class='pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/65 transition-colors peer-focus:text-base-content peer-disabled:opacity-40'
      >
        <path
          d='m4 6 4 4 4-4'
          fill='none'
          stroke='currentColor'
          stroke-linecap='round'
          stroke-linejoin='round'
          stroke-width='1.75'
        />
      </svg>
    </span>
  );
}

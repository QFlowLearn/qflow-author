import type { JSX } from 'preact';

type Props = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  size?: 'xs' | 'sm' | 'md';
  color?: 'primary' | 'secondary' | 'accent' | 'neutral';
};

export default function Range(
  { class: cls, size = 'md', color = 'primary', ...rest }: Props,
) {
  const classes = [
    'ds-range',
    `ds-range-${color}`,
    size === 'xs' ? 'ds-range-xs' : size === 'sm' ? 'ds-range-sm' : '',
    cls || '',
  ].filter(Boolean).join(' ');
  return <input type='range' class={classes} {...rest} />;
}

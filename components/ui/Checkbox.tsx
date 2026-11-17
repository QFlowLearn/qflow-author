import type { JSX } from 'preact';

type Props = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  variant?: 'checkbox' | 'toggle';
  size?: 'sm' | 'md';
};

export default function Checkbox(
  { class: cls, variant = 'checkbox', size = 'md', ...rest }: Props,
) {
  const base = variant === 'toggle' ? 'ds-toggle' : 'ds-checkbox';
  const sizeClass = size === 'sm' ? (variant === 'toggle' ? 'ds-toggle-sm' : 'ds-checkbox-sm') : '';
  const classes = [base, sizeClass, cls || ''].filter(Boolean).join(' ');
  return <input type='checkbox' class={classes} {...rest} />;
}

import type { JSX } from 'preact';

type Props = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export default function Radio({ class: cls, ...rest }: Props) {
  const classes = ['ds-radio', cls || ''].filter(Boolean).join(' ');
  return <input type='radio' class={classes} {...rest} />;
}

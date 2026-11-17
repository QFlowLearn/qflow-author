import type { JSX } from 'preact';

type ButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'size'> & {
  href?: string;
  variant?: 'default' | 'primary' | 'ghost' | 'danger-ghost' | 'text';
  size?: 'xs' | 'sm' | 'md';
  square?: boolean;
};

type AnchorExtras = Pick<
  JSX.AnchorHTMLAttributes<HTMLAnchorElement>,
  'target' | 'rel' | 'download'
>;

export default function Button(
  { href, variant = 'default', size = 'md', square = false, class: cls, ...rest }:
    & ButtonProps
    & AnchorExtras,
) {
  const classes = variant === 'text'
    ? [
      'inline-flex min-h-8 items-center rounded-sm px-1 font-normal underline decoration-base-content/40 underline-offset-4 hover:bg-base-200 hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
      cls || '',
    ].filter(Boolean).join(' ')
    : [
      'ds-btn',
      'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
      variant === 'primary' ? 'ds-btn-primary' : '',
      variant === 'ghost' || variant === 'danger-ghost' ? 'ds-btn-ghost' : '',
      variant === 'danger-ghost'
        ? 'text-base-content/70 hover:bg-error/10 hover:text-error focus-visible:text-error'
        : '',
      size === 'xs' ? 'ds-btn-xs' : size === 'sm' ? 'ds-btn-sm' : 'h-12 min-h-12',
      square ? 'ds-btn-square' : '',
      square && size === 'md' ? 'w-12' : '',
      cls || '',
    ].filter(Boolean).join(' ');
  if (href) {
    const { target, rel, download, ...anchorRest } = rest as
      & AnchorExtras
      & Partial<JSX.AnchorHTMLAttributes<HTMLAnchorElement>>;
    return (
      <a
        class={classes}
        href={href}
        target={target}
        rel={rel}
        download={download}
        {...anchorRest}
      />
    );
  }
  // oxlint-disable-next-line react/button-has-type -- This primitive forwards the caller's typed attributes, preserving native submit behavior when type is absent.
  return <button class={classes} {...rest as JSX.ButtonHTMLAttributes<HTMLButtonElement>} />;
}

import type { JSX } from 'preact';

type GoogleSignInButtonProps = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & {
  href: string;
  text: string;
};

export default function GoogleSignInButton(
  { href, text, class: cls, ...rest }: GoogleSignInButtonProps,
) {
  const classes = [
    'google-sign-in-button',
    'inline-flex h-10 items-center gap-[10px] rounded-full border border-solid px-[12px] no-underline',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8]',
    'whitespace-nowrap select-none',
    cls || '',
  ].filter(Boolean).join(' ');

  return (
    <a
      href={href}
      class={classes}
      aria-label={text}
      {...rest}
    >
      <span aria-hidden='true' class='inline-flex h-[18px] w-[18px] items-center justify-center'>
        <svg width='18' height='18' viewBox='0 0 18 18' xmlns='http://www.w3.org/2000/svg'>
          <path
            fill='#4285F4'
            d='M17.64 9.2045c0-.638-.0573-1.2518-.1636-1.8409H9v3.4818h4.8436c-.2087 1.125-.8428 2.0782-1.796 2.7155v2.2582h2.9087c1.7018-1.5664 2.6837-3.8741 2.6837-6.6146z'
          />
          <path
            fill='#34A853'
            d='M9 18c2.43 0 4.4673-.8055 5.9564-2.1809l-2.9087-2.2582c-.8055.54-1.8355.8591-3.0477.8591-2.3441 0-4.3282-1.5832-5.0359-3.7105H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z'
          />
          <path
            fill='#FBBC05'
            d='M3.9641 10.7095C3.7841 10.1695 3.6818 9.5927 3.6818 9c0-.5927.1023-1.1695.2823-1.7095V4.9582H.9573A8.9965 8.9965 0 000 9c0 1.4523.3482 2.8273.9573 4.0418l3.0068-2.3323z'
          />
          <path
            fill='#EA4335'
            d='M9 3.5795c1.3214 0 2.5077.4541 3.44 1.3459l2.5818-2.5818C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582l3.0068 2.3323C4.6718 5.1627 6.6559 3.5795 9 3.5795z'
          />
        </svg>
      </span>
      <span>{text}</span>
    </a>
  );
}

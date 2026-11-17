import AccountMenu from '../islands/AccountMenu.tsx';
import NewAssessmentButton from './NewAssessmentButton.tsx';
import Button from './ui/Button.tsx';
import { QFlowLearnLogo } from './Logo.tsx';
import type { I18n } from '../lib/i18n/messages.ts';
import type { ComponentChildren } from 'preact';
import type { I18nPayload } from '../lib/i18n/payload.ts';

type HeaderProps = {
  showAccountMenu?: boolean;
  currentPath?: string;
  i18n: I18n;
  payload: I18nPayload;
};

export default function Header(props: HeaderProps) {
  return <HeaderLayout {...props} accountMenu={<AccountMenu payload={props.payload} />} />;
}

/** Server-rendered navigation; its composition owner supplies the account tree. */
export function HeaderLayout(
  { showAccountMenu = false, currentPath = '/', i18n, accountMenu }:
    & Omit<HeaderProps, 'payload'>
    & { readonly accountMenu: ComponentChildren },
) {
  const navItems = [
    { label: i18n.t('nav.dashboard'), href: '/assessments' },
    { label: i18n.t('nav.analytics'), href: '/settings/migrations' },
    { label: i18n.t('nav.library'), href: '/items' },
  ];
  const showCreateCta = showAccountMenu && shouldShowCreateCta(currentPath);

  return (
    <header class='sticky top-0 z-30 border-b border-base-300/80 bg-base-100/95 backdrop-blur'>
      <div class='qf-shell flex min-h-16 items-center justify-between gap-5 py-2'>
        <div class='flex min-w-0 items-center gap-7'>
          <a class='inline-flex items-center py-2 no-underline' href='/'>
            <QFlowLearnLogo />
          </a>
          {showAccountMenu && (
            <nav
              class='hidden h-16 shrink-0 items-center gap-1 md:flex'
              aria-label={i18n.t('nav.primary')}
            >
              {navItems.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  aria-current={isActiveNavItem(currentPath, item.href) ? 'page' : undefined}
                  class={`qf-label inline-flex h-full whitespace-nowrap items-center border-b-2 px-3 text-[15px] transition-colors ${
                    isActiveNavItem(currentPath, item.href)
                      ? 'border-secondary text-secondary'
                      : 'border-transparent text-base-content/70 hover:text-base-content'
                  }`}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          )}
        </div>
        <div class='flex min-w-0 items-center justify-end gap-3'>
          {showCreateCta && (
            <NewAssessmentButton class='hidden sm:block' buttonClass='gap-2'>
              {i18n.t('nav.create')}
            </NewAssessmentButton>
          )}
          {showAccountMenu
            ? accountMenu
            : <Button variant='ghost' href='/login'>{i18n.t('nav.signIn')}</Button>}
        </div>
      </div>
    </header>
  );
}

function isActiveNavItem(currentPath: string, href: string) {
  if (href === '/assessments') {
    return currentPath === href || currentPath.startsWith('/assessments/');
  }
  if (href === '/items') {
    return currentPath === href || currentPath.startsWith('/items/') ||
      currentPath === '/releases' || currentPath.startsWith('/releases/');
  }
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

function shouldShowCreateCta(currentPath: string) {
  return currentPath !== '/assessments' && currentPath !== '/assessments/new' &&
    !currentPath.startsWith('/releases');
}

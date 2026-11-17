import type { I18n } from '../../lib/i18n/messages.ts';
import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';

/** Bounded page navigation with a native GET jump form that preserves the bank query. */
export function BankPagination(props: {
  readonly page: number;
  readonly pageCount: number;
  readonly pageHref: (page: number) => string;
  readonly position: 'top' | 'bottom';
  readonly i18n: I18n;
}) {
  const { page, pageCount, i18n } = props;
  if (pageCount <= 1) return null;
  const pages = [...new Set([1, pageCount, page - 1, page, page + 1])]
    .filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b);
  const params = new URLSearchParams(props.pageHref(page).split('?')[1]);
  params.delete('page');
  const inputId = `bank-page-${props.position}`;
  return (
    <nav
      class='flex flex-wrap items-center justify-between gap-3'
      aria-label={i18n.t('items.results.paginationLabel')}
    >
      <div class='flex flex-wrap items-center gap-1'>
        {page > 1
          ? (
            <Button href={props.pageHref(page - 1)} rel='prev'>
              {i18n.t('items.results.previous')}
            </Button>
          )
          : <Button disabled>{i18n.t('items.results.previous')}</Button>}
        {pages.map((value, index) => (
          <span key={value} class='inline-flex items-center gap-1'>
            {index > 0 && value - pages[index - 1] > 1 && (
              <span class='px-1' aria-hidden='true'>…</span>
            )}
            <Button
              href={props.pageHref(value)}
              variant={value === page ? 'primary' : 'ghost'}
              aria-current={value === page ? 'page' : false}
              aria-label={i18n.t('items.results.pageNumber', { page: value })}
            >
              {value}
            </Button>
          </span>
        ))}
        {page < pageCount
          ? (
            <Button href={props.pageHref(page + 1)} rel='next'>
              {i18n.t('items.results.next')}
            </Button>
          )
          : <Button disabled>{i18n.t('items.results.next')}</Button>}
      </div>
      <details>
        <summary class='cursor-pointer py-2 text-sm'>{i18n.t('items.results.goToPage')}</summary>
        <form method='get' action='/items' class='flex flex-wrap items-center gap-2 text-sm'>
          {[...params].map(([name, value]) => (
            <input key={name} type='hidden' name={name} value={value} />
          ))}
          <label htmlFor={inputId}>{i18n.t('items.results.goToPage')}</label>
          <div class='w-24'>
            <Input
              id={inputId}
              name='page'
              type='number'
              min={1}
              max={pageCount}
              step={1}
              required
              value={page}
            />
          </div>
          <Button type='submit'>{i18n.t('items.results.go')}</Button>
        </form>
      </details>
    </nav>
  );
}

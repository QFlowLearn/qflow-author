import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { listBankReleases } from '../../../services/bank_releases.ts';
import { releaseFailureStatus } from '../../../services/bank_release_preview.ts';
import { parseReleaseHistoryQuery } from '../../../banks/bank_release_history.ts';
import Button from '../../../../components/ui/Button.tsx';
import BankSectionNavigation from '../../../../components/item_bank/BankSectionNavigation.tsx';
const methods = {
  async GET(ctx) {
    const i18n = ctx.state.i18n;
    const query = parseReleaseHistoryQuery(ctx.url.searchParams);
    if (!query) return new Response(i18n.t('releases.error.invalid_input'), { status: 400 });
    const result = await listBankReleases(requireAuthContext(ctx.state), query);
    if (!result.ok) {
      return new Response(i18n.t(`releases.error.${result.code}`), {
        status: releaseFailureStatus(result.code),
      });
    }
    return ctx.render(
      <section class='space-y-5'>
        <h1 class='text-3xl font-medium'>{i18n.t('releases.title')}</h1>
        <BankSectionNavigation
          current='releases'
          questionsHref='/items'
          overviewHref='/items?view=overview'
          i18n={i18n}
        />
        <p class='max-w-prose'>{i18n.t('releases.intro')}</p>
        <Button href='/releases/new' variant='primary'>{i18n.t('releases.create')}</Button>
        {!result.value.rows.length && <p>{i18n.t('releases.empty')}</p>}
        <ul class='divide-y divide-base-300'>
          {result.value.rows.map((row) => (
            <li key={row.id} class='py-4'>
              <a class='link font-medium' href={`/releases/${row.id}`}>{row.label}</a>
              <p>
                {i18n.t(`releases.state.${row.state}`)} · {row.distribution === 'withdrawn'
                  ? i18n.t('releases.withdrawn')
                  : i18n.t('releases.available')}
              </p>
            </li>
          ))}
        </ul>
        <nav aria-label={i18n.t('releases.pages')}>
          {query.before && <Button href='/releases'>{i18n.t('releases.newest')}</Button>}
          {result.value.next && (
            <Button href={`/releases?before=${result.value.next}`}>
              {i18n.t('releases.older')}
            </Button>
          )}
        </nav>
      </section>,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const releaseListPageRoute = defineHttpRoute('/releases', { ...methods, HEAD: methods.GET });

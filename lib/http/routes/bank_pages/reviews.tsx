import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import {
  loadReviewQueue,
  parseReviewQueueQuery,
  REVIEW_QUEUE_VIEWS,
  ReviewQueueInputError,
} from '../../../services/review_queue.ts';
import { INITIAL_ITEM_DETAIL_QUERY, itemDetailHref } from '../../../item_detail_query.ts';
import Button from '../../../../components/ui/Button.tsx';
import BankSectionNavigation from '../../../../components/item_bank/BankSectionNavigation.tsx';

const methods = {
  async GET(ctx) {
    let query, queue;
    try {
      query = parseReviewQueueQuery(ctx.url.searchParams);
      queue = await loadReviewQueue(requireAuthContext(ctx.state), query);
    } catch (cause: unknown) {
      if (cause instanceof ReviewQueueInputError) {
        return new Response(ctx.state.i18n.t('items.reviews.invalidQuery'), { status: 400 });
      }
      throw cause;
    }
    if (!queue) return new Response(ctx.state.i18n.t('items.reviews.forbidden'), { status: 403 });
    const i18n = ctx.state.i18n;
    return ctx.render(
      <section class='space-y-5'>
        <h1 class='text-2xl font-semibold'>{i18n.t('items.reviews.title')}</h1>
        <BankSectionNavigation
          current='reviews'
          questionsHref='/items'
          overviewHref='/items?view=overview'
          i18n={i18n}
        />
        <p>{i18n.t('items.reviews.description')}</p>
        <nav class='flex flex-wrap gap-2' aria-label={i18n.t('items.reviews.title')}>
          {REVIEW_QUEUE_VIEWS.map((view) => (
            <Button
              key={view}
              href={`/items/reviews?view=${view}`}
              aria-current={view === query.view ? 'page' : undefined}
            >
              {i18n.t(`items.reviews.${view}`)}
            </Button>
          ))}
        </nav>
        {queue.rows.length === 0 && <p>{i18n.t('items.reviews.empty')}</p>}
        <ul class='divide-y divide-base-300'>
          {queue.rows.map((row) => (
            <li class='py-4' key={row.id}>
              <Button
                href={itemDetailHref(row.questionId, {
                  ...INITIAL_ITEM_DETAIL_QUERY,
                  comparison: row.revision > 1
                    ? { fromRevision: row.revision - 1, toRevision: row.revision }
                    : null,
                  reviewsBefore: row.revision + 1,
                  comments: { requestId: row.id, beforeCommentId: null },
                }, 'review')}
              >
                {row.title} · {i18n.t('items.detail.revisionColumn', { revision: row.revision })}
              </Button>
              <p class='text-sm'>{row.reviewer} · {i18n.t(`items.reviews.state.${row.state}`)}</p>
              {row.reason !== null && <p class='text-sm whitespace-pre-wrap'>{row.reason}</p>}
            </li>
          ))}
        </ul>
        <div class='flex gap-2'>
          {query.before && (
            <Button href={`/items/reviews?view=${query.view}`}>
              {i18n.t('items.reviews.newest')}
            </Button>
          )}
          {queue.next && (
            <Button href={`/items/reviews?view=${query.view}&before=${queue.next}`}>
              {i18n.t('items.reviews.older')}
            </Button>
          )}
        </div>
      </section>,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const bankReviewsPageRoute = defineHttpRoute('/items/reviews', {
  ...methods,
  HEAD: methods.GET,
});

import { mountIsland } from '../../lib/rendering/mount_island.ts';
import Button from '../ui/Button.tsx';
import Textarea from '../ui/Textarea.tsx';
import QuestionRevisionHistoryView from '../QuestionRevisionHistory.tsx';
import QtiItemPreviewView from '../../islands/QtiItemPreview.tsx';
import MemberPickerView from '../../islands/MemberPicker.tsx';
import type { QuestionBankItemDetail } from '../../lib/services/question_bank_read.ts';
import type { QuestionReviewWorkspace } from '../../lib/services/question_reviews.ts';
import type { QuestionRevisionHistory } from '../../lib/services/questions.ts';
import type { QuestionVersionChange } from '../../lib/question_version_comparison.ts';
import { BankAlert, BankBadge, formatBankDate, ReviewStateBadge } from './ui.tsx';
import { RevisionComparison } from './RevisionComparison.tsx';
import { itemDetailHref, type ItemDetailQuery } from '../../lib/item_detail_query.ts';
import type { I18nPayload } from '../../lib/i18n/payload.ts';
import { createI18n } from '../../lib/i18n/messages.ts';
import type { QflowPlayerMessageCatalog } from '../../lib/i18n/player_messages/types.ts';

export type ItemBankDetailViewData = {
  readonly query: ItemDetailQuery;
  readonly id: string;
  readonly xml: string;
  readonly title: string;
  readonly history: QuestionRevisionHistory;
  readonly detail: QuestionBankItemDetail;
  readonly reviews: QuestionReviewWorkspace;
  readonly currentUserId: string;
  readonly canManageContent: boolean;
  readonly comparison: {
    readonly fromRevision: number;
    readonly toRevision: number;
    readonly changes: readonly QuestionVersionChange[];
    readonly beforeXml: string;
    readonly afterXml: string;
  } | null;
  readonly notice: string | null;
  readonly error: string | null;
  readonly previewPayload: I18nPayload;
  readonly memberPickerPayload: I18nPayload;
  readonly playerCatalog: QflowPlayerMessageCatalog;
};

/** Render already-localized detail feedback without interpreting route tokens. */
export function ItemDetailFeedbackAlerts(
  { notice, error }: { readonly notice: string | null; readonly error: string | null },
) {
  return (
    <>
      {notice && <BankAlert tone='success'>{notice}</BankAlert>}
      {error && <BankAlert tone='error'>{error}</BankAlert>}
    </>
  );
}

export default function ItemBankDetailView(data: ItemBankDetailViewData) {
  const i18n = createI18n(data.memberPickerPayload.locale, data.memberPickerPayload.namespaces);
  return (
    <section class='space-y-5'>
      <div class='flex flex-wrap items-center justify-between gap-3'>
        <Button href={data.query.bankHref ?? '/items'}>
          <span aria-hidden='true'>←</span>
          {i18n.t('items.detail.back')}
        </Button>
        <Button href='/items/reviews' variant='ghost'>{i18n.t('items.reviews.title')}</Button>
      </div>
      <header class='flex flex-wrap items-start justify-between gap-4'>
        <div class='min-w-0'>
          <div class='mt-2 flex flex-wrap items-center gap-2'>
            <h1 class='min-w-0 break-words text-3xl font-medium leading-tight tracking-tight'>
              {data.title}
            </h1>
            <ReviewStateBadge state={data.detail.reviewState} i18n={i18n} />
            {data.detail.lifecycle === 'archived' && (
              <BankBadge>{i18n.t('items.detail.archived')}</BankBadge>
            )}
          </div>
          <p class='mt-1 text-sm text-base-content/65'>
            {i18n.t('items.detail.questionType', { type: data.detail.type })} ·{' '}
            {i18n.t('items.results.revision', { revision: data.detail.revision })} · {i18n.t(
              {
                Authored: 'items.detail.originAuthored',
                Imported: 'items.detail.originImported',
                Variant: 'items.detail.originVariant',
              }[data.detail.origin],
            )}
          </p>
        </div>
        <div class='flex flex-wrap gap-2'>
          {data.canManageContent && data.detail.lifecycle === 'active' && (
            <Button href={`/items/${data.id}/edit`} variant='primary'>
              {i18n.t('items.detail.createRevision')}
            </Button>
          )}
          <Button
            href={`data:application/xml;charset=utf-8,${encodeURIComponent(data.xml)}`}
            download={`item-${data.id}-r${data.detail.revision}.xml`}
          >
            {i18n.t('items.detail.download')}
          </Button>
        </div>
      </header>

      <ItemDetailFeedbackAlerts notice={data.notice} error={data.error} />

      <div class='grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]'>
        <main class='min-w-0 space-y-5'>
          <QtiItemPreview
            xml={data.xml}
            title={data.title}
            mode='snapshot'
            payload={data.previewPayload}
            playerCatalog={data.playerCatalog}
          />

          <RevisionComparison data={data} i18n={i18n} />

          <details
            id='review'
            class='border-t border-base-300 py-3'
            open={Boolean(data.error || data.query.comments || data.query.reviewsBefore)}
          >
            <summary class='min-h-11 cursor-pointer py-2 text-sm font-medium'>
              {data.reviews.requests.length === 0 && data.canManageContent
                ? i18n.t('items.detail.requestReview')
                : i18n.t('items.detail.review')}
              {data.detail.reviewState === 'open' && data.reviews.requests[0] && (
                <span class='ml-2 text-base-content/80'>
                  {i18n.t('items.detail.assignedTo', {
                    name: data.reviews.requests[0].reviewer.label,
                  })}
                </span>
              )}
            </summary>
            <div class='space-y-4 pt-3'>
              {data.detail.reviewState === 'not_requested' && data.canManageContent && (
                <form
                  method='post'
                  class='flex max-w-xl flex-wrap items-end gap-3'
                >
                  <input type='hidden' name='action' value='request_review' />
                  <MemberPicker
                    name='reviewerUserId'
                    label={i18n.t('items.detail.reviewer', { revision: data.detail.revision })}
                    payload={data.memberPickerPayload}
                  />
                  <label class='flex flex-col w-full gap-1'>
                    <span>{i18n.t('items.detail.reviewNote')}</span>
                    <Textarea name='changeReason' maxLength={4000} rows={2} />
                  </label>
                  <Button type='submit' variant='primary'>
                    {i18n.t('items.detail.requestReview')}
                  </Button>
                </form>
              )}
              {data.reviews.requests.length === 0
                ? <p class='text-sm text-base-content/65'>{i18n.t('items.detail.noReview')}</p>
                : data.reviews.requests.map((request) => (
                  <article key={request.id} class='space-y-4 rounded-lg border border-base-300 p-4'>
                    <div class='flex flex-wrap items-start justify-between gap-2'>
                      <div>
                        <p class='font-medium'>
                          {i18n.t('items.results.revision', { revision: request.revision })}
                        </p>
                        <p class='text-sm text-base-content/65'>
                          {i18n.t('items.detail.assignedTo', { name: request.reviewer.label })}
                        </p>
                      </div>
                      <ReviewStateBadge state={request.state} i18n={i18n} />
                      {request.approvalIndependence && (
                        <BankBadge>
                          {i18n.t(`items.reviews.${request.approvalIndependence}`)}
                        </BankBadge>
                      )}
                    </div>
                    {request.changeReason !== null && (
                      <p class='whitespace-pre-wrap text-sm'>
                        <strong>{i18n.t('items.detail.changeReason')}:</strong>
                        {request.changeReason}
                      </p>
                    )}
                    {request.decisionNote && (
                      <div class='rounded-lg bg-base-200/60 px-3 py-2 text-sm'>
                        {request.decisionNote}
                      </div>
                    )}
                    {request.comments.length > 0 && (
                      <ol class='space-y-3'>
                        {request.comments.map((comment) => (
                          <li key={comment.id} class='border-s-2 border-base-300 ps-3'>
                            <div class='flex flex-wrap gap-2 text-xs text-base-content/60'>
                              <span class='font-medium text-base-content/80'>
                                {comment.author.label}
                              </span>
                              {formatBankDate(comment.createdAt, i18n)}
                            </div>
                            <p class='mt-1 whitespace-pre-wrap text-sm'>{comment.body}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                    {(request.beforeCommentId !== null || request.nextBeforeCommentId !== null) && (
                      <nav
                        class='flex flex-wrap gap-2'
                        aria-label={i18n.t('items.detail.commentsFor', {
                          revision: request.revision,
                        })}
                      >
                        {request.beforeCommentId !== null && (
                          <Button
                            href={reviewCommentPageHref(data, request.id)}
                            size='sm'
                          >
                            {i18n.t('items.detail.latestComments')}
                          </Button>
                        )}
                        {request.nextBeforeCommentId !== null && (
                          <Button
                            href={reviewCommentPageHref(
                              data,
                              request.id,
                              request.nextBeforeCommentId,
                            )}
                            size='sm'
                          >
                            {i18n.t('items.detail.olderComments')}
                          </Button>
                        )}
                      </nav>
                    )}
                    {data.canManageContent && (
                      <form method='post' class='space-y-2'>
                        <input type='hidden' name='action' value='comment' />
                        <input type='hidden' name='requestId' value={request.id} />
                        <label class='flex flex-col gap-1'>
                          <span class='text-xs font-medium text-base-content/70'>
                            {i18n.t('items.detail.addComment')}
                          </span>
                          <Textarea name='comment' rows={2} maxlength={4000} required />
                        </label>
                        <Button type='submit' size='sm'>{i18n.t('items.detail.comment')}</Button>
                      </form>
                    )}
                    {data.canManageContent && request.state === 'open' &&
                      request.reviewer.userId === data.currentUserId && (
                      <form method='post' class='space-y-2 rounded-lg bg-base-200/45 p-3'>
                        <input type='hidden' name='requestId' value={request.id} />
                        <label class='flex flex-col gap-1'>
                          <span class='text-xs font-medium text-base-content/70'>
                            {i18n.t('items.detail.decisionNote')}
                          </span>
                          <Textarea
                            name='decisionNote'
                            rows={2}
                            maxlength={4000}
                            placeholder={i18n.t('items.detail.changesPlaceholder')}
                          />
                        </label>
                        <div class='flex flex-wrap gap-2'>
                          <Button type='submit' name='action' value='approve' variant='primary'>
                            {i18n.t('items.detail.approve')}
                          </Button>
                          <Button type='submit' name='action' value='changes_requested'>
                            {i18n.t('items.detail.requestChanges')}
                          </Button>
                        </div>
                      </form>
                    )}
                  </article>
                ))}
              {(data.reviews.beforeRevision !== null ||
                data.reviews.nextBeforeRevision !== null) && (
                <nav class='flex flex-wrap gap-2' aria-label={i18n.t('items.detail.reviewHistory')}>
                  {data.reviews.beforeRevision !== null && (
                    <Button
                      href={itemDetailHref(data.id, {
                        ...data.query,
                        reviewsBefore: null,
                        comments: null,
                      }, 'review')}
                      size='sm'
                    >
                      {i18n.t('items.detail.latestReviews')}
                    </Button>
                  )}
                  {data.reviews.nextBeforeRevision !== null && (
                    <Button
                      href={itemDetailHref(data.id, {
                        ...data.query,
                        reviewsBefore: data.reviews.nextBeforeRevision,
                        comments: null,
                      }, 'review')}
                      size='sm'
                    >
                      {i18n.t('items.detail.olderReviews')}
                    </Button>
                  )}
                </nav>
              )}
            </div>
          </details>

          <QuestionRevisionHistoryView
            history={data.history}
            i18n={i18n}
            query={data.query}
            restoration={data.canManageContent && data.detail.lifecycle === 'active'
              ? {
                latestRevisionId: data.reviews.latestRevisionId,
                latestRevision: data.detail.revision,
              }
              : null}
          />

          <details class='ds-card ds-card-border'>
            <summary class='cursor-pointer px-5 py-4 font-medium'>
              {i18n.t('items.detail.canonicalSource')}
            </summary>
            <div class='px-5 pb-5'>
              <pre class='overflow-auto rounded-lg border border-base-300 bg-base-200/40 p-4 text-xs'>{data.xml}</pre>
            </div>
          </details>
        </main>

        <aside class='space-y-4 xl:sticky xl:top-4 xl:self-start'>
          <section class='ds-card ds-card-border'>
            <div class='ds-card-body gap-4 p-4'>
              <h2 class='font-medium'>{i18n.t('items.detail.bankDetails')}</h2>
              <dl class='grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm'>
                <dt class='text-base-content/60'>{i18n.t('items.detail.owner')}</dt>
                <dd>{data.detail.owner.label}</dd>
                <dt class='text-base-content/60'>{i18n.t('items.detail.source')}</dt>
                <dd>
                  {i18n.t(
                    {
                      Authored: 'items.detail.originAuthored',
                      Imported: 'items.detail.originImported',
                      Variant: 'items.detail.originVariant',
                    }[data.detail.origin],
                  )}
                </dd>
                <dt class='text-base-content/60'>{i18n.t('items.detail.state')}</dt>
                <dd>
                  {i18n.t(
                    data.detail.lifecycle === 'active'
                      ? 'items.detail.lifecycleActive'
                      : 'items.detail.lifecycleArchived',
                  )}
                </dd>
                <dt class='text-base-content/60'>{i18n.t('items.detail.updated')}</dt>
                <dd>{formatBankDate(data.detail.updatedAt, i18n)}</dd>
              </dl>
              {(data.detail.tags.length > 0 || data.detail.standards.length > 0) && (
                <div class='flex flex-wrap gap-1.5'>
                  {data.detail.tags.map((tag) => <BankBadge key={tag}>{tag}</BankBadge>)}
                  {data.detail.standards.map((standard) => (
                    <BankBadge key={standard.id}>{standard.label}</BankBadge>
                  ))}
                </div>
              )}
              {data.canManageContent && (
                <div class='space-y-3 border-t border-base-300 pt-3'>
                  <details>
                    <summary class='min-h-11 cursor-pointer py-2 text-sm font-medium'>
                      {i18n.t('items.detail.transfer')}
                    </summary>
                    <form method='post' class='space-y-2 pt-2'>
                      <input type='hidden' name='action' value='transfer' />
                      <MemberPicker
                        name='ownerUserId'
                        label={i18n.t('items.detail.transferOwnership')}
                        payload={data.memberPickerPayload}
                        initialSelection={{
                          userId: data.detail.owner.userId,
                          displayName: null,
                          label: data.detail.owner.label,
                        }}
                      />
                      <Button type='submit' size='sm'>{i18n.t('items.detail.transfer')}</Button>
                    </form>
                  </details>
                  <form method='post'>
                    <Button
                      type='submit'
                      name='action'
                      value={data.detail.lifecycle === 'active' ? 'archive' : 'restore'}
                      size='sm'
                      variant={data.detail.lifecycle === 'active' ? 'danger-ghost' : 'default'}
                    >
                      {data.detail.lifecycle === 'active'
                        ? i18n.t('items.detail.archive')
                        : i18n.t('items.detail.restore')}
                    </Button>
                  </form>
                </div>
              )}
            </div>
          </section>

          {data.detail.duplicateItems.length > 0 && (
            <section class='ds-card ds-card-border border-warning/45'>
              <div class='ds-card-body gap-3 p-4'>
                <div>
                  <h2 class='font-medium'>{i18n.t('items.detail.exactDuplicates')}</h2>
                  <p class='text-xs text-base-content/60'>{i18n.t('items.detail.duplicateHelp')}</p>
                  {data.detail.duplicateItemCount > data.detail.duplicateItems.length && (
                    <p class='text-xs text-base-content/60'>
                      {i18n.t('items.detail.showingDuplicates', {
                        shown: data.detail.duplicateItems.length,
                        total: data.detail.duplicateItemCount,
                      })}
                    </p>
                  )}
                </div>
                <ul class='space-y-2 text-sm'>
                  {data.detail.duplicateItems.map((item) => (
                    <li key={item.id}>
                      <a class='hover:underline' href={`/items/${item.id}`}>{item.title}</a>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}

function reviewCommentPageHref(
  data: ItemBankDetailViewData,
  requestId: string,
  beforeCommentId?: string,
): string {
  return itemDetailHref(data.id, {
    ...data.query,
    comments: { requestId, beforeCommentId: beforeCommentId ?? null },
  }, 'review');
}

const QtiItemPreview = mountIsland({ component: 'QtiItemPreview', View: QtiItemPreviewView });
const MemberPicker = mountIsland({ component: 'MemberPicker', View: MemberPickerView });

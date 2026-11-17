import { mountIsland } from '../lib/rendering/mount_island.ts';
import LocalizedTimestampView from '../islands/LocalizedTimestamp.tsx';
import {
  INITIAL_ITEM_DETAIL_QUERY,
  itemDetailHref,
  type ItemDetailQuery,
} from '../lib/item_detail_query.ts';
import Input from './ui/Input.tsx';
import type {
  QuestionRevisionHistory,
  QuestionRevisionHistoryEntry,
} from '../lib/services/questions.ts';
import type { ComponentChildren } from 'preact';
import type {
  ImportedQuestionAssistance,
  QuestionActorSnapshot,
  QuestionOrigin,
  QuestionProvenanceReview,
} from '../lib/question_provenance.ts';
import type { EvidenceAnchor } from '../lib/conversion/source_model.ts';
import Button from './ui/Button.tsx';
import type { I18n } from '../lib/i18n/messages.ts';

/** Render the workspace-owned source, assistance, review, and revision record for one item. */
export default function QuestionRevisionHistoryView(
  { history, i18n, query = INITIAL_ITEM_DETAIL_QUERY, restoration = null }: {
    readonly history: QuestionRevisionHistory | null;
    readonly i18n: I18n;
    readonly query?: ItemDetailQuery;
    readonly restoration?:
      | { readonly latestRevisionId: string; readonly latestRevision: number }
      | null;
  },
) {
  return (
    <section aria-labelledby='item-history-heading' class='ds-card ds-card-border'>
      <div class='ds-card-body gap-0 p-0'>
        <div class='border-b border-base-300 px-5 py-4'>
          <h2 id='item-history-heading' class='text-xl font-medium'>
            {i18n.t('items.detail.history')}
          </h2>
          <p class='mt-1 max-w-3xl text-sm leading-6 text-base-content/70'>
            {i18n.t('items.detail.historyDescription')}
          </p>
        </div>
        {!history
          ? (
            <p class='px-5 py-6 text-sm text-base-content/70'>
              {i18n.t('items.detail.noHistory')}
            </p>
          )
          : (
            <>
              <div class='border-b border-base-300 px-5 py-5'>
                <h3 class='text-base font-semibold'>{i18n.t('items.detail.originHeading')}</h3>
                <div class='mt-4'>
                  <OriginSummary
                    origin={history.origin}
                    createdBy={history.createdBy}
                    i18n={i18n}
                  />
                </div>
              </div>
              <div>
                <h3 class='border-b border-base-300 px-5 py-4 text-base font-semibold'>
                  {i18n.t('items.detail.revisionsHeading')}
                </h3>
                <ol class='divide-y divide-base-300' reversed>
                  {history.revisions.map((revision) => (
                    <li key={revision.id} class='px-5 py-5'>
                      <RevisionHistoryEntry revision={revision} i18n={i18n} />
                      {restoration && revision.revision < restoration.latestRevision && (
                        <details class='mt-3'>
                          <summary class='cursor-pointer py-2 font-medium'>
                            {i18n.t('items.detail.restoreEarlier')}
                          </summary>
                          <p class='my-2 text-sm'>
                            {i18n.t('items.detail.restoreHelp', {
                              source: revision.revision,
                              next: restoration.latestRevision + 1,
                            })}
                          </p>
                          <form
                            method='post'
                            action={itemDetailHref(
                              history.questionId,
                              query,
                              'item-history-heading',
                            )}
                          >
                            <Input type='hidden' name='action' value='restore_revision' />
                            <Input
                              type='hidden'
                              name='sourceRevision'
                              value={String(revision.revision)}
                            />
                            <Input
                              type='hidden'
                              name='expectedLatestRevisionId'
                              value={restoration.latestRevisionId}
                            />
                            <Button type='submit'>{i18n.t('items.detail.restoreAsNew')}</Button>
                          </form>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
                {(history.beforeRevision !== null || history.nextBeforeRevision !== null) && (
                  <nav
                    class='flex flex-wrap gap-2 border-t border-base-300 px-5 py-4'
                    aria-label={i18n.t('items.detail.historyPages')}
                  >
                    {history.beforeRevision !== null && (
                      <Button
                        size='sm'
                        href={itemDetailHref(
                          history.questionId,
                          { ...query, historyBefore: null },
                          'item-history-heading',
                        )}
                      >
                        {i18n.t('items.detail.latestRevisions')}
                      </Button>
                    )}
                    {history.nextBeforeRevision !== null && (
                      <Button
                        size='sm'
                        href={itemDetailHref(history.questionId, {
                          ...query,
                          historyBefore: history.nextBeforeRevision,
                        }, 'item-history-heading')}
                      >
                        {i18n.t('items.detail.olderRevisions')}
                      </Button>
                    )}
                  </nav>
                )}
              </div>
            </>
          )}
      </div>
    </section>
  );
}

function RevisionHistoryEntry(
  { revision, i18n }: { readonly revision: QuestionRevisionHistoryEntry; readonly i18n: I18n },
) {
  const { event } = revision;
  const timestamp = revision.draftState === 'published' ? revision.publishedAt : revision.createdAt;
  return (
    <article aria-labelledby={`revision-${revision.revision}-heading`} class='space-y-4'>
      <div class='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h4 id={`revision-${revision.revision}-heading`} class='text-base font-semibold'>
            {i18n.t('items.results.revision', { revision: revision.revision })}
          </h4>
          {event.operation === 'restored' && (
            <p>{i18n.t('items.detail.restoredFrom', { revision: event.restoredFromRevision })}</p>
          )}
          <p class='mt-1 text-sm text-base-content/70'>
            {i18n.t(
              ({
                created: 'items.detail.created',
                revised: 'items.detail.revised',
                transformed: 'items.detail.transformed',
                restored: 'items.detail.restoredRevision',
              } as const)[event.operation],
            )}
          </p>
        </div>
        <span class='rounded-full border border-base-300 px-2.5 py-1 text-xs font-medium capitalize'>
          {i18n.t(
            revision.draftState === 'published'
              ? 'items.detail.statePublished'
              : 'items.detail.stateDraft',
          )}
        </span>
      </div>

      <dl class='grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3'>
        <HistoryFact
          term={i18n.t(
            revision.draftState === 'published'
              ? 'items.detail.publishedBy'
              : 'items.detail.savedBy',
          )}
          detail={actorLabel(event.author)}
        />
        <HistoryFact
          term={i18n.t(
            revision.draftState === 'published'
              ? 'items.detail.publishedOn'
              : 'items.detail.savedOn',
          )}
          detail={formatTimestamp(timestamp, i18n)}
        />
        <HistoryFact
          term={i18n.t('items.detail.parentRevision')}
          detail={event.parentRevision
            ? (
              <a
                class='font-medium text-primary underline-offset-4 hover:underline focus-visible:underline'
                href={`/items/${revision.questionId}/r/${event.parentRevision}`}
              >
                {i18n.t('items.results.revision', { revision: event.parentRevision })}
              </a>
            )
            : i18n.t('items.detail.none')}
        />
      </dl>

      {revision.note
        ? (
          <div class='border-l-2 border-base-300 pl-3 text-sm leading-6'>
            <span class='font-medium'>{i18n.t('items.detail.revisionNote')}</span> {revision.note}
          </div>
        )
        : null}
    </article>
  );
}

function OriginSummary(
  { origin, createdBy, i18n }: {
    readonly origin: QuestionOrigin;
    readonly createdBy: QuestionActorSnapshot;
    readonly i18n: I18n;
  },
) {
  if (origin._tag === 'Authored') {
    return (
      <div class='grid gap-5 lg:grid-cols-2'>
        <div class='space-y-2'>
          <h4 class='text-sm font-semibold'>{i18n.t('items.detail.originSource')}</h4>
          <p class='text-sm leading-6 text-base-content/80'>
            {i18n.t('items.detail.authoredOrigin', { name: actorLabel(createdBy) })}
          </p>
        </div>
        <div class='space-y-2'>
          <h4 class='text-sm font-semibold'>{i18n.t('items.detail.authoringMethod')}</h4>
          <AssistanceFacts assistance={null} i18n={i18n} />
        </div>
      </div>
    );
  }
  if (origin._tag === 'Variant') {
    return (
      <div class='grid gap-5 lg:grid-cols-2'>
        <div class='space-y-2'>
          <h4 class='text-sm font-semibold'>{i18n.t('items.detail.variantLineage')}</h4>
          <p class='text-sm leading-6 text-base-content/80'>
            <a
              class='font-medium text-primary underline-offset-4 hover:underline focus-visible:underline'
              href={`/items/${origin.source.questionId}/r/${origin.source.revision}`}
            >
              {i18n.t('items.detail.variantCreatedFrom', {
                revision: origin.source.revision,
                id: origin.source.questionId,
              })}
            </a>
          </p>
        </div>
        <div class='space-y-2'>
          <h4 class='text-sm font-semibold'>{i18n.t('items.detail.transformation')}</h4>
          <dl class='space-y-2 text-sm'>
            <HistoryFact
              term={i18n.t('items.detail.method')}
              detail={i18n.t(
                origin.transformation.kind === 'construct_preserving_variant'
                  ? 'items.detail.constructVariant'
                  : 'items.detail.compatibleTransform',
              )}
            />
            <HistoryFact
              term={i18n.t('items.detail.sourceType')}
              detail={i18n.t('items.detail.questionType', { type: origin.transformation.fromType })}
            />
            <HistoryFact
              term={i18n.t('items.detail.variantType')}
              detail={i18n.t('items.detail.questionType', { type: origin.transformation.toType })}
            />
            <HistoryFact term={i18n.t('items.detail.createdBy')} detail={actorLabel(createdBy)} />
          </dl>
        </div>
      </div>
    );
  }
  return (
    <div class='space-y-4'>
      <div class='grid gap-5 lg:grid-cols-2'>
        <div class='space-y-2'>
          <h4 class='text-sm font-semibold'>{i18n.t('items.detail.originSource')}</h4>
          <dl class='space-y-2 text-sm'>
            <HistoryFact
              term={i18n.t('items.detail.sourceFile')}
              detail={
                <a
                  class='font-medium text-primary underline-offset-4 hover:underline focus-visible:underline'
                  href={`/imports/${origin.migrationRunId}/artifacts/${origin.artifact.id}`}
                >
                  {origin.artifact.filename}
                </a>
              }
            />
            <HistoryFact term={i18n.t('items.detail.fileType')} detail={origin.artifact.mimeType} />
            <HistoryFact term={i18n.t('items.detail.sourcePath')} detail={origin.href} />
            <HistoryFact
              term={i18n.t('items.detail.providedBy')}
              detail={actorLabel(origin.providedBy)}
            />
            <HistoryFact
              term={i18n.t('items.detail.sha256')}
              detail={
                <code
                  class='text-xs'
                  title={origin.artifact.sha256}
                  aria-label={origin.artifact.sha256}
                >
                  {origin.artifact.sha256.slice(0, 12)}…{origin.artifact.sha256.slice(-8)}
                </code>
              }
            />
          </dl>
        </div>
        <div class='space-y-2'>
          <h4 class='text-sm font-semibold'>{i18n.t('items.detail.authoringMethod')}</h4>
          <AssistanceFacts assistance={origin.assistance} i18n={i18n} />
        </div>
      </div>
      <div class='border-t border-base-300 pt-4'>
        <h4 class='text-sm font-semibold'>{i18n.t('items.detail.acceptedReview')}</h4>
        <div class='mt-2 text-sm leading-6 text-base-content/80'>
          <ReviewSummary review={origin.review} i18n={i18n} />
        </div>
      </div>
      {origin.evidence.length > 0
        ? (
          <details class='border-t border-base-300 pt-4'>
            <summary class='cursor-pointer text-sm font-semibold'>
              {i18n.t('items.detail.sourceEvidence', { count: origin.evidence.length })}
            </summary>
            <ul class='mt-3 space-y-3'>
              {origin.evidence.map((evidence, index) => (
                <li key={`${evidence.kind}-${index}`} class='text-sm'>
                  <EvidenceSummary evidence={evidence} i18n={i18n} />
                </li>
              ))}
            </ul>
          </details>
        )
        : null}
    </div>
  );
}

function HistoryFact(
  { term, detail }: { readonly term: string; readonly detail: ComponentChildren },
) {
  return (
    <div>
      <dt class='text-xs font-medium uppercase tracking-wide text-base-content/70'>{term}</dt>
      <dd class='mt-0.5 break-words text-base-content/90'>{detail}</dd>
    </div>
  );
}

function AssistanceFacts(
  { assistance, i18n }: {
    readonly assistance: ImportedQuestionAssistance | null;
    readonly i18n: I18n;
  },
) {
  if (!assistance) {
    return (
      <p class='text-sm leading-6 text-base-content/80'>
        {i18n.t('items.detail.writtenInQflow')}
      </p>
    );
  }
  if (assistance._tag === 'DeterministicImport') {
    return (
      <dl class='space-y-2 text-sm'>
        <HistoryFact
          term={i18n.t('items.detail.method')}
          detail={i18n.t('items.detail.deterministicConversion')}
        />
        <HistoryFact term={i18n.t('items.detail.adapter')} detail={assistance.adapter.label} />
        <HistoryFact
          term={i18n.t('items.detail.adapterVersion')}
          detail={assistance.adapter.version}
        />
      </dl>
    );
  }
  return (
    <dl class='space-y-2 text-sm'>
      <HistoryFact
        term={i18n.t('items.detail.method')}
        detail={i18n.t('items.detail.aiGeneration')}
      />
      <HistoryFact
        term={i18n.t('items.detail.provider')}
        detail={providerLabel(assistance.generation.provider)}
      />
      <HistoryFact
        term={i18n.t('items.detail.model')}
        detail={<code class='text-xs'>{assistance.generation.model}</code>}
      />
      <HistoryFact
        term={i18n.t('items.detail.mode')}
        detail={i18n.t(
          assistance.generation.mode === 'fast'
            ? 'items.detail.modeFast'
            : 'items.detail.modeThorough',
        )}
      />
      <HistoryFact
        term={i18n.t('items.detail.generationJob')}
        detail={<code class='break-all text-xs'>{assistance.jobId}</code>}
      />
      <HistoryFact
        term={i18n.t('items.detail.promptVersion')}
        detail={<code class='text-xs'>{assistance.generation.promptVersion}</code>}
      />
    </dl>
  );
}

function ReviewSummary(
  { review, i18n }: { readonly review: QuestionProvenanceReview; readonly i18n: I18n },
) {
  return (
    <>
      <p>
        {i18n.rich('items.detail.reviewAcceptedByOn', {
          name: actorLabel(review.reviewer),
          date: formatTimestamp(review.reviewedAt, i18n),
        })}
      </p>
      {review.note
        ? (
          <p class='mt-1 text-base-content/70'>
            {i18n.t('items.detail.reviewNoteWithText', { note: review.note })}
          </p>
        )
        : null}
      <details class='mt-1'>
        <summary class='cursor-pointer text-xs font-medium text-base-content/70'>
          {i18n.t('items.detail.reviewedHashes')}
        </summary>
        <dl class='mt-2 space-y-2'>
          <HistoryFact
            term={i18n.t('items.detail.contentHash')}
            detail={<code class='break-all text-xs'>{review.contentHash}</code>}
          />
          <HistoryFact
            term={i18n.t('items.detail.contextHash')}
            detail={<code class='break-all text-xs'>{review.contextHash}</code>}
          />
        </dl>
      </details>
    </>
  );
}

function EvidenceSummary(
  { evidence, i18n }: { readonly evidence: EvidenceAnchor; readonly i18n: I18n },
) {
  const quote = evidence.kind === 'package_entry' ? null : evidence.quote;
  return (
    <div class='border-l-2 border-base-300 pl-3'>
      <p class='font-medium'>{evidenceLocation(evidence, i18n)}</p>
      {quote
        ? <blockquote class='mt-1 leading-6 text-base-content/70'>“{quote}”</blockquote>
        : null}
    </div>
  );
}

function evidenceLocation(evidence: EvidenceAnchor, i18n: I18n): string {
  switch (evidence.kind) {
    case 'text_range':
      return i18n.t('items.detail.evidenceTextRange', { start: evidence.start, end: evidence.end });
    case 'block':
      return i18n.t('items.detail.evidenceBlock', { id: evidence.blockId });
    case 'page':
      return i18n.t('items.detail.evidencePage', { page: evidence.page });
    case 'package_entry':
      return evidence.identifier ? `${evidence.path} (${evidence.identifier})` : evidence.path;
  }
}

function actorLabel(actor: QuestionActorSnapshot): string {
  return actor.displayName?.trim() || actor.email;
}

function providerLabel(
  provider: Extract<ImportedQuestionAssistance, { readonly _tag: 'AiGenerated' }>['generation'][
    'provider'
  ],
): string {
  return provider === 'openrouter_chat_completions' ? 'OpenRouter' : 'Cloudflare Workers AI';
}

function formatTimestamp(value: string, i18n: I18n) {
  if (!Number.isFinite(new Date(value).getTime())) return i18n.t('items.detail.unavailable');
  return <LocalizedTimestamp value={value} locale={i18n.locale} />;
}

const LocalizedTimestamp = mountIsland({
  component: 'LocalizedTimestamp',
  View: LocalizedTimestampView,
});

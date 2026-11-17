import { mountIsland } from '../../lib/rendering/mount_island.ts';
import LocalizedTimestampView from '../../islands/LocalizedTimestamp.tsx';
import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';
import Select from '../ui/Select.tsx';
import Textarea from '../ui/Textarea.tsx';
import Checkbox from '../ui/Checkbox.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { ReleasePreview } from '../../lib/services/bank_release_preview.ts';
import { INITIAL_ITEM_DETAIL_QUERY, itemDetailHref } from '../../lib/item_detail_query.ts';
import { record } from '../../lib/banks/bank_release.ts';
import ReleasePackages from './ReleasePackages.tsx';

/** Server-paginated edition inspection with explicit, whole-manifest sign-off. */
export default function ReleasePage({ data, i18n }: { data: ReleasePreview; i18n: I18n }) {
  const { release, canPublish, counts, query } = data;
  const manifest = release.manifest, path = `/releases/${release.id}`;
  const corrections = manifest.items.filter((item) =>
    item.eligibility.kind === 'attestation_required' &&
    item.eligibility.review?.state === 'changes_requested'
  );
  const href = (page: number, filter = query.filter) =>
    `${path}?version=${release.version}&page=${page}&filter=${filter}`;
  return (
    <section class='space-y-6'>
      <a href='/releases' class='link'>{i18n.t('releases.title')}</a>
      <header class='space-y-2'>
        <h1 class='text-3xl font-medium'>{release.label}</h1>
        <p>
          {i18n.t(`releases.state.${release.state}`)} ·{' '}
          {i18n.t('releases.version', { version: release.version })}
        </p>
        <p class='whitespace-pre-wrap'>{manifest.notes}</p>
        {manifest.collections.length > 0 && (
          <p>{i18n.formatList(manifest.collections.map((row) => row.name))}</p>
        )}
      </header>
      {release.distribution === 'withdrawn' && (
        <p role='alert' class='ds-alert ds-alert-warning'>{i18n.t('releases.withdrawn')}</p>
      )}
      {release.replacementId && (
        <a class='link' href={`/releases/${release.replacementId}`}>
          {i18n.t('releases.openReplacement')}
        </a>
      )}
      <p class='max-w-prose text-sm'>{i18n.t('releases.visibility')}</p>
      <dl class='flex flex-wrap gap-x-8 gap-y-3'>
        {Object.entries(counts).map(([key, count]) => (
          <div key={key}>
            <dt class='text-sm text-base-content/70'>
              {i18n.t(
                key === 'attest' && release.state === 'frozen'
                  ? 'releases.attested'
                  : `releases.count.${key}`,
              )}
            </dt>
            <dd class='text-xl font-medium'>{i18n.formatNumber(count)}</dd>
          </div>
        ))}
      </dl>
      {!canPublish && <p class='ds-alert'>{i18n.t('releases.grantRequired')}</p>}
      {canPublish && release.state === 'draft' && (
        <details class='border-y border-base-300 py-3'>
          <summary class='cursor-pointer font-medium'>{i18n.t('releases.refresh')}</summary>
          <form method='post' action={path} class='mt-4 max-w-xl space-y-3'>
            <CommandFields data={data} action='refresh' />
            <label class='block'>
              {i18n.t('releases.label')}
              <Input name='label' value={release.label} required maxLength={160} />
            </label>
            <label class='block'>
              {i18n.t('releases.notes')}
              <Textarea name='notes' value={manifest.notes} maxLength={4000} />
            </label>
            <p class='text-sm'>{i18n.t('releases.refreshHelp')}</p>
            <Button type='submit'>{i18n.t('releases.refresh')}</Button>
          </form>
        </details>
      )}
      <section class='space-y-3' aria-label={i18n.t('releases.inspect')}>
        <nav class='flex flex-wrap gap-2' aria-label={i18n.t('releases.inspect')}>
          {(['all', 'exceptions', 'stale', 'attest', 'reviewed', 'shipped'] as const).map((
            filter,
          ) => (
            <Button
              key={filter}
              href={href(1, filter)}
              aria-current={filter === query.filter ? 'page' : undefined}
              variant={filter === query.filter ? 'primary' : 'ghost'}
            >
              {i18n.t(
                filter === 'attest' && release.state === 'frozen'
                  ? 'releases.attested'
                  : `releases.filter.${filter}`,
              )}
            </Button>
          ))}
        </nav>
        <ol class='divide-y divide-base-300'>
          {data.rows.map((item) => (
            <li key={item.questionId} class='py-4 space-y-2'>
              <div class='flex flex-wrap gap-2 items-baseline'>
                <span class='text-sm text-base-content/60'>{item.position}.</span>
                <a
                  class='link font-medium'
                  href={itemDetailHref(item.questionId, {
                    ...INITIAL_ITEM_DETAIL_QUERY,
                    comparison: item.revision > 1
                      ? { fromRevision: item.revision - 1, toRevision: item.revision }
                      : null,
                    reviewsBefore: item.revision + 1,
                  }, 'item-history-heading')}
                >
                  {item.title} ·{' '}
                  {i18n.t('items.detail.revisionColumn', { revision: item.revision })}
                </a>
              </div>
              <p class='text-sm'>
                {item.eligibility.kind === 'reviewed'
                  ? i18n.t(`items.reviews.${item.eligibility.evidence.independence}`)
                  : i18n.t(
                    release.state === 'frozen'
                      ? (data.signoff?.actorId === item.eligibility.revisionAuthorId
                        ? 'releases.selfAttested'
                        : 'releases.attested')
                      : item.previouslyShipped
                      ? 'releases.previouslyShipped'
                      : 'releases.needsAttestation',
                  )}
              </p>
              {item.correction && (
                <p class='text-warning'>
                  {i18n.t(
                    release.state === 'frozen'
                      ? 'releases.overrideRecorded'
                      : 'releases.correction',
                  )}
                </p>
              )}
              {item.newer && (
                <p>
                  {i18n.t(
                    item.selection === 'historical' ? 'releases.historical' : 'releases.newer',
                  )}
                </p>
              )}
              {canPublish && release.state === 'draft' && (
                <div class='flex flex-wrap gap-4'>
                  {item.newer && item.selection === 'current' && (
                    <form method='post' action={path}>
                      <CommandFields data={data} action='keep' />
                      <Input type='hidden' name='questionId' value={item.questionId} />
                      <Button type='submit' size='sm'>{i18n.t('releases.keep')}</Button>
                    </form>
                  )}
                  <details>
                    <summary class='cursor-pointer text-sm'>{i18n.t('releases.exclude')}</summary>
                    <form method='post' action={path} class='mt-2 space-y-2'>
                      <CommandFields data={data} action='exclude' />
                      <Input type='hidden' name='questionId' value={item.questionId} />
                      <label class='block'>
                        {i18n.t('releases.reason')}
                        <Input name='reason' required maxLength={4000} />
                      </label>
                      <Button type='submit' size='sm'>{i18n.t('releases.exclude')}</Button>
                    </form>
                  </details>
                </div>
              )}
            </li>
          ))}
        </ol>
        {data.rows.length === 0 && <p>{i18n.t('releases.noRows')}</p>}
        <nav class='flex items-center gap-3' aria-label={i18n.t('releases.pages')}>
          {query.page > 1 && (
            <Button href={href(query.page - 1)}>{i18n.t('releases.previous')}</Button>
          )}
          <span>{i18n.t('releases.page', { page: query.page, pages: data.pageCount })}</span>
          {query.page < data.pageCount && (
            <Button href={href(query.page + 1)}>{i18n.t('releases.next')}</Button>
          )}
        </nav>
      </section>
      {canPublish && release.state === 'draft' && data.correctionQuestionIds.length > 0 &&
        data.correctionQuestionIds.length < counts.total && (
        <details>
          <summary class='cursor-pointer'>
            {i18n.t('releases.excludeExceptions', { count: data.correctionQuestionIds.length })}
          </summary>
          <form method='post' action={path} class='mt-3 max-w-xl space-y-3'>
            <CommandFields data={data} action='exclude' />
            {data.correctionQuestionIds.map((id) => (
              <Input type='hidden' name='questionId' value={id} key={id} />
            ))}
            <label class='block'>
              {i18n.t('releases.reason')}
              <Input name='reason' required maxLength={4000} />
            </label>
            <Button type='submit'>
              {i18n.t('releases.excludeExceptions', { count: data.correctionQuestionIds.length })}
            </Button>
          </form>
        </details>
      )}
      {manifest.exclusions.length > 0 && (
        <details>
          <summary>{i18n.t('releases.exclusions', { count: manifest.exclusions.length })}</summary>
          <ul>
            {manifest.exclusions.map((row) => (
              <li key={row.questionId}>
                {row.reason} ·{' '}
                <a href={`/items/${row.questionId}`} class='link'>
                  {i18n.t('releases.openQuestion')}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {canPublish && release.state === 'draft' && (
        <section class='border-t border-base-300 pt-5 space-y-3'>
          <h2 class='text-xl font-medium'>{i18n.t('releases.freeze')}</h2>
          {!manifest.preparation
            ? (
              <form method='post' action={`${path}/prepare`} class='space-y-3'>
                <Input type='hidden' name='version' value={release.version} />
                <Input type='hidden' name='digest' value={release.digest} />
                <Input type='hidden' name='preparationId' value={crypto.randomUUID()} />
                <p class='max-w-prose'>{i18n.t('releases.prepareHelp')}</p>
                <Button type='submit'>{i18n.t('releases.prepare')}</Button>
              </form>
            )
            : (
              <form method='post' action={path} class='max-w-2xl space-y-4'>
                <CommandFields data={data} action='freeze' />
                <p>{i18n.t('releases.freezeHelp', { count: counts.total })}</p>
                {counts.attest > 0
                  ? (
                    <>
                      <label class='flex items-start gap-3'>
                        <Checkbox name='attest' value='yes' required />
                        <span>{i18n.t('releases.attestAll', { count: counts.attest })}</span>
                      </label>
                      <label class='block'>
                        {i18n.t('releases.reason')}
                        <Textarea name='reason' required maxLength={4000} />
                      </label>
                    </>
                  )
                  : (
                    <>
                      <Input type='hidden' name='attest' value='no' />
                      <Input type='hidden' name='reason' value='' />
                    </>
                  )}
                {corrections.map((item) => (
                  <label class='block' key={item.revisionId}>
                    {i18n.t('releases.override')}: {item.title} (r{item.revision})
                    <Textarea name={`override:${item.revisionId}`} required maxLength={4000} />
                  </label>
                ))}
                <Button type='submit' variant='primary'>
                  {i18n.t(counts.attest ? 'releases.attestFreeze' : 'releases.freeze')}
                </Button>
              </form>
            )}
        </section>
      )}
      {release.state === 'frozen' && <ReleasePackages data={data} i18n={i18n} />}
      {release.state === 'frozen' && (
        <section class='border-t border-base-300 pt-5 space-y-4'>
          <h2 class='text-xl font-medium'>{i18n.t('releases.retained')}</h2>
          {data.signoff && (
            <p>
              {i18n.rich('releases.signedBy', {
                actor: data.signoff.actorLabel,
                date: (
                  <LocalizedTimestamp
                    value={data.signoff.createdAt.toISOString()}
                    locale={i18n.locale}
                    showTime={false}
                  />
                ),
              })}
            </p>
          )}
          <p class='max-w-prose'>{i18n.t('releases.destinationGate')}</p>
          {canPublish && release.distribution === 'available' && (
            <form method='post' action={`${path}/source`}>
              <Input type='hidden' name='operationId' value={crypto.randomUUID()} />
              <Button type='submit'>{i18n.t('releases.downloadSource')}</Button>
            </form>
          )}
          <form action='/releases/compare' method='get' class='flex flex-wrap items-end gap-3'>
            <Input type='hidden' name='from' value={release.id} />
            <div>
              <label for='compare-edition'>{i18n.t('releases.compareId')}</label>
              <Select id='compare-edition' name='to' required>
                {data.comparisons.filter((row) => row.id !== release.id).map((row) => (
                  <option key={row.id} value={row.id}>{row.label}</option>
                ))}
              </Select>
            </div>
            <Button type='submit'>{i18n.t('releases.compare')}</Button>
          </form>
          <nav aria-label={i18n.t('releases.comparisonPages')}>
            {query.comparisonBefore && (
              <Button href={href(query.page)}>{i18n.t('releases.newest')}</Button>
            )}
            {data.comparisonNext && (
              <Button href={`${href(query.page)}&comparisonBefore=${data.comparisonNext}`}>
                {i18n.t('releases.older')}
              </Button>
            )}
          </nav>
          {canPublish && (
            <details>
              <summary class='cursor-pointer'>
                {i18n.t(
                  release.distribution === 'withdrawn' ? 'releases.restore' : 'releases.withdraw',
                )}
              </summary>
              <form action={path} method='post' class='mt-3 max-w-xl space-y-3'>
                <CommandFields
                  data={data}
                  action={release.distribution === 'withdrawn' ? 'restore' : 'withdraw'}
                />
                <label class='block'>
                  {i18n.t('releases.reason')}
                  <Textarea name='reason' required maxLength={4000} />
                </label>
                <label class='block'>
                  {i18n.t('releases.replacement')}
                  <Select name='replacementId' value={release.replacementId ?? ''}>
                    <option value=''>{i18n.t('releases.noReplacement')}</option>
                    {data.replacementChoices.filter((row) => row.id !== release.id).map((row) => (
                      <option key={row.id} value={row.id}>{row.label}</option>
                    ))}
                  </Select>
                </label>
                <p>{i18n.t('releases.withdrawHelp')}</p>
                <Button type='submit'>
                  {i18n.t(
                    release.distribution === 'withdrawn' ? 'releases.restore' : 'releases.withdraw',
                  )}
                </Button>
              </form>
            </details>
          )}
        </section>
      )}
      <details>
        <summary class='cursor-pointer'>{i18n.t('releases.history')}</summary>
        <ul class='mt-3 space-y-2'>
          {data.events.map((event) => (
            <li key={event.operationId}>
              {event.actorLabel} ·{' '}
              <LocalizedTimestamp
                value={event.createdAt.toISOString()}
                locale={i18n.locale}
                showTime={false}
              />{' '}
              · {i18n.t(
                `releases.event.${
                  record(event.command) && typeof event.command.action === 'string'
                    ? event.command.action
                    : 'create'
                }`,
              )}
              {record(event.command) && typeof event.command.reason === 'string' && (
                <p>{event.command.reason}</p>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
function CommandFields({ data, action }: { data: ReleasePreview; action: string }) {
  return (
    <>
      <Input type='hidden' name='action' value={action} />
      <Input type='hidden' name='operationId' value={crypto.randomUUID()} />
      <Input type='hidden' name='version' value={data.release.version} />
      <Input type='hidden' name='digest' value={data.release.digest} />
    </>
  );
}

const LocalizedTimestamp = mountIsland({
  component: 'LocalizedTimestamp',
  View: LocalizedTimestampView,
});

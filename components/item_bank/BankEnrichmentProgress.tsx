import { mountIsland } from '../../lib/rendering/mount_island.ts';
import type { EnrichmentJobView } from '../../lib/services/bank_enrichment_job_read.ts';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { I18nPayload } from '../../lib/i18n/payload.ts';
import BankEnrichmentJobControlsView from '../../islands/BankEnrichmentJobControls.tsx';
import { enrichmentFailureKey } from '../../lib/bank_enrichment_feedback.ts';

/** Separate processed counts from successful tags so failures never appear as completed tagging. */
export function BankEnrichmentProgress(
  props: {
    readonly job: EnrichmentJobView;
    readonly operationId: string;
    readonly i18n: I18n;
    readonly payload: I18nPayload;
  },
) {
  const { job, i18n } = props;
  const running = job.state === 'queued' || job.state === 'running';
  const resumable = !running && job.errorCode !== 'budget_exceeded' &&
    (job.state === 'failed' || job.state === 'cancelled' ||
      (job.kind !== 'preview' && job.progress.counts.failed > 0));
  return (
    <div class='max-w-2xl space-y-5'>
      <p role='status' class='text-lg font-medium'>
        {i18n.t(
          job.kind === 'preview' && running
            ? 'items.organize.sampling'
            : (job.kind === 'correct' || job.kind === 'undo') &&
                (job.state === 'running' || job.state === 'completed')
            ? `items.organize.mutationState.${job.state}`
            : `items.organize.state.${job.state}`,
        )}
      </p>
      {running && <p class='text-sm text-base-content/80'>{i18n.t('items.organize.background')}</p>}
      {job.errorCode && <p role='alert'>{i18n.t(enrichmentFailureKey(job.errorCode))}</p>}
      {job.kind === 'preview'
        ? <p>{i18n.t('items.organize.sampleScope', { count: job.scopeCount })}</p>
        : (
          <>
            <p>
              {i18n.t('items.organize.processed', {
                count: job.progress.completed,
                total: job.progress.total,
              })}
            </p>
            <progress
              class='ds-progress ds-progress-primary w-full'
              max={job.progress.total}
              value={job.progress.completed}
              aria-label={i18n.t('items.organize.progress')}
            />
            <p class='text-sm text-base-content/80'>
              {i18n.t('items.organize.fieldsSummary', {
                fields: job.command.dimensions.map((d) => i18n.t(`items.browse.${d}`)).join(', '),
              })}
            </p>
            <dl class='grid grid-cols-2 gap-x-6 gap-y-2 text-sm'>
              {job.kind !== 'classify' && (
                <>
                  <div>
                    <dt>
                      {i18n.t(
                        job.kind === 'undo' ? 'items.organize.restored' : 'items.organize.changed',
                      )}
                    </dt>
                    <dd>{i18n.formatNumber(job.changes.questions)}</dd>
                  </div>
                  <div>
                    <dt>{i18n.t('items.organize.laterEdits')}</dt>
                    <dd>{i18n.formatNumber(job.changes.laterEdits)}</dd>
                  </div>
                  {job.kind === 'undo' && job.changes.noChanges > 0 && (
                    <div>
                      <dt>{i18n.t('items.organize.nothingToRestore')}</dt>
                      <dd>{i18n.formatNumber(job.changes.noChanges)}</dd>
                    </div>
                  )}
                </>
              )}
              {Object.entries(job.progress.counts).filter(([key, count]) =>
                key !== 'pending' && count > 0 && (job.kind === 'classify' || key !== 'classified')
              ).map(([key, count]) => (
                <div key={key} class='flex justify-between gap-3'>
                  <dt>
                    {i18n.t(
                      job.kind !== 'classify' && key === 'protected'
                        ? 'items.organize.protectedChanges'
                        : `items.organize.outcome.${key}`,
                    )}
                  </dt>
                  <dd class='font-medium tabular-nums'>{i18n.formatNumber(count)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      {(job.kind === 'correct' || job.kind === 'undo') && job.teachingExampleCount !== null && (
        <p role='status' class='text-sm text-base-content/80'>
          {i18n.t('items.organize.teachingSaved', { count: job.teachingExampleCount })}
        </p>
      )}
      <BankEnrichmentJobControls
        id={job.id}
        operationId={props.operationId}
        updatedAt={job.updatedAt}
        running={running}
        resumable={resumable}
        undoable={!running && (job.kind === 'classify' || job.kind === 'correct')}
        payload={props.payload}
      />
      {job.usage !== null && (
        <details>
          <summary class='cursor-pointer py-2 text-sm'>{i18n.t('items.organize.usage')}</summary>
          <p class='pt-2 text-sm'>
            {i18n.t('items.organize.usageAmount', {
              cost: i18n.formatNumber(
                (job.usage.chargedMicros + job.usage.reservedMicros) / 1_000_000,
                { style: 'currency', currency: 'USD' },
              ),
              attempts: job.usage.attempts,
            })}
          </p>
        </details>
      )}
    </div>
  );
}

const BankEnrichmentJobControls = mountIsland({
  component: 'BankEnrichmentJobControls',
  View: BankEnrichmentJobControlsView,
});

import { mountIsland } from '../../../rendering/mount_island.ts';
import LocalizedTimestampView from '../../../../islands/LocalizedTimestamp.tsx';
import { migrationCommittedHref } from '../../../import/migration_destination.ts';
import Button from '../../../../components/ui/Button.tsx';
import Select from '../../../../components/ui/Select.tsx';
import { safeErrorSummary } from '../../../error_summary.ts';
import { retryMigrationRun } from '../../../import/migration_jobs.ts';
import { listMigrationRuns } from '../../../import/migration_run_queries.ts';
import type { MigrationRunListItem } from '../../../import/migration_types.ts';
import { requireAuthContext } from '../../../tenants.ts';
import {
  dispatchPendingWorkflowJobs,
  requireWorkflowBindings,
} from '../../../workflows/workflow_dispatch.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import type { I18n } from '../../../i18n/messages.ts';

type Data = {
  runs: MigrationRunListItem[];
  allRuns: MigrationRunListItem[];
  status: string;
  queueCount: number;
  retryError?: string | null;
  i18n: I18n;
};

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    const url = ctx.url;
    const status = url.searchParams.get('status') ?? '';
    const queueCount = Number(url.searchParams.get('queued') ?? 0) || 0;
    const retryError = url.searchParams.get('retryError') === 'retry_failed'
      ? 'retry_failed'
      : null;
    const allRuns = await listMigrationRuns(auth);
    const runs = status ? allRuns.filter((run) => queueStatus(run) === status) : allRuns;
    return ctx.render(
      <ImportsIndex
        runs={runs}
        allRuns={allRuns}
        status={status}
        queueCount={queueCount}
        retryError={retryError}
        i18n={ctx.state.i18n}
      />,
    );
  },
  async POST(ctx) {
    const auth = requireAuthContext(ctx.state);
    const form = await ctx.req.formData();
    const action = String(form.get('action') ?? '');
    if (action !== 'retry') {
      return new Response(ctx.state.i18n.t('imports.retryFailed'), { status: 400 });
    }
    const runId = String(form.get('runId') ?? '').trim();
    if (!runId) return new Response(ctx.state.i18n.t('imports.retryFailed'), { status: 400 });
    try {
      requireWorkflowBindings(ctx);
      await retryMigrationRun(auth, runId);
      const dispatch = await dispatchPendingWorkflowJobs(ctx, {
        jobIds: [runId],
        tenantId: auth.tenantId,
      });
      if (!dispatch.ok) {
        console.error(JSON.stringify({
          event: 'source_workflow_retry_dispatch_deferred',
          runId,
          errorTag: dispatch.error._tag,
        }));
      }
      return new Response(null, {
        status: 303,
        headers: { location: '/imports?status=queued&queued=1' },
      });
    } catch (cause: unknown) {
      console.error(JSON.stringify({
        event: 'source_workflow_retry_failed',
        runId,
        cause: safeErrorSummary(cause),
      }));
      const url = new URL('/imports', ctx.url);
      url.searchParams.set('retryError', 'retry_failed');
      return new Response(null, {
        status: 303,
        headers: { location: url.pathname + url.search },
      });
    }
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const importListPageRoute = defineHttpRoute('/imports', { ...methods, HEAD: methods.GET });

export default function ImportsIndex(
  { runs, allRuns, status, queueCount, retryError, i18n }: Data,
) {
  const stats = buildQueueStats(allRuns);
  return (
    <section class='max-w-6xl space-y-6'>
      <div class='flex flex-wrap items-start justify-between gap-4'>
        <div class='space-y-2'>
          <h1 class='text-3xl font-medium'>{i18n.t('imports.title')}</h1>
          <p class='max-w-2xl text-sm leading-6 text-base-content/70'>
            {i18n.t('imports.description')}
          </p>
        </div>
        <Button variant='primary' href='/imports/new'>
          {i18n.t('imports.bringFiles')}
        </Button>
      </div>

      {queueCount > 0 && (
        <div class='ds-alert ds-alert-success text-sm' role='status'>
          {i18n.t('imports.queue', { count: queueCount })}
        </div>
      )}
      {retryError && (
        <div class='ds-alert ds-alert-error text-sm' role='alert'>
          {i18n.t('imports.retryFailed')}
        </div>
      )}

      <dl class='grid gap-px overflow-hidden rounded-lg border border-base-300 bg-base-300 sm:grid-cols-3 xl:grid-cols-6'>
        <Metric i18n={i18n} label={i18n.t('imports.metric.queued')} value={stats.queued} />
        <Metric
          i18n={i18n}
          label={i18n.t('imports.metric.analyzing')}
          value={stats.analyzing}
          tone='text-info'
        />
        <Metric
          i18n={i18n}
          label={i18n.t('imports.metric.ready')}
          value={stats.ready}
          tone='text-primary'
        />
        <Metric
          i18n={i18n}
          label={i18n.t('imports.metric.needsReview')}
          value={stats.needsReview}
          tone='text-warning'
        />
        <Metric
          i18n={i18n}
          label={i18n.t('imports.metric.failed')}
          value={stats.failed}
          tone='text-error'
        />
        <Metric
          i18n={i18n}
          label={i18n.t('imports.metric.committed')}
          value={stats.committed}
          tone='text-success'
        />
      </dl>

      <form class='rounded-lg border border-base-300 bg-base-100 p-4' method='get'>
        <div class='grid gap-4 sm:grid-cols-[minmax(0,20rem)_auto] sm:items-end'>
          <label class='ds-form-control'>
            <span>{i18n.t('imports.filter.status')}</span>
            <Select name='status' defaultValue={status}>
              <option value=''>{i18n.t('imports.filter.all')}</option>
              {(['queued', 'analyzing', 'ready', 'needs_review', 'failed', 'committed'] as const)
                .map((s) => <option key={s} value={s}>{statusLabel(i18n, s)}</option>)}
            </Select>
          </label>
          <div class='flex flex-wrap gap-2'>
            <Button type='submit'>{i18n.t('imports.filter.apply')}</Button>
            {status && (
              <Button href='/imports' variant='ghost'>{i18n.t('imports.filter.clear')}</Button>
            )}
          </div>
        </div>
      </form>

      {runs.length === 0
        ? (
          <div class='rounded-lg border border-dashed border-base-300 px-5 py-8 text-center'>
            <h2 class='text-lg font-medium'>
              {i18n.t(allRuns.length ? 'imports.empty.filteredTitle' : 'imports.empty.title')}
            </h2>
            <p class='mx-auto mt-2 max-w-md text-sm leading-6 text-base-content/65'>
              {i18n.t(allRuns.length ? 'imports.empty.filteredBody' : 'imports.empty.body')}
            </p>
            <div class='mt-4'>
              <Button
                href={allRuns.length ? '/imports' : '/imports/new'}
                variant='primary'
              >
                {i18n.t(allRuns.length ? 'imports.empty.clear' : 'imports.empty.import')}
              </Button>
            </div>
          </div>
        )
        : (
          <div class='overflow-hidden rounded-lg border border-base-300 bg-base-100'>
            <ul class='divide-y divide-base-200'>
              {runs.map((run) => (
                <li key={run.id} class='px-4 py-4 transition-colors hover:bg-base-200/30 sm:px-5'>
                  <div class='flex flex-wrap items-start justify-between gap-4'>
                    <div class='min-w-0 space-y-2'>
                      <div class='flex flex-wrap items-center gap-2'>
                        <h2 class='text-base font-medium'>{run.sourceFilename}</h2>
                        <StatusBadge run={run} i18n={i18n} />
                      </div>
                      <div class='text-xs text-base-content/70'>
                        {run.adapter.label} · {i18n.rich('imports.run.summary', {
                          items: run.summary.counts.items,
                          warnings: run.summary.counts.warnings,
                          date: formatDate(run.createdAt, i18n),
                        })}
                      </div>
                    </div>
                    <div class='flex shrink-0 flex-wrap gap-2'>
                      {run.execution._tag === 'Committed' && (
                        <Button
                          size='sm'
                          href={migrationCommittedHref(run.execution.destination)}
                        >
                          {i18n.t(
                            run.execution._tag === 'Committed' &&
                              run.execution.destination._tag === 'WorkspaceBank'
                              ? 'imports.report.openBank'
                              : 'imports.openAssessment',
                          )}
                        </Button>
                      )}
                      {run.execution._tag === 'Failed' && (
                        <form method='post'>
                          <input type='hidden' name='action' value='retry' />
                          <input type='hidden' name='runId' value={run.id} />
                          <Button size='sm' type='submit'>{i18n.t('imports.retry')}</Button>
                        </form>
                      )}
                      <Button size='sm' variant='primary' href={`/imports/${run.id}`}>
                        {i18n.t('imports.viewReport')}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
    </section>
  );
}

function Metric(
  { label, value, tone = '', i18n }: { label: string; value: number; tone?: string; i18n: I18n },
) {
  return (
    <div class='bg-base-100 px-4 py-4'>
      <dt class='text-xs text-base-content/60'>{label}</dt>
      <dd class={`mt-1 text-2xl font-medium ${tone}`}>{i18n.formatNumber(value)}</dd>
    </div>
  );
}

function StatusBadge({ run, i18n }: { run: MigrationRunListItem; i18n: I18n }) {
  const status = queueStatus(run);
  const label = statusLabel(i18n, status);
  const tone = status === 'queued'
    ? 'ds-badge-ghost'
    : status === 'analyzing'
    ? 'ds-badge-info'
    : status === 'committed'
    ? 'ds-badge-success'
    : status === 'failed'
    ? 'ds-badge-error'
    : status === 'ready'
    ? 'ds-badge-primary'
    : 'ds-badge-warning';
  return <span class={`ds-badge ${tone} ds-badge-outline`}>{label}</span>;
}

function queueStatus(run: MigrationRunListItem): string {
  if (run.execution._tag === 'Queued') return 'queued';
  if (run.execution._tag === 'Analyzing') return 'analyzing';
  if (run.execution._tag === 'Failed') return 'failed';
  if (run.execution._tag === 'Committed') return 'committed';
  return run.summary.counts.blocked === 0 &&
      run.summary.counts.reviewNeeded === 0 &&
      !(run.summary.globalWarnings?.length)
    ? 'ready'
    : 'needs_review';
}

function buildQueueStats(runs: MigrationRunListItem[]) {
  return runs.reduce(
    (stats, run) => {
      const status = queueStatus(run);
      if (status === 'queued') stats.queued++;
      else if (status === 'analyzing') stats.analyzing++;
      else if (status === 'failed') stats.failed++;
      else if (status === 'committed') stats.committed++;
      else if (status === 'ready') stats.ready++;
      else stats.needsReview++;
      return stats;
    },
    { queued: 0, analyzing: 0, failed: 0, committed: 0, ready: 0, needsReview: 0 },
  );
}

function formatDate(value: string, i18n: I18n) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return i18n.t('imports.unavailableDate');
  return <LocalizedTimestamp value={date.toISOString()} locale={i18n.locale} />;
}

function statusLabel(i18n: I18n, status: string): string {
  const id = {
    queued: 'imports.status.queued',
    analyzing: 'imports.status.analyzing',
    ready: 'imports.status.ready',
    needs_review: 'imports.status.needsReview',
    failed: 'imports.status.failed',
    committed: 'imports.status.committed',
  }[status];
  return id ? i18n.t(id) : i18n.t('imports.status.failed');
}

/** Parses the allow-listed import feedback token. */
export function parseImportFeedback(raw: string | null): 'retry_failed' | null {
  return raw === 'retry_failed' ? raw : null;
}

const LocalizedTimestamp = mountIsland({
  component: 'LocalizedTimestamp',
  View: LocalizedTimestampView,
});

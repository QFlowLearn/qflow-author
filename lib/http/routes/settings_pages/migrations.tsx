import { mountIsland } from '../../../rendering/mount_island.ts';
import LocalizedTimestampView from '../../../../islands/LocalizedTimestamp.tsx';
import { migrationCommittedHref } from '../../../import/migration_destination.ts';
import Button from '../../../../components/ui/Button.tsx';
import Input from '../../../../components/ui/Input.tsx';
import Select from '../../../../components/ui/Select.tsx';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { listMigrationRuns } from '../../../import/migration_run_queries.ts';
import type { MigrationRunListItem } from '../../../import/migration_types.ts';
import { migrationExecutionStatus } from '../../../import/migration_state.ts';
import { roleAtLeast } from '../../../roles.ts';
import { requireAuthContext } from '../../../tenants.ts';
import type { I18n } from '../../../i18n/messages.ts';

type Data = {
  runs: MigrationRunListItem[];
  status: string;
  readiness: string;
  review: string;
  q: string;
  stats: DashboardStats;
};

type DashboardStats = {
  total: number;
  queued: number;
  analyzing: number;
  committed: number;
  failed: number;
  accepted: number;
  pending: number;
  rejected: number;
  items: number;
  warnings: number;
  blocked: number;
};

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    if (!roleAtLeast(auth.role, 'admin')) {
      return new Response(ctx.state.i18n.t('settings.migrations.error.forbidden'), { status: 403 });
    }

    const url = ctx.url;
    const status = url.searchParams.get('status') ?? '';
    const readiness = url.searchParams.get('readiness') ?? '';
    const review = url.searchParams.get('review') ?? '';
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const allRuns = await listMigrationRuns(auth);
    const runs = allRuns.filter((run) => {
      const statusOk = !status || migrationExecutionStatus(run.execution) === status;
      const readinessOk = !readiness || runReadiness(run) === readiness;
      const reviewOk = !review || reviewMatches(run, review);
      const haystack = `${run.sourceFilename} ${run.adapter.label} ${run.creatorName ?? ''} ${
        run.creatorEmail ?? ''
      }`.toLowerCase();
      const qOk = !q || haystack.includes(q);
      return statusOk && readinessOk && reviewOk && qOk;
    });
    return ctx.render(
      <MigrationAdminPage
        runs={runs}
        status={status}
        readiness={readiness}
        review={review}
        q={q}
        stats={buildStats(allRuns)}
        i18n={ctx.state.i18n}
      />,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const settingsMigrationsPageRoute = defineHttpRoute('/settings/migrations', {
  ...methods,
  HEAD: methods.GET,
});

export default function MigrationAdminPage(
  { runs, status, readiness, review, q, stats, i18n }: Data & { i18n: I18n },
) {
  return (
    <section class='max-w-7xl space-y-6'>
      <div class='flex flex-wrap items-start justify-between gap-4'>
        <div class='space-y-2'>
          <h1 class='text-3xl font-medium'>{i18n.t('settings.migrations.title')}</h1>
          <p class='max-w-3xl text-sm leading-6 text-base-content/70'>
            {i18n.t('settings.migrations.subtitle')}
          </p>
        </div>
        <Button href='/assessments/new?intent=recover' variant='primary'>
          {i18n.t('settings.migrations.bringFiles')}
        </Button>
      </div>

      <div class='grid gap-4 lg:grid-cols-2'>
        <section class='space-y-4 rounded-lg border border-base-300 bg-base-100 p-5'>
          <h2 class='text-lg font-medium'>{i18n.t('settings.migrations.runStatus')}</h2>
          <dl class='grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-5'>
            <Metric
              i18n={i18n}
              label={i18n.t('settings.migrations.totalRuns')}
              value={stats.total}
            />
            <Metric i18n={i18n} label={i18n.t('settings.migrations.queued')} value={stats.queued} />
            <Metric
              label={i18n.t('settings.migrations.analyzing')}
              value={stats.analyzing}
              i18n={i18n}
              tone='text-info'
            />
            <Metric
              label={i18n.t('settings.migrations.committed')}
              value={stats.committed}
              i18n={i18n}
              tone='text-success'
            />
            <Metric
              label={i18n.t('settings.migrations.failed')}
              value={stats.failed}
              i18n={i18n}
              tone='text-error'
            />
          </dl>
        </section>
        <section class='space-y-4 rounded-lg border border-base-300 bg-base-100 p-5'>
          <h2 class='text-lg font-medium'>{i18n.t('settings.migrations.reviewWorkload')}</h2>
          <dl class='grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3'>
            <Metric
              i18n={i18n}
              label={i18n.t('settings.migrations.questions')}
              value={stats.items}
            />
            <Metric
              label={i18n.t('settings.migrations.accepted')}
              value={stats.accepted}
              i18n={i18n}
              tone='text-success'
            />
            <Metric
              label={i18n.t('settings.migrations.pending')}
              value={stats.pending}
              i18n={i18n}
              tone='text-warning'
            />
            <Metric
              i18n={i18n}
              label={i18n.t('settings.migrations.rejected')}
              value={stats.rejected}
            />
            <Metric
              label={i18n.t('settings.migrations.warnings')}
              value={stats.warnings}
              i18n={i18n}
              tone='text-warning'
            />
            <Metric
              label={i18n.t('settings.migrations.sourcePreserved')}
              value={stats.blocked}
              i18n={i18n}
              tone='text-error'
            />
          </dl>
        </section>
      </div>

      <form class='rounded-lg border border-base-300 bg-base-100' method='get'>
        <div class='space-y-4 p-5'>
          <h2 class='text-lg font-medium'>{i18n.t('settings.migrations.filterTitle')}</h2>
          <div class='grid gap-4 md:grid-cols-4'>
            <label class='flex flex-col'>
              <span>{i18n.t('settings.migrations.fileOwner')}</span>
              <Input
                name='q'
                defaultValue={q}
                placeholder={i18n.t('settings.migrations.fileOwnerPlaceholder')}
              />
            </label>
            <label class='flex flex-col'>
              <span>{i18n.t('settings.migrations.status')}</span>
              <Select name='status' defaultValue={status}>
                <option value=''>{i18n.t('settings.migrations.allStatuses')}</option>
                <option value='queued'>{i18n.t('settings.migrations.queued')}</option>
                <option value='analyzing'>{i18n.t('settings.migrations.analyzing')}</option>
                <option value='analyzed'>{i18n.t('settings.migrations.analyzed')}</option>
                <option value='committed'>{i18n.t('settings.migrations.committed')}</option>
                <option value='failed'>{i18n.t('settings.migrations.failed')}</option>
              </Select>
            </label>
            <label class='flex flex-col'>
              <span>{i18n.t('settings.migrations.readiness')}</span>
              <Select name='readiness' defaultValue={readiness}>
                <option value=''>{i18n.t('settings.migrations.allReadiness')}</option>
                <option value='queued'>{i18n.t('settings.migrations.queued')}</option>
                <option value='analyzing'>{i18n.t('settings.migrations.analyzing')}</option>
                <option value='ready'>{i18n.t('settings.migrations.readyToCommit')}</option>
                <option value='needs_review'>{i18n.t('settings.migrations.needsReview')}</option>
                <option value='committed'>{i18n.t('settings.migrations.committed')}</option>
                <option value='failed'>{i18n.t('settings.migrations.failed')}</option>
              </Select>
            </label>
            <label class='flex flex-col'>
              <span>{i18n.t('settings.migrations.review')}</span>
              <Select name='review' defaultValue={review}>
                <option value=''>{i18n.t('settings.migrations.allReview')}</option>
                <option value='pending'>{i18n.t('settings.migrations.hasPending')}</option>
                <option value='accepted'>{i18n.t('settings.migrations.hasAccepted')}</option>
                <option value='rejected'>{i18n.t('settings.migrations.hasRejected')}</option>
              </Select>
            </label>
          </div>
        </div>
        <div class='flex flex-wrap items-center gap-2 border-t border-base-200 px-5 py-4'>
          <Button type='submit'>{i18n.t('settings.migrations.apply')}</Button>
          {(q || status || readiness || review) && (
            <Button href='/settings/migrations' variant='ghost'>
              {i18n.t('settings.migrations.clear')}
            </Button>
          )}
        </div>
      </form>

      <section class='overflow-hidden rounded-lg border border-base-300 bg-base-100'>
        <div class='space-y-4 p-5'>
          <div class='flex flex-wrap items-center justify-between gap-3'>
            <h2 class='text-lg font-medium'>{i18n.t('settings.migrations.importRuns')}</h2>
            <span class='text-sm text-base-content/60'>
              {i18n.t('settings.migrations.runCount', { count: runs.length })}
            </span>
          </div>
          {runs.length === 0
            ? (
              <div class='py-6 text-center text-sm text-base-content/60'>
                {i18n.t('settings.migrations.empty')}
              </div>
            )
            : (
              <div class='overflow-x-auto'>
                <table class='ds-table w-full text-sm'>
                  <thead>
                    <tr>
                      <th>{i18n.t('settings.migrations.file')}</th>
                      <th>{i18n.t('settings.migrations.owner')}</th>
                      <th>{i18n.t('settings.migrations.status')}</th>
                      <th>{i18n.t('settings.migrations.issues')}</th>
                      <th>{i18n.t('settings.migrations.created')}</th>
                      <th>{i18n.t('settings.migrations.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id}>
                        <td>
                          <div class='space-y-1'>
                            <div class='font-medium'>{run.sourceFilename}</div>
                            <div class='text-xs text-base-content/60'>
                              {run.adapter.label} · {i18n.t('settings.migrations.itemsAssets', {
                                items: run.summary.counts.items,
                                assets: run.summary.counts.assets,
                              })}
                            </div>
                          </div>
                        </td>
                        <td>{displayUser(run.creatorName, run.creatorEmail, i18n)}</td>
                        <td>
                          <div class='space-y-2'>
                            <RunBadge run={run} i18n={i18n} />
                            <ReviewSummary run={run} i18n={i18n} />
                            {run.execution._tag === 'Committed' && (
                              <div class='text-xs text-base-content/60'>
                                {i18n.rich('settings.migrations.committedAt', {
                                  date: formatDateTime(run.execution.committedAt, i18n),
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                        <td>
                          <IssueSummary run={run} i18n={i18n} />
                        </td>
                        <td>{formatDateTime(run.createdAt, i18n)}</td>
                        <td>
                          <div class='flex flex-wrap gap-2'>
                            <Button size='sm' href={`/imports/${run.id}`}>
                              {i18n.t('settings.migrations.viewReport')}
                            </Button>
                            {run.execution._tag === 'Committed' && (
                              <Button
                                size='sm'
                                variant='ghost'
                                href={migrationCommittedHref(run.execution.destination)}
                              >
                                {i18n.t('settings.migrations.openAssessment')}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </section>
    </section>
  );
}

function Metric({ label, value, tone = '', i18n }: {
  label: string;
  value: number;
  tone?: string;
  i18n: I18n;
}) {
  return (
    <div>
      <dt class='text-xs text-base-content/60'>{label}</dt>
      <dd class={`mt-1 text-2xl font-medium ${tone}`}>{i18n.formatNumber(value)}</dd>
    </div>
  );
}

function RunBadge({ run, i18n }: { run: MigrationRunListItem; i18n: I18n }) {
  if (run.execution._tag === 'Queued') {
    return (
      <span class='ds-badge ds-badge-ghost ds-badge-outline'>
        {i18n.t('settings.migrations.queued')}
      </span>
    );
  }
  if (run.execution._tag === 'Analyzing') {
    return (
      <span class='ds-badge ds-badge-info ds-badge-outline'>
        {i18n.t('settings.migrations.analyzing')}
      </span>
    );
  }
  if (run.execution._tag === 'Committed') {
    return (
      <span class='ds-badge ds-badge-success ds-badge-outline'>
        {i18n.t('settings.migrations.committed')}
      </span>
    );
  }
  if (run.execution._tag === 'Failed') {
    return (
      <span class='ds-badge ds-badge-error ds-badge-outline'>
        {i18n.t('settings.migrations.failed')}
      </span>
    );
  }
  if (runReadiness(run) === 'ready') {
    return (
      <span class='ds-badge ds-badge-primary ds-badge-outline'>
        {i18n.t('settings.migrations.readyToCommit')}
      </span>
    );
  }
  return (
    <span class='ds-badge ds-badge-warning ds-badge-outline'>
      {i18n.t('settings.migrations.needsReview')}
    </span>
  );
}

function IssueSummary({ run, i18n }: { run: MigrationRunListItem; i18n: I18n }) {
  const warningEntries = Object.entries(run.summary.warningCounts).slice(0, 3);
  const hasReviewIssues = run.reviewProgress.pending > 0 || run.reviewProgress.rejected > 0;
  if (run.execution._tag === 'Failed') {
    return (
      <div class='max-w-xs text-sm text-error'>
        <div>
          {i18n.t('settings.migrations.failureDetail', {
            diagnostic: run.execution.failure || i18n.t('settings.migrations.unavailable'),
          })}
        </div>
      </div>
    );
  }
  if (!run.summary.counts.warnings && !hasReviewIssues) {
    return (
      <span class='text-sm text-base-content/60'>{i18n.t('settings.migrations.noIssues')}</span>
    );
  }
  return (
    <div class='space-y-2'>
      {run.summary.counts.warnings > 0 && (
        <div class='text-sm'>
          {i18n.t('settings.migrations.warningCount', { count: run.summary.counts.warnings })}
          {run.summary.counts.blocked > 0 &&
            ` · ${
              i18n.t('settings.migrations.blockedCount', { count: run.summary.counts.blocked })
            }`}
        </div>
      )}
      {hasReviewIssues && (
        <div class='flex flex-wrap gap-1'>
          {run.reviewProgress.rejected > 0 && (
            <span class='ds-badge ds-badge-warning ds-badge-outline text-[11px]'>
              {i18n.t('settings.migrations.rejectedCount', { count: run.reviewProgress.rejected })}
            </span>
          )}
          {run.reviewProgress.pending > 0 && (
            <span class='ds-badge ds-badge-outline text-[11px]'>
              {i18n.t('settings.migrations.pendingCount', { count: run.reviewProgress.pending })}
            </span>
          )}
        </div>
      )}
      {warningEntries.length > 0 && (
        <div class='flex max-w-md flex-wrap gap-1'>
          {warningEntries.map(([code, count]) => (
            <span key={code} class='ds-badge ds-badge-outline text-[11px]'>
              {code}: {i18n.formatNumber(count)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewSummary({ run, i18n }: { run: MigrationRunListItem; i18n: I18n }) {
  const progress = run.reviewProgress;
  if (!progress.total) return null;
  return (
    <div class='space-y-1 text-xs text-base-content/65'>
      <div>
        {i18n.t('settings.migrations.reviewProgress', {
          accepted: i18n.formatNumber(progress.accepted),
          total: i18n.formatNumber(progress.total),
        })}
      </div>
      <div class='flex flex-wrap gap-1'>
        {progress.rejected > 0 && (
          <span class='ds-badge ds-badge-warning ds-badge-outline text-[11px]'>
            {i18n.t('settings.migrations.rejectedCount', { count: progress.rejected })}
          </span>
        )}
        {progress.pending > 0 && (
          <span class='ds-badge ds-badge-outline text-[11px]'>
            {i18n.t('settings.migrations.pendingCount', { count: progress.pending })}
          </span>
        )}
      </div>
    </div>
  );
}

function reviewMatches(run: MigrationRunListItem, review: string): boolean {
  if (review === 'accepted') return run.reviewProgress.accepted > 0;
  if (review === 'rejected') return run.reviewProgress.rejected > 0;
  if (review === 'pending') return run.reviewProgress.pending > 0;
  return true;
}

function buildStats(runs: MigrationRunListItem[]): DashboardStats {
  return runs.reduce<DashboardStats>(
    (stats, run) => {
      stats.total++;
      if (run.execution._tag === 'Queued') stats.queued++;
      if (run.execution._tag === 'Analyzing') stats.analyzing++;
      if (run.execution._tag === 'Committed') stats.committed++;
      if (run.execution._tag === 'Failed') stats.failed++;
      stats.accepted += run.reviewProgress.accepted;
      stats.rejected += run.reviewProgress.rejected;
      stats.pending += run.reviewProgress.pending;
      stats.items += run.summary.counts.items;
      stats.warnings += run.summary.counts.warnings;
      stats.blocked += run.summary.counts.blocked;
      return stats;
    },
    {
      total: 0,
      queued: 0,
      analyzing: 0,
      committed: 0,
      failed: 0,
      accepted: 0,
      pending: 0,
      rejected: 0,
      items: 0,
      warnings: 0,
      blocked: 0,
    },
  );
}

function displayUser(
  name: string | null | undefined,
  email: string | null | undefined,
  i18n: I18n,
): string {
  if (name && email) return `${name} (${email})`;
  return name || email || i18n.t('settings.migrations.unavailable');
}

function formatDateTime(value: string | null | undefined, i18n: I18n) {
  if (!value) return i18n.t('settings.migrations.unavailable');
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return i18n.t('settings.migrations.unavailable');
  return <LocalizedTimestamp value={dt.toISOString()} locale={i18n.locale} />;
}

function runReadiness(
  run: MigrationRunListItem,
): 'queued' | 'analyzing' | 'ready' | 'needs_review' | 'committed' | 'failed' {
  if (run.execution._tag === 'Queued') return 'queued';
  if (run.execution._tag === 'Analyzing') return 'analyzing';
  if (run.execution._tag === 'Committed') return 'committed';
  if (run.execution._tag === 'Failed') return 'failed';
  return run.summary.counts.blocked === 0 &&
      run.summary.counts.reviewNeeded === 0 &&
      !(run.summary.globalWarnings?.length)
    ? 'ready'
    : 'needs_review';
}

const LocalizedTimestamp = mountIsland({
  component: 'LocalizedTimestamp',
  View: LocalizedTimestampView,
});

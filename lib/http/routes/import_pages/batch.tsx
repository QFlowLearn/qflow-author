import { defineHttpRoute, type HttpHandler } from '../../route.ts';

import Button from '../../../../components/ui/Button.tsx';
import Select from '../../../../components/ui/Select.tsx';
import { safeErrorSummary } from '../../../error_summary.ts';
import {
  assignMigrationBatchReviewer,
  getMigrationBatch,
} from '../../../import/migration_batches.ts';
import type { MigrationBatchRecord } from '../../../import/migration_types.ts';
import type {
  MigrationApprovalState,
  MigrationExecutionState,
} from '../../../import/migration_state.ts';
import { listMembers, type MemberRecord } from '../../../services/memberships.ts';
import { requireContentWrite } from '../../../services/roles.ts';
import { requireAuthContext } from '../../../tenants.ts';
import type { I18n } from '../../../i18n/messages.ts';

type Data = {
  batch: MigrationBatchRecord;
  members: MemberRecord[];
  error: BatchFeedback | null;
  i18n: I18n;
};

type BatchFeedback = 'reviewer_assignment_failed';

/** Parse the allow-listed migration-batch feedback token from a URL. */
export function parseBatchFeedback(raw: string | null): BatchFeedback | null {
  return raw === 'reviewer_assignment_failed' ? raw : null;
}

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    const batch = await getMigrationBatch(auth, ctx.params.id);
    if (!batch) return new Response(ctx.state.i18n.t('imports.batch.notFound'), { status: 404 });
    return ctx.render(
      <MigrationBatchPage
        batch={batch}
        members={await listMembers(auth.tenantId)}
        error={parseBatchFeedback(ctx.url.searchParams.get('error'))}
        i18n={ctx.state.i18n}
      />,
    );
  },
  async POST(ctx) {
    const auth = requireAuthContext(ctx.state);
    const denied = requireContentWrite(auth.role, ctx.req, ctx.state.i18n);
    if (denied) return denied;

    const form = await ctx.req.formData();
    if (form.get('action') !== 'assign-reviewer') {
      return new Response(ctx.state.i18n.t('imports.batch.invalidAction'), { status: 400 });
    }
    const reviewerId = String(form.get('reviewerId') ?? '').trim();
    if (!reviewerId) {
      return new Response(ctx.state.i18n.t('imports.batch.reviewerRequired'), { status: 400 });
    }
    try {
      await assignMigrationBatchReviewer(auth, ctx.params.id, reviewerId);
      return new Response(null, {
        status: 303,
        headers: { location: `/imports/batches/${ctx.params.id}` },
      });
    } catch (cause: unknown) {
      console.error(JSON.stringify({
        event: 'migration_reviewer_assignment_failed',
        batchId: ctx.params.id,
        reviewerId,
        cause: safeErrorSummary(cause),
      }));
      const url = new URL(`/imports/batches/${ctx.params.id}`, ctx.url);
      url.searchParams.set('error', 'reviewer_assignment_failed');
      return new Response(null, {
        status: 303,
        headers: { location: url.pathname + url.search },
      });
    }
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const importBatchPageRoute = defineHttpRoute('/imports/batches/:id', {
  ...methods,
  HEAD: methods.GET,
});

export default function MigrationBatchPage({ batch, members, error, i18n }: Data) {
  const progress = batch.progress;
  return (
    <main class='max-w-6xl space-y-6' aria-labelledby='batch-title'>
      <header class='space-y-3'>
        <div class='flex flex-wrap items-start justify-between gap-4'>
          <div>
            <p class='text-xs font-medium uppercase tracking-wide text-base-content/55'>
              {i18n.t('imports.batch.eyebrow')}
            </p>
            <h1 id='batch-title' class='mt-1 text-3xl font-semibold tracking-tight'>
              {i18n.t('imports.batch.sourceCount', { count: batch.sourceCount })}
            </h1>
            <p class='mt-2 text-sm text-base-content/65'>
              {i18n.t('imports.batch.statusPrefix', {
                status: batchStatusLabel(batch.status, i18n),
              })}
            </p>
          </div>
          <div class='flex gap-2'>
            <Button variant='ghost' href='/imports'>{i18n.t('imports.batch.allImports')}</Button>
            <Button variant='ghost' href={`/imports/batches/${batch.id}`}>
              {i18n.t('imports.batch.refresh')}
            </Button>
          </div>
        </div>
      </header>

      {error && (
        <div class='ds-alert ds-alert-error text-sm' role='alert'>
          {i18n.t('imports.batch.reviewerAssignmentFailed')}
        </div>
      )}

      <section aria-labelledby='progress-heading' class='space-y-3'>
        <h2 id='progress-heading' class='text-xl font-semibold'>
          {i18n.t('imports.batch.progress')}
        </h2>
        <dl class='grid gap-px overflow-hidden rounded-lg border border-base-300 bg-base-300 sm:grid-cols-3 xl:grid-cols-6'>
          <Metric
            label={i18n.t('imports.batch.filesComplete')}
            value={progress.files.analyzed + progress.files.committed}
            i18n={i18n}
          />
          <Metric
            label={i18n.t('imports.batch.assessments')}
            value={i18n.t('imports.batch.assessmentRatio', {
              assigned: progress.assessments.committed,
              total: progress.assessments.total,
            })}
            i18n={i18n}
            preformatted
          />
          <Metric
            label={i18n.t('imports.batch.questions')}
            value={progress.items.total}
            i18n={i18n}
          />
          <Metric
            label={i18n.t('imports.batch.assets')}
            value={progress.assets.recovered}
            i18n={i18n}
          />
          <Metric
            label={i18n.t('imports.batch.pendingReview')}
            value={progress.items.pendingReview}
            i18n={i18n}
          />
          <Metric
            label={i18n.t('imports.batch.blockingFindings')}
            value={progress.blockingFindings.total}
            i18n={i18n}
          />
        </dl>
        <p class='text-sm text-base-content/65' role='status'>
          {i18n.t('imports.batch.progressSummary', {
            queued: progress.files.queued,
            processing: progress.files.processing,
            failed: progress.files.failed,
          })}
        </p>
      </section>

      <section
        class='rounded-lg border border-base-300 bg-base-100 p-5'
        aria-labelledby='reviewer-heading'
      >
        <h2 id='reviewer-heading' class='text-lg font-semibold'>
          {i18n.t('imports.batch.reviewer')}
        </h2>
        <p class='mt-1 text-sm leading-6 text-base-content/65'>
          {i18n.t('imports.batch.reviewerHelp')}
        </p>
        <form method='post' class='mt-4 flex flex-wrap items-end gap-3'>
          <input type='hidden' name='action' value='assign-reviewer' />
          <label class='grid min-w-64 gap-1 text-sm font-medium'>
            {i18n.t('imports.batch.workspaceMember')}
            <Select name='reviewerId' required defaultValue={batch.assignedReviewerId ?? ''}>
              <option value='' disabled>{i18n.t('imports.batch.chooseReviewer')}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName || member.email}
                </option>
              ))}
            </Select>
          </label>
          <Button type='submit' variant='primary'>{i18n.t('imports.batch.assignReviewer')}</Button>
        </form>
      </section>

      <section aria-labelledby='sources-heading' class='space-y-3'>
        <h2 id='sources-heading' class='text-xl font-semibold'>
          {i18n.t('imports.batch.sources')}
        </h2>
        <div class='overflow-x-auto rounded-lg border border-base-300'>
          <table class='w-full text-left text-sm'>
            <thead class='bg-base-200 text-xs uppercase tracking-wide text-base-content/60'>
              <tr>
                <th class='px-4 py-3'>{i18n.t('imports.batch.headerSource')}</th>
                <th class='px-4 py-3'>{i18n.t('imports.batch.headerAnalysis')}</th>
                <th class='px-4 py-3'>{i18n.t('imports.batch.headerQuestions')}</th>
                <th class='px-4 py-3'>{i18n.t('imports.batch.headerApproval')}</th>
                <th class='px-4 py-3'>
                  <span class='sr-only'>{i18n.t('imports.batch.headerOpen')}</span>
                </th>
              </tr>
            </thead>
            <tbody class='divide-y divide-base-300'>
              {batch.runs.map((run) => (
                <tr key={run.id}>
                  <td class='px-4 py-3 font-medium'>{run.sourceFilename}</td>
                  <td class='px-4 py-3'>{runStatusLabel(run.execution, i18n)}</td>
                  <td class='px-4 py-3'>{i18n.formatNumber(run.summary.counts.items)}</td>
                  <td class='px-4 py-3'>{approvalStatusLabel(run.approval, i18n)}</td>
                  <td class='px-4 py-3 text-right'>
                    <Button size='sm' variant='ghost' href={`/imports/${run.id}`}>
                      {i18n.t('imports.batch.open')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  i18n,
  preformatted = false,
}: { label: string; value: number | string; i18n: I18n; preformatted?: boolean }) {
  return (
    <div class='bg-base-100 px-4 py-3'>
      <dt class='text-xs uppercase tracking-wide text-base-content/55'>{label}</dt>
      <dd class='mt-1 text-2xl font-semibold'>
        {preformatted || typeof value === 'string' ? value : i18n.formatNumber(value)}
      </dd>
    </div>
  );
}

function batchStatusLabel(status: MigrationBatchRecord['status'], i18n: I18n): string {
  switch (status) {
    case 'queued':
      return i18n.t('imports.batch.queued');
    case 'processing':
      return i18n.t('imports.batch.processing');
    case 'review':
      return i18n.t('imports.batch.review');
    case 'approval':
      return i18n.t('imports.batch.approval');
    case 'completed':
      return i18n.t('imports.batch.completed');
    case 'failed':
      return i18n.t('imports.batch.failed');
    default:
      return i18n.t('imports.batch.failed');
  }
}

function runStatusLabel(state: MigrationExecutionState, i18n: I18n): string {
  switch (state._tag) {
    case 'Queued':
      return i18n.t('imports.batch.runQueued');
    case 'Analyzing':
      return i18n.t('imports.batch.runProcessing');
    case 'Analyzed':
      return i18n.t('imports.batch.runReady');
    case 'Committed':
      return i18n.t('imports.batch.runCommitted');
    case 'Failed':
      return i18n.t('imports.batch.runFailed');
    default:
      return i18n.t('imports.batch.runFailed');
  }
}

function approvalStatusLabel(state: MigrationApprovalState, i18n: I18n): string {
  switch (state._tag) {
    case 'Draft':
      return i18n.t('imports.batch.approvalDraft');
    case 'Submitted':
      return i18n.t('imports.batch.approvalSubmitted');
    case 'Approved':
      return i18n.t('imports.batch.approvalApproved');
    case 'ChangesRequested':
      return i18n.t('imports.batch.approvalChanges');
    default:
      return i18n.t('imports.batch.approvalChanges');
  }
}

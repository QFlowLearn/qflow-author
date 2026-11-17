import Button from '../ui/Button.tsx';
import Checkbox from '../ui/Checkbox.tsx';
import type { MigrationRunRecord } from '../../lib/import/migration_types.ts';
import { migrationCommittedHref } from '../../lib/import/migration_destination.ts';
import type { I18n } from '../../lib/i18n/messages.ts';

export function MigrationCommitPanel({ run, readOnly, commitProgress, i18n }: {
  run: MigrationRunRecord;
  readOnly: boolean;
  commitProgress?: { state: string; completed: number; total: number };
  i18n: I18n;
}) {
  const accepted = run.items.filter((item) => item.decision === 'accepted');
  const bankCommit = run.destination._tag === 'WorkspaceBank';
  const selectionCount = bankCommit ? run.reviewProgress.accepted : accepted.length;
  return (
    <>
      {!readOnly && (!commitProgress || commitProgress.state === 'failed') &&
        run.execution._tag !== 'Committed' && run.reviewProgress.total > 0 &&
        (run.purpose === 'generate_new' || run.approval._tag === 'Approved') && (
        <section
          class='rounded-lg border border-base-300 bg-base-100 p-5'
          aria-labelledby='commit-heading'
        >
          <h2 id='commit-heading' class='text-lg font-semibold'>
            {i18n.t('imports.report.commitHeading')}
          </h2>
          <p class='mt-1 text-sm leading-6 text-base-content/65'>
            {i18n.t('imports.report.commitHelp')}
          </p>
          <form method='post' class='mt-4 space-y-4'>
            <input type='hidden' name='action' value='commit' />
            {bankCommit && <input type='hidden' name='commitSelection' value='all-accepted' />}
            <div class='grid gap-2 sm:grid-cols-2'>
              {!bankCommit &&
                accepted.map((item) => (
                  <label
                    key={item.id}
                    class='flex min-h-12 items-center gap-3 rounded-md border border-base-300 px-3'
                  >
                    <Checkbox name='approvedItemId' value={item.id} checked />
                    <span class='text-sm'>{item.title}</span>
                  </label>
                ))}
            </div>
            {selectionCount === 0 && (
              <p class='text-sm text-warning'>{i18n.t('imports.report.acceptBeforeCommit')}</p>
            )}
            <label class='flex min-h-12 items-center gap-3'>
              <Checkbox name='approval' value='approved' />
              <span class='text-sm font-medium'>
                {i18n.t('imports.report.reviewEvidenceConfirmation')}
              </span>
            </label>
            <Button type='submit' variant='primary' disabled={selectionCount === 0}>
              {i18n.t(
                bankCommit ? 'imports.report.commitAllAccepted' : 'imports.report.commitSelected',
              )}
            </Button>
          </form>
        </section>
      )}

      {commitProgress && commitProgress.state !== 'complete' && (
        <section role='status'>
          <p>
            {i18n.t(
              commitProgress.state === 'failed'
                ? 'imports.report.commitStopped'
                : 'imports.report.commitProgress',
              { completed: commitProgress.completed, total: commitProgress.total },
            )}
          </p>
          <Button variant='ghost' href={`/imports/${run.id}`}>
            {i18n.t('imports.report.refresh')}
          </Button>
          <Button
            variant='ghost'
            href={migrationCommittedHref(
              run.destination._tag === 'WorkspaceBank'
                ? run.destination
                : { _tag: 'WorkspaceBank', collectionId: null },
            )}
          >
            {i18n.t('imports.report.viewBank')}
          </Button>
        </section>
      )}
    </>
  );
}

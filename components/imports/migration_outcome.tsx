import Button from '../ui/Button.tsx';
import ImportStatusPanel from '../ui/ImportStatusPanel.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { MigrationRunRecord } from '../../lib/import/migration_types.ts';

/** Show terminal failures and empty recovery results with actionable, preserved diagnostics. */
export function MigrationOutcome({ run, readOnly, i18n }: {
  readonly run: MigrationRunRecord;
  readonly readOnly: boolean;
  readonly i18n: I18n;
}) {
  const failed = run.execution._tag === 'Failed';
  const empty = run.execution._tag === 'Analyzed' && run.purpose === 'recover_existing' &&
    run.reviewProgress.total === 0;
  if (!failed && !empty) return null;
  const newImport = run.destination._tag === 'Assessment'
    ? `/assessments/new?intent=${run.purpose === 'generate_new' ? 'generate' : 'recover'}`
    : `/imports/new?intent=recover${
      run.destination.collectionId
        ? `&collection=${encodeURIComponent(run.destination.collectionId)}`
        : ''
    }`;
  return (
    <ImportStatusPanel
      tone={failed ? 'error' : 'warning'}
      title={i18n.t(failed ? 'imports.report.failed' : 'imports.report.noQuestions')}
    >
      {run.execution._tag === 'Failed' && <p>{run.execution.failure}</p>}
      <p>{i18n.t(failed ? 'imports.report.failedHelp' : 'imports.report.emptyRecoverHelp')}</p>
      {run.summary.globalWarnings?.filter((warning) =>
        run.execution._tag !== 'Failed' || warning.message !== run.execution.failure
      ).map((warning, index) => <p key={`${warning.code}-${index}`}>{warning.message}</p>)}
      {!readOnly && (
        <form method='post' action={`/imports/${run.id}`}>
          {failed && (
            <Button type='submit' name='action' value='retry' variant='primary'>
              {i18n.t('imports.report.retryImport')}
            </Button>
          )}{' '}
          <Button href={newImport} variant='default'>
            {i18n.t('imports.report.replaceSource')}
          </Button>
        </form>
      )}
    </ImportStatusPanel>
  );
}

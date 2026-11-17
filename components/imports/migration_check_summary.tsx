import Button from '../ui/Button.tsx';
import Disclosure from '../ui/Disclosure.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { MigrationImportChecks } from '../../lib/import/migration_import_checks.ts';
import { migrationReviewHref } from '../../lib/import/migration_review_filter.ts';

/** Group recorded source findings without adding another review or approval step. */
export function MigrationCheckSummary({ runId, summary, i18n }: {
  runId: string;
  summary: MigrationImportChecks;
  i18n: I18n;
}) {
  const packageFindings = summary.groups.reduce((total, group) => total + group.packageFindings, 0);
  return (
    <Disclosure
      summary={
        <>
          {i18n.t('imports.checks.title')}
          {' · '}
          {i18n.t('imports.checks.affected', { count: summary.affected })}
          {packageFindings > 0 && (
            <>· {i18n.t('imports.checks.packageFindings', { count: packageFindings })}</>
          )}
        </>
      }
    >
      <p>{i18n.t('imports.checks.scope')}</p>
      {summary.groups.map((group) => (
        <div key={group.kind}>
          <p>
            <strong>{i18n.t(`imports.checks.${group.kind}`)}</strong>
            {': '}
            {i18n.t('imports.checks.questions', { count: group.count })}
          </p>
          {group.packageFindings > 0 && (
            <p>{i18n.t('imports.checks.packageFindings', { count: group.packageFindings })}</p>
          )}
          {group.members.map((member) => (
            <Button
              key={member.id}
              size='sm'
              variant='text'
              href={`${
                migrationReviewHref(runId, Math.ceil(member.position / 50), 'all')
              }#item-${member.id}`}
            >
              {i18n.t('imports.repeats.question', { position: member.position })}
            </Button>
          ))}
          {group.count > group.members.length && (
            <p>{i18n.t('imports.checks.more', { count: group.count - group.members.length })}</p>
          )}
        </div>
      ))}
      {(summary.affected > 0 || packageFindings > 0) && (
        <Button size='sm' variant='text' href={`/imports/${runId}?download=qa-report`}>
          {i18n.t('imports.checks.download')}
        </Button>
      )}
    </Disclosure>
  );
}

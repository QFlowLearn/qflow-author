import Button from '../ui/Button.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { MigrationExactRepeats } from '../../lib/import/migration_exact_repeats.ts';
import { migrationReviewHref } from '../../lib/import/migration_review_filter.ts';

/** Optional exact-repeat findings never block acceptance or remove questions. */
export function MigrationRepeatSummary({ runId, summary, i18n }: {
  runId: string;
  summary: MigrationExactRepeats;
  i18n: I18n;
}) {
  return (
    <details class='rounded-lg border border-base-300 bg-base-100'>
      <summary class='min-h-12 cursor-pointer px-4 py-3 text-sm font-medium'>
        {i18n.t('imports.repeats.title')}
        {' · '}
        {i18n.t('imports.repeats.compared', { compared: summary.compared, total: summary.total })}
        {summary.compared > 0 && (
          <>· {i18n.t('imports.repeats.count', { count: summary.repeats })}</>
        )}
      </summary>
      <div class='space-y-3 border-t border-base-200 p-4 text-sm'>
        <p>{i18n.t('imports.repeats.scope')}</p>
        {summary.groups.length > 0 && (
          <ul class='space-y-3'>
            {summary.groups.map((group) => (
              <li key={group.members[0].id}>
                <p>{i18n.t('imports.repeats.group', { count: group.count })}</p>
                <div class='flex flex-wrap gap-2'>
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
                    <span>
                      {i18n.t('imports.repeats.moreCopies', {
                        count: group.count - group.members.length,
                      })}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {summary.limited && <p>{i18n.t('imports.repeats.limited')}</p>}
        {summary.repeats > 0 && (
          <Button size='sm' variant='text' href={`/imports/${runId}?download=qa-report`}>
            {i18n.t('imports.repeats.download')}
          </Button>
        )}
      </div>
    </details>
  );
}

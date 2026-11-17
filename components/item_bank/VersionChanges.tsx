import type { QuestionVersionChange } from '../../lib/question_version_comparison.ts';
import type { QuestionVersionFieldCategory } from '../../lib/question_version_fields.ts';
import type { I18n } from '../../lib/i18n/messages.ts';

export function VersionChanges(props: {
  readonly comparison: {
    readonly fromRevision: number;
    readonly toRevision: number;
    readonly changes: readonly QuestionVersionChange[];
  };
  readonly i18n: I18n;
}) {
  if (!props.comparison.changes.length) {
    return <p class='text-sm text-base-content/65'>{props.i18n.t('items.detail.sameFields')}</p>;
  }
  return (
    <div class='divide-y divide-base-300'>
      {props.comparison.changes.map((change) => (
        <details key={`${change.category}:${change.field}`} class='py-3'>
          <summary class='cursor-pointer break-words text-sm font-medium'>
            {change.label
              ? props.i18n.t(`items.detail.fieldLabel.${change.label}`)
              : props.i18n.t('items.detail.technicalField', { field: change.field })} ·{' '}
            {props.i18n.t(`items.detail.change.${change.kind}`)}
            {isShortScalar(change.before) && isShortScalar(change.after) && (
              <span class='font-normal'>: {change.before} → {change.after}</span>
            )}
          </summary>
          <p class='mt-2 break-all text-sm'>
            {categoryLabel(props.i18n, change.category)} ·{' '}
            {props.i18n.t('items.detail.technicalField', { field: change.field })}
          </p>
          <div class='mt-3 grid min-w-0 gap-4 md:grid-cols-2'>
            <div class='min-w-0'>
              <h4 class='mb-2 text-sm font-medium'>
                {props.i18n.t('items.detail.revisionColumn', {
                  revision: props.comparison.fromRevision,
                })}
              </h4>
              <pre
                class='max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-base-300 p-3 text-xs'
                tabIndex={0}
              >{change.before}</pre>
            </div>
            <div class='min-w-0'>
              <h4 class='mb-2 text-sm font-medium'>
                {props.i18n.t('items.detail.revisionColumn', {
                  revision: props.comparison.toRevision,
                })}
              </h4>
              <pre
                class='max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-base-300 p-3 text-xs'
                tabIndex={0}
              >{change.after}</pre>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

function categoryLabel(i18n: I18n, category: QuestionVersionFieldCategory): string {
  const ids: Record<QuestionVersionFieldCategory, string> = {
    content: 'items.detail.categoryContent',
    answer_and_scoring: 'items.detail.categoryAnswerScoring',
    standards_and_accessibility: 'items.detail.categoryStandardsAccessibility',
    details: 'items.detail.categoryDetails',
  };
  return i18n.t(ids[category]);
}

function isShortScalar(value: string): boolean {
  return value.length <= 64 && !value.startsWith('{') && !value.startsWith('[');
}

import { assessmentQuestionAnchor } from '../../lib/assessment_content.ts';
import InsertionMenu from '../../components/ui/InsertionMenu.tsx';
import SafeHtml from '../../components/ui/SafeHtml.tsx';
import type { ItemMeta, QuestionPlacement } from './types.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { ComponentChildren } from 'preact';

type Props = {
  onInsertBefore?: () => void;
  onInsertAfter?: () => void;
  insertionDisabled?: boolean;
  itemNumber: string;
  placement: QuestionPlacement;
  partId: string;
  meta: ItemMeta | undefined;
  onEditItem: (itemId: string, placementId: string, partId: string) => void;
  moveTools?: ComponentChildren;
};

/** Renders a collapsed question card that keeps assessment content visible between edits. */
export default function AssessmentQuestionPreview({
  onInsertBefore,
  onInsertAfter,
  insertionDisabled = false,
  itemNumber,
  placement,
  partId,
  meta,
  onEditItem,
  moveTools,
}: Props) {
  const i18n = useI18n();
  const preview = meta?.preview;
  const bodyHtml = preview?.bodyHtml;
  const promptHtml = preview?.promptHtml;
  const choices = preview?.choices?.filter((choice) => choice.text.length > 0) ?? [];
  const title = meta?.title ?? i18n.t('assessments.builder.untitledQuestion');

  return (
    <article
      id={assessmentQuestionAnchor(placement.id)}
      tabIndex={-1}
      style={{ scrollMarginTop: '5rem' }}
      data-authoring-card={placement.itemId}
      class='relative rounded-xl border border-base-200 bg-base-100 p-4 transition-colors hover:border-base-300 sm:p-5'
    >
      <div class='flex items-center gap-3 pr-10'>
        {/* The edit target covers the card while the preview remains separate readable content. */}
        <button
          type='button'
          class='flex min-w-0 flex-1 cursor-pointer items-center gap-3 p-0 text-left font-normal after:absolute after:inset-0 after:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary'
          onClick={() => onEditItem(placement.itemId, placement.id, partId)}
          aria-label={i18n.t('assessments.builder.editQuestion', {
            number: itemNumber,
            title,
          })}
        >
          <span class='grid size-8 shrink-0 place-items-center rounded-md bg-base-200 text-xs font-semibold text-base-content/75'>
            {itemNumber}
          </span>{' '}
          <span class='min-w-0 flex-1 truncate font-medium text-base-content'>{title}</span>
        </button>
        <span class='ds-badge ds-badge-ghost ds-badge-sm shrink-0'>
          {meta?.questionTypeId
            ? i18n.t('assessments.builder.questionTypeLabel', { type: meta.questionTypeId })
            : i18n.t('assessments.builder.questionType')}
        </span>
      </div>

      <div class='mt-4 pl-11'>
        {bodyHtml?.trim()
          ? (
            <SafeHtml
              html={bodyHtml}
              class='line-clamp-3 text-sm leading-6 text-base-content/80'
            />
          )
          : promptHtml?.trim()
          ? (
            <SafeHtml
              html={promptHtml}
              class='line-clamp-3 text-sm leading-6 text-base-content/80'
            />
          )
          : (
            <span class='text-sm text-base-content/60'>
              {i18n.t('assessments.builder.openToAdd')}
            </span>
          )}

        {choices.length > 0 && (
          <span class='mt-3 grid gap-2 sm:grid-cols-2'>
            {choices.slice(0, 4).map((choice) => (
              <span
                key={choice.id}
                class='flex min-w-0 items-center gap-2 text-sm text-base-content/70'
              >
                <span class='grid min-h-6 min-w-6 shrink-0 place-items-center whitespace-nowrap rounded-full border border-base-300 px-1.5 text-xs'>
                  {choice.id}
                </span>
                <span class='min-w-0 truncate'>{choice.text}</span>
              </span>
            ))}
          </span>
        )}
      </div>
      {moveTools}
      {onInsertBefore && onInsertAfter && (
        <InsertionMenu
          label={i18n.t('assessments.builder.questionActions')}
          beforeLabel={i18n.t('assessments.builder.insertBefore')}
          afterLabel={i18n.t('assessments.builder.insertAfter')}
          disabled={insertionDisabled}
          onBefore={onInsertBefore}
          onAfter={onInsertAfter}
        />
      )}
    </article>
  );
}

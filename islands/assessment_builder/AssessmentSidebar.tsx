import { assessmentQuestionPlacements } from '../../lib/assessment_content.ts';
import Button from '../../components/ui/Button.tsx';
import NewAssessmentButton from '../../components/NewAssessmentButton.tsx';
import type { Part } from './types.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

type Props = {
  assessmentId: string;
  parts: Part[];
  collapsed: Record<string, boolean>;
  recent: readonly { readonly id: string; readonly title: string }[];
  onTogglePart: (partId: string) => void;
};

/** Compact navigation rail for parts, recent assessments, and arrangement. */
export default function AssessmentSidebar({
  assessmentId,
  parts,
  collapsed,
  recent,
  onTogglePart,
}: Props) {
  const i18n = useI18n();
  const questionCount = parts.reduce(
    (total, part) => total + assessmentQuestionPlacements(part.placements).length,
    0,
  );

  return (
    <aside class='flex min-w-0 flex-col gap-2 pt-0 mt-0'>
      <div class='builder-list ds-card ds-card-border space-y-2 rounded-[10px] border-base-200/70 bg-base-100 p-3 shadow-none sm:p-4'>
        <p class='text-sm font-medium text-base-content'>
          {i18n.t('assessments.builder.parts')}
        </p>
        {questionCount === 0
          ? (
            <p class='text-sm text-base-content/70'>
              {i18n.t('assessments.builder.emptySidebar')}
            </p>
          )
          : parts.map((part, idx) => (
            <div class='py-1' key={part.id}>
              <button
                type='button'
                class='my-1 flex w-full cursor-pointer items-center gap-2 rounded-md border border-base-200/70 bg-base-200/40 px-2.5 py-2 text-left text-sm font-medium text-base-content/90 transition-colors hover:bg-base-200/60'
                onClick={() => onTogglePart(part.id)}
              >
                <span class='text-base-content/70'>{collapsed[part.id] ? '▸' : '▾'}</span>
                <span class='min-w-0 flex-1 truncate'>
                  {i18n.t('assessments.builder.partHeading', {
                    number: idx + 1,
                    title: part.title,
                  })}
                </span>
                <span class='text-xs font-medium text-base-content/70'>
                  {i18n.formatNumber(assessmentQuestionPlacements(part.placements).length)}
                </span>
              </button>
              {!collapsed[part.id] && (
                <p class='px-2 text-xs leading-5 text-base-content/60'>
                  {i18n.t('assessments.builder.partHelp')}
                </p>
              )}
            </div>
          ))}
      </div>
      {recent.length > 0 && (
        <div class='ds-card ds-card-border mt-2 space-y-2 rounded-[10px] border-base-200/70 bg-base-100 p-3 shadow-none sm:p-4'>
          <div class='mb-1 text-sm font-medium text-base-content/70'>
            {i18n.t('assessments.builder.recentAssessments')}
          </div>
          {recent.map((entry) => (
            <div
              key={entry.id}
              class='group flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-base-200/50'
              onClick={() => (location.href = `/assessments/${entry.id}`)}
            >
              <div class='min-w-0 flex-1'>
                <div class='truncate text-[13px] font-medium'>{entry.title}</div>
              </div>
              <Button size='sm' href={`/assessments/${entry.id}`}>
                {i18n.t('assessments.builder.open')}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div class='space-y-2 pt-1'>
        <Button class='w-full justify-center' href={`/assessments/${assessmentId}/arrange`}>
          {i18n.t('assessments.builder.arrange')}
        </Button>
        <div class='px-1 text-xs leading-5 text-base-content/65'>
          {i18n.t('assessments.builder.arrangeHelp')}
        </div>
        <NewAssessmentButton buttonClass='w-full justify-center'>
          {i18n.t('assessments.builder.newAssessment')}
        </NewAssessmentButton>
      </div>
    </aside>
  );
}

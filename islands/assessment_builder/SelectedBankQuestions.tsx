import { useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import BankQuestionPreview, { type BankPreviewContext } from './BankQuestionPreview.tsx';
import type { SelectedBankQuestion } from '../../lib/assessment_bank_selection.ts';
import type { useBankProposals } from './useBankProposals.ts';

/** The accepted proposal remains inspectable even after its original bank filters change. */
export default function SelectedBankQuestions(props: {
  readonly selected: readonly SelectedBankQuestion[];
  readonly busy: boolean;
  readonly onRemove: (itemId: string) => void;
  readonly proposals: ReturnType<typeof useBankProposals>;
  readonly previewContext: BankPreviewContext;
}) {
  const i18n = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!props.selected.length) return null;
  return (
    <details
      class='border-y border-base-300'
      open={props.selected.some((item) => item.source.kind === 'proposed')}
      data-selected-questions
    >
      <summary class='min-h-11 cursor-pointer py-3 text-sm font-medium'>
        {i18n.t('assessments.builder.library.selected', { count: props.selected.length })}
      </summary>
      <ul class='divide-y divide-base-300'>
        {props.selected.map((item) => {
          const { question, source } = item, open = expanded === question.id;
          const title = question.excerpt || question.title ||
            i18n.t('assessments.builder.untitledItem');
          const action = props.proposals.action;
          const targeted = action.kind !== 'idle' && action.change.kind === 'replace' &&
            action.change.itemId === question.id;
          const replacing = targeted && action.kind === 'pending';
          const failure = targeted && action.kind === 'rejected' ? action.reason : null;
          return (
            <li key={item.placementId} class='space-y-2 py-3' data-selected-question={question.id}>
              <Button
                type='button'
                variant='text'
                class='h-auto min-h-11 whitespace-normal break-words text-left'
                aria-expanded={open}
                aria-controls={`selected-preview-${question.id}`}
                onClick={() => setExpanded(open ? null : question.id)}
              >
                {title}
              </Button>
              <div class='flex flex-wrap items-center justify-between gap-2'>
                <p class='text-xs text-base-content/80'>
                  {source.kind === 'proposed'
                    ? i18n.t('assessments.builder.proposal.suggested', {
                      category: source.categoryLabel,
                      audience: source.audience,
                    })
                    : i18n.t('assessments.builder.proposal.manual')}
                </p>
                <div class='flex gap-2'>
                  <Button
                    size='sm'
                    variant='text'
                    type='button'
                    aria-expanded={open}
                    aria-controls={`selected-preview-${question.id}`}
                    onClick={() => setExpanded(open ? null : question.id)}
                  >
                    {i18n.t(
                      open
                        ? 'assessments.builder.library.hidePreview'
                        : 'assessments.builder.library.preview',
                    )}
                  </Button>
                  {source.kind === 'proposed' && (
                    <Button
                      size='sm'
                      variant='text'
                      type='button'
                      disabled={props.busy}
                      onClick={() => void props.proposals.replace(item)}
                    >
                      {i18n.t(
                        replacing
                          ? 'assessments.builder.proposal.replacing'
                          : 'assessments.builder.proposal.replace',
                      )}
                    </Button>
                  )}
                  <Button
                    size='sm'
                    variant='text'
                    type='button'
                    disabled={props.busy}
                    onClick={() => props.onRemove(question.id)}
                    aria-label={i18n.t('assessments.builder.library.removeQuestion', { title })}
                  >
                    {i18n.t('assessments.builder.library.remove')}
                  </Button>
                </div>
              </div>
              {failure && (
                <p role='alert' class='text-sm text-error'>
                  {i18n.t(
                    failure === 'shortfall'
                      ? 'assessments.builder.proposal.noReplacement'
                      : 'assessments.builder.proposal.error.failed',
                  )}
                </p>
              )}
              <div id={`selected-preview-${question.id}`} hidden={!open}>
                {open && (
                  <BankQuestionPreview
                    itemId={question.id}
                    revision={question.latestRev}
                    {...props.previewContext}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

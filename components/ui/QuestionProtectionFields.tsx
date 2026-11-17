import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import Checkbox from './Checkbox.tsx';

/** Assessment-local positions, independent of the underlying question's saved content. */
export type QuestionProtectionField = {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly fixed: boolean;
};

/** Edit protected positions through the caller's existing arrangement draft and save ownership. */
export default function QuestionProtectionFields(props: {
  readonly questions: readonly QuestionProtectionField[];
  readonly onChange: (placementId: string, fixed: boolean) => void;
}) {
  const i18n = useI18n(), id = useDomId();
  const [open, setOpen] = useState(false);
  if (props.questions.length === 0) return null;
  return (
    <details class='space-y-3' onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary class='min-h-12 cursor-pointer rounded px-2 py-3 hover:bg-base-200/60'>
        <strong>{i18n.t('assessments.partSettings.fixedQuestions')}</strong>{' '}
        <span class='text-sm text-base-content/70'>
          {i18n.t('assessments.partSettings.fixedQuestionCount', {
            count: props.questions.filter((question) => question.fixed).length,
          })}
        </span>
      </summary>
      {open && (
        <>
          <p id={`${id}-help`} class='text-sm text-base-content/70'>
            {i18n.t('assessments.partSettings.fixedQuestionHelp')}
          </p>
          <fieldset class='space-y-1' aria-describedby={`${id}-help`}>
            <legend class='sr-only'>{i18n.t('assessments.partSettings.fixedQuestions')}</legend>
            {props.questions.map((question) => (
              <label
                key={question.id}
                for={`${id}-${question.id}`}
                class='flex min-h-12 items-start gap-3 rounded px-2 py-3 hover:bg-base-200/40'
              >
                <Checkbox
                  id={`${id}-${question.id}`}
                  checked={question.fixed}
                  aria-describedby={`${id}-help`}
                  onChange={(event) => props.onChange(question.id, event.currentTarget.checked)}
                />
                <span class='min-w-0 break-words'>
                  <span class='block'>
                    {i18n.t('assessments.partSettings.keepQuestionFixed', {
                      number: question.number,
                    })}
                  </span>
                  <span class='block text-sm text-base-content/70'>{question.title}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </>
      )}
    </details>
  );
}

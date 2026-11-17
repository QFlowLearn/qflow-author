import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import {
  parsePartSettingsDraft,
  type PartSettingsDraft,
} from '../../lib/assessment_part_settings_draft.ts';
import Input, { FieldIssueMessage } from './Input.tsx';
import Select from './Select.tsx';
import Textarea from './Textarea.tsx';
import Checkbox from './Checkbox.tsx';

/** One controlled part form, shared by Arrange and assessment settings. */
export default function PartSettingsFields(props: {
  readonly draft: PartSettingsDraft;
  readonly onChange: (draft: PartSettingsDraft) => void;
}) {
  const i18n = useI18n(), id = useDomId();
  const { draft, onChange } = props;
  const parsed = parsePartSettingsDraft(draft);
  const [timeTouched, setTimeTouched] = useState(() => !parsed.ok);
  // Revealing an error on blur must not move a native pointer target during its activation.
  const pendingTimeIssue = !parsed.ok && parsed.issue !== 'options' ? parsed.issue : null;
  const timeIssue = timeTouched ? pendingTimeIssue : null;
  function changeFeedback(field: 'outcomeIdentifier' | 'html', value: string) {
    const first = draft.feedback?.[0] ?? {
      id: crypto.randomUUID(),
      access: 'atEnd' as const,
      showHide: 'show' as const,
      outcomeIdentifier: '',
      html: '',
    };
    onChange({
      ...draft,
      feedback: [{ ...first, [field]: value }, ...(draft.feedback?.slice(1) ?? [])],
    });
  }
  return (
    <div class='space-y-4'>
      <div class='space-y-2'>
        <label class='flex min-h-12 items-center gap-3' for={`${id}-question-shuffle`}>
          <Checkbox
            id={`${id}-question-shuffle`}
            checked={draft.shuffleQuestions === true}
            aria-describedby={`${id}-question-shuffle-help`}
            onChange={(event) =>
              onChange({ ...draft, shuffleQuestions: event.currentTarget.checked })}
          />
          <span>{i18n.t('assessments.partSettings.shuffleQuestions')}</span>
        </label>
        <p id={`${id}-question-shuffle-help`} class='text-sm text-base-content/70'>
          {i18n.t('assessments.partSettings.questionOrderHelp')}
        </p>
      </div>
      <div class='grid gap-3 sm:grid-cols-2'>
        <label class='ds-form-control'>
          <span id={`${id}-navigation`}>{i18n.t('assessments.arrange.modal.navigation')}</span>
          <Select
            aria-labelledby={`${id}-navigation`}
            data-modal-initial-focus='part-settings'
            value={draft.navigationMode ?? 'nonlinear'}
            onInput={(event) => {
              const value = event.currentTarget.value;
              if (value === 'linear' || value === 'nonlinear') {
                onChange({
                  ...draft,
                  navigationMode: value,
                });
              }
            }}
          >
            <option value='linear'>{i18n.t('assessments.arrange.modal.linear')}</option>
            <option value='nonlinear'>{i18n.t('assessments.arrange.modal.nonlinear')}</option>
          </Select>
        </label>
        <label class='ds-form-control'>
          <span id={`${id}-submission`}>{i18n.t('assessments.arrange.modal.submission')}</span>
          <Select
            aria-labelledby={`${id}-submission`}
            value={draft.submissionMode ?? 'individual'}
            onInput={(event) => {
              const value = event.currentTarget.value;
              if (value === 'individual' || value === 'simultaneous') {
                onChange({
                  ...draft,
                  submissionMode: value,
                });
              }
            }}
          >
            <option value='individual'>{i18n.t('assessments.arrange.modal.individual')}</option>
            <option value='simultaneous'>{i18n.t('assessments.arrange.modal.simultaneous')}</option>
          </Select>
        </label>
        {(['minTime', 'maxTime'] as const).map((field) => (
          <label class='ds-form-control' key={field}>
            <span id={`${id}-${field}-label`}>{i18n.t(`assessments.arrange.modal.${field}`)}</span>
            <Input
              type='text'
              inputMode='numeric'
              pattern='[0-9]*'
              onBlur={() =>
                setTimeTouched(true)}
              aria-labelledby={`${id}-${field}-label`}
              aria-invalid={timeIssue ? true : undefined}
              aria-describedby={timeIssue ? `${id}-time-issue` : undefined}
              value={draft.timeLimits?.[field] ?? ''}
              onInput={(event) =>
                onChange({
                  ...draft,
                  timeLimits: {
                    minTime: draft.timeLimits?.minTime ?? '',
                    maxTime: draft.timeLimits?.maxTime ?? '',
                    [field]: event.currentTarget.value,
                  },
                })}
            />
          </label>
        ))}
      </div>
      {pendingTimeIssue && (
        <FieldIssueMessage
          id={`${id}-time-issue`}
          message={i18n.t(`assessments.partSettings.${pendingTimeIssue}`)}
          visible={timeTouched}
        />
      )}
      <label class='ds-form-control gap-2'>
        <span id={`${id}-answer-feedback-label`}>
          {i18n.t('assessments.partSettings.answerFeedbackRelease')}
        </span>
        <Select
          aria-labelledby={`${id}-answer-feedback-label`}
          aria-describedby={`${id}-answer-feedback-help`}
          value={draft.answerFeedbackRelease ?? ''}
          onInput={(event) => {
            const value = event.currentTarget.value;
            if (value === 'after-submit' || value === 'never') {
              onChange({
                ...draft,
                answerFeedbackRelease: value,
              });
            } else {
              const { answerFeedbackRelease: _removed, ...rest } = draft;
              onChange(rest);
            }
          }}
        >
          <option value=''>{i18n.t('assessments.partSettings.feedbackChoose')}</option>
          <option value='after-submit'>
            {i18n.t('assessments.partSettings.feedbackAfterSubmit')}
          </option>
          <option value='never'>{i18n.t('assessments.partSettings.feedbackNever')}</option>
        </Select>
        <span id={`${id}-answer-feedback-help`} class='text-sm text-base-content/70'>
          {i18n.t('assessments.partSettings.feedbackHelp')}
        </span>
      </label>
      <label class='ds-form-control'>
        <span id={`${id}-instructions`}>{i18n.t('assessments.arrange.modal.instructions')}</span>
        <Textarea
          aria-labelledby={`${id}-instructions`}
          rows={3}
          maxLength={100000}
          value={draft.instructionsHtml ?? ''}
          onInput={(event) => onChange({ ...draft, instructionsHtml: event.currentTarget.value })}
        />
      </label>
      <details class='space-y-3'>
        <summary class='cursor-pointer rounded px-2 py-1 hover:bg-base-200/60'>
          <strong>{i18n.t('assessments.arrange.modal.feedback')}</strong>{' '}
          <span class='text-xs text-base-content/70'>
            {i18n.t('assessments.arrange.modal.simpleBlock')}
          </span>
        </summary>
        <label class='ds-form-control'>
          <span id={`${id}-outcome`}>{i18n.t('assessments.arrange.modal.outcome')}</span>
          <Input
            aria-labelledby={`${id}-outcome`}
            maxLength={128}
            value={draft.feedback?.[0]?.outcomeIdentifier ?? ''}
            onInput={(event) => changeFeedback('outcomeIdentifier', event.currentTarget.value)}
          />
        </label>
        <label class='ds-form-control'>
          <span id={`${id}-feedback`}>{i18n.t('assessments.arrange.modal.feedbackHtml')}</span>
          <Textarea
            aria-labelledby={`${id}-feedback`}
            rows={3}
            maxLength={100000}
            value={draft.feedback?.[0]?.html ?? ''}
            onInput={(event) => changeFeedback('html', event.currentTarget.value)}
          />
        </label>
      </details>
      {!parsed.ok && parsed.issue === 'options' && (
        <FieldIssueMessage
          id={`${id}-options-issue`}
          message={i18n.t('assessments.partSettings.options')}
        />
      )}
    </div>
  );
}

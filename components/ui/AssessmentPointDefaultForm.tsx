import { reportUiError, uiEvent } from '../../lib/client/ui_event.ts';
import { useDomId } from '../../lib/rendering/island_context.tsx';

import Button from './Button.tsx';
import Input, { FieldIssueMessage } from './Input.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { useAssessmentPointDefault } from '../assessment_builder/useAssessmentPointDefault.ts';

/** One independently saved authoring default with a labelled, recoverable raw decimal field. */
export default function AssessmentPointDefaultForm(props: {
  readonly assessmentId: string;
  readonly edit: ReturnType<typeof useAssessmentPointDefault>;
}) {
  const i18n = useI18n(), id = useDomId();
  const { edit } = props;
  const failed = edit.status === 'Uncertain' || edit.status === 'Conflict' ||
    edit.status === 'Rejected' || edit.status === 'RefreshFailed';
  return (
    <form
      action={`/api/assessments/${props.assessmentId}/question-defaults`}
      method='post'
      class='space-y-3'
      onSubmit={(event) => {
        event.preventDefault();
        if (edit.inputInvalid && edit.status !== 'Uncertain') {
          edit.blur();
          const field = event.currentTarget.elements.namedItem('maximumScore');
          if (field instanceof HTMLElement) field.focus();
          return;
        }
        edit.save().catch(reportUiError);
      }}
    >
      <label for={`${id}-points`} class='block font-medium'>
        {i18n.t('assessments.questionDefaults.points')}
      </label>
      <Input
        id={`${id}-points`}
        name='maximumScore'
        type='text'
        inputMode='decimal'
        autoComplete='off'
        spellcheck={false}
        value={edit.text}
        aria-invalid={edit.invalid || undefined}
        aria-describedby={`${id}-help${edit.invalid ? ` ${id}-issue` : ''}`}
        onInput={(event) => edit.change(event.currentTarget.value)}
        onBlur={edit.blur}
      />
      <p id={`${id}-help`} class='text-sm leading-5 text-base-content/75'>
        {i18n.t('assessments.questionDefaults.help')}
      </p>
      {edit.invalid && (
        <FieldIssueMessage
          id={`${id}-issue`}
          message={i18n.t('assessments.questionDefaults.invalid')}
        />
      )}
      <p role='status' aria-atomic='true' class='text-sm'>
        {edit.status === 'Saving'
          ? i18n.t('assessments.arrange.saving')
          : edit.status === 'Refreshing'
          ? i18n.t('assessments.questionDefaults.refreshing')
          : edit.dirty
          ? i18n.t('assessments.questionDefaults.unsaved')
          : edit.status === 'Saved'
          ? i18n.t('assessments.questionDefaults.saved')
          : ''}
      </p>
      {failed && (
        <div role='alert' class='space-y-2 text-sm'>
          <p>{i18n.t(`assessments.questionDefaults.${edit.status}`)}</p>
          {edit.status !== 'Uncertain' && (
            <Button type='button' onClick={uiEvent(edit.refresh)} disabled={edit.busy}>
              {i18n.t('assessments.questionDefaults.refresh')}
            </Button>
          )}
        </div>
      )}
      <Button type='submit' variant='primary' disabled={!edit.canSave}>
        {i18n.t(
          edit.status === 'Uncertain'
            ? 'assessments.questionDefaults.retry'
            : 'assessments.questionDefaults.save',
        )}
      </Button>
    </form>
  );
}

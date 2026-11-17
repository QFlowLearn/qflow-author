import type { AssessmentQuestionPointDefault } from '../../lib/assessment_question_defaults.ts';
import Checkbox from '../../components/ui/Checkbox.tsx';
import Button from '../../components/ui/Button.tsx';
import WorkspaceDefaultNotice from '../../components/ui/WorkspaceDefaultNotice.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import { useItemEditorState } from '../item_editor/context.ts';
import {
  type InstructorDefaults,
  supportsInstructorAnswerOrder,
  supportsInstructorQuestionPoints,
} from '../../lib/instructor_defaults.ts';
import { questionPointsInputText } from '../../lib/question_points.ts';
import type { QuestionTypeId } from '../../lib/types/registry.ts';

/** Remember controls affect future questions only; the open draft remains unchanged. */
export default function AuthoringPreferenceControls(
  {
    remember,
    onRememberChange,
    resetState,
    onReset,
    instructorDefaults,
    assessmentQuestionPointDefault,
    questionType,
  }: {
    readonly remember: boolean;
    readonly onRememberChange: (value: boolean) => void;
    readonly resetState: 'idle' | 'resetting' | 'saved' | 'failed';
    readonly onReset: () => Promise<void>;
    readonly instructorDefaults: InstructorDefaults;
    readonly assessmentQuestionPointDefault: AssessmentQuestionPointDefault;
    readonly questionType: QuestionTypeId;
  },
) {
  const { t, locale } = useI18n();
  const { persistence, content } = useItemEditorState();
  const disabled = persistence.saveStatus === 'saving' || resetState === 'resetting';
  return (
    <fieldset disabled={disabled} class='space-y-2'>
      <label class='flex items-start gap-2'>
        <Checkbox
          checked={remember}
          onChange={(event) => onRememberChange(event.currentTarget.checked)}
          aria-describedby='remember-authoring-help'
        />
        <span>{t('assessments.builder.rememberSettings')}</span>
      </label>
      <p id='remember-authoring-help' class='text-sm text-base-content/70'>
        {t('assessments.builder.rememberSettingsHelp')}
      </p>
      {instructorDefaults && instructorDefaults.answerChoiceOrder !== null &&
        supportsInstructorAnswerOrder(questionType) && (
        <WorkspaceDefaultNotice
          text={t(
            instructorDefaults.answerChoiceOrder === 'shuffled'
              ? 'assessments.builder.workspaceDefaultShuffled'
              : 'assessments.builder.workspaceDefaultAuthored',
          )}
        />
      )}
      {assessmentQuestionPointDefault !== null && supportsInstructorQuestionPoints(questionType) &&
        (
          <WorkspaceDefaultNotice
            text={t('assessments.builder.assessmentDefaultPoints', {
              points: questionPointsInputText(assessmentQuestionPointDefault, locale),
            })}
          />
        )}
      {assessmentQuestionPointDefault !== null && supportsInstructorQuestionPoints(questionType) &&
        !content.points.readOnly && !content.points.invalid &&
        content.draft.maximumScore !== assessmentQuestionPointDefault && (
        <WorkspaceDefaultNotice
          text={content.draft.maximumScore === undefined
            ? t('assessments.builder.questionTypePointsOverride')
            : t('assessments.builder.questionPointsOverride', {
              points: questionPointsInputText(content.draft.maximumScore, locale),
            })}
        />
      )}
      {assessmentQuestionPointDefault === null && instructorDefaults &&
        instructorDefaults.maximumScore !== null &&
        supportsInstructorQuestionPoints(questionType) && (
        <WorkspaceDefaultNotice
          text={t('assessments.builder.workspaceDefaultPoints', {
            points: questionPointsInputText(instructorDefaults.maximumScore, locale),
          })}
        />
      )}
      <Button variant='text' size='sm' href='/settings/editor'>
        {t('assessments.builder.editInstructorDefaults')}
      </Button>
      <Button type='button' variant='ghost' size='sm' onClick={onReset}>
        {t('assessments.builder.resetRememberedSettings')}
      </Button>
      {resetState === 'saved' && (
        <p role='status'>{t('assessments.builder.rememberedSettingsReset')}</p>
      )}
      {resetState === 'failed' && (
        <p role='alert'>{t('assessments.builder.rememberedSettingsResetFailed')}</p>
      )}
    </fieldset>
  );
}

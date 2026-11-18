import { uiEvent } from '../../lib/client/ui_event.ts';
import { assessmentQuestionPlacements } from '../../lib/assessment_content.ts';
import Button from '../../components/ui/Button.tsx';
import SettingsDisclosure from '../../components/ui/SettingsDisclosure.tsx';
import QuestionOrderPreviewList from '../../components/ui/QuestionOrderPreviewList.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import { useQuestionOrderPreview } from './useQuestionOrderPreview.ts';

/** A saved-policy example is requested explicitly and never previews unsaved settings. */
export default function AssessmentQuestionOrderPreview(
  props: Parameters<typeof useQuestionOrderPreview>[0],
) {
  const i18n = useI18n();
  const preview = useQuestionOrderPreview(props);
  const empty = props.parts.every((part) =>
    assessmentQuestionPlacements(part.placements).length === 0
  );
  const state = preview.state;
  return (
    <SettingsDisclosure
      title={i18n.t('assessments.orderPreview.title')}
      summary={i18n.t('assessments.orderPreview.help')}
    >
      <Button
        type='button'
        disabled={props.blocked || empty || preview.busy}
        onClick={uiEvent(preview.generate)}
      >
        {i18n.t(
          state.kind === 'ready'
            ? 'assessments.orderPreview.another'
            : state.kind === 'loading'
            ? 'assessments.orderPreview.loading'
            : 'assessments.orderPreview.show',
        )}
      </Button>
      {props.blocked && <p>{i18n.t('assessments.orderPreview.saveFirst')}</p>}
      {empty && <p>{i18n.t('assessments.orderPreview.empty')}</p>}
      <p role='status' aria-atomic='true'>
        {state.kind === 'ready'
          ? i18n.t('assessments.orderPreview.ready')
          : state.kind === 'failed'
          ? i18n.t(`assessments.orderPreview.${state.reason}`)
          : ''}
      </p>
      {state.kind === 'ready' && <QuestionOrderPreviewList value={state.value} />}
    </SettingsDisclosure>
  );
}

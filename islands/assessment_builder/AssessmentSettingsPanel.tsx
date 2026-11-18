import { uiEvent } from '../../lib/client/ui_event.ts';
import { assessmentQuestionPlacements } from '../../lib/assessment_content.ts';
import { useLayoutEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import Button from '../../components/ui/Button.tsx';
import Alert from '../../components/ui/Alert.tsx';
import SettingsRail from '../../components/ui/SettingsRail.tsx';
import SettingsDisclosure from '../../components/ui/SettingsDisclosure.tsx';
import PartSettingsFields from '../../components/ui/PartSettingsFields.tsx';
import QuestionProtectionFields from '../../components/ui/QuestionProtectionFields.tsx';
import AssessmentQuestionOrderPreview from './AssessmentQuestionOrderPreview.tsx';
import {
  parsePartSettingsDraft,
  type PartSettingsDraft,
} from '../../lib/assessment_part_settings_draft.ts';
import { ASSESSMENT_TOOL_IDS, assessmentToolHref } from '../../lib/assessment_authoring_tool.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { CapturedAssessmentParts } from '../../components/assessment_builder/useAssessmentParts.ts';
import type { AssessmentView, ItemMeta, Part } from './types.ts';
import { useAssessmentPartSettings } from './useAssessmentPartSettings.ts';
import type { AssessmentQuestionPointDefault } from '../../lib/assessment_question_defaults.ts';
import { useAssessmentPointDefault } from '../../components/assessment_builder/useAssessmentPointDefault.ts';
import AssessmentPointDefaultForm from '../../components/ui/AssessmentPointDefaultForm.tsx';
import { questionPointsInputText } from '../../lib/question_points.ts';

/** Confirmed assessment context and shared write ownership supplied by the builder. */
export type AssessmentSettingsPanelProps = {
  readonly open: boolean;
  readonly assessment: Pick<AssessmentView, 'id' | 'adaptivePlan' | 'delivery'>;
  readonly parts: readonly Part[];
  readonly items: Readonly<Record<string, ItemMeta>>;
  readonly captureOrder: () => CapturedAssessmentParts;
  readonly returnFocusRef: RefObject<HTMLElement>;
  readonly onClose: () => void;
  readonly onBlockedChange: (blocked: boolean) => void;
  readonly guardQuestionDraft: () => Promise<boolean>;
  readonly questionPointDefault: AssessmentQuestionPointDefault;
  readonly onQuestionPointDefaultConfirmed: (value: AssessmentQuestionPointDefault) => void;
};

/** One discoverable part-settings inspector, independent of the selected question. */
export default function AssessmentSettingsPanel(props: AssessmentSettingsPanelProps) {
  const i18n = useI18n();
  const edit = useAssessmentPartSettings({
    assessmentId: props.assessment.id,
    parts: props.parts,
    captureOrder: props.captureOrder,
  });
  const pointEdit = useAssessmentPointDefault({
    assessmentId: props.assessment.id,
    initial: props.questionPointDefault,
    onConfirmed: props.onQuestionPointDefaultConfirmed,
  });
  useLayoutEffect(() => {
    props.onBlockedChange(edit.blocked || pointEdit.blocked);
  }, [edit.blocked, pointEdit.blocked, props.onBlockedChange]);
  async function navigate(url: string) {
    if (edit.status === 'saving' || pointEdit.busy) return;
    if (
      (edit.blocked || pointEdit.blocked) &&
      !globalThis.confirm(i18n.t('assessments.arrange.discardConfirm'))
    ) return;
    if (!await props.guardQuestionDraft()) return;
    edit.allowExit();
    pointEdit.allowExit();
    if (url === globalThis.location.href) globalThis.location.reload();
    else globalThis.location.assign(url);
  }
  const failed = edit.status === 'conflict' || edit.status === 'rejected' ||
    edit.status === 'uncertain';
  return (
    <SettingsRail
      id='assessment-settings-inspector'
      open={props.open}
      title={i18n.t('assessments.settings.title')}
      closeLabel={i18n.t('assessments.settings.close')}
      returnFocusRef={props.returnFocusRef}
      onClose={props.onClose}
      actions={!props.assessment.adaptivePlan && (
        <>
          <p role='status' aria-atomic='true'>
            {edit.status === 'saving'
              ? i18n.t('assessments.arrange.saving')
              : edit.dirty
              ? i18n.t('assessments.settings.unsaved')
              : edit.status === 'saved'
              ? i18n.t('assessments.settings.saved')
              : ''}
          </p>
          <Button
            type='button'
            variant='primary'
            onClick={uiEvent(edit.save)}
            disabled={!edit.dirty || Boolean(edit.invalid) || edit.status === 'saving' ||
              edit.status === 'conflict'}
          >
            {i18n.t('assessments.settings.save')}
          </Button>
        </>
      )}
    >
      <p>{i18n.t('assessments.settings.scope')}</p>
      {!props.assessment.adaptivePlan && (
        <SettingsDisclosure
          title={i18n.t('assessments.questionDefaults.title')}
          summary={pointEdit.confirmed === null
            ? i18n.t('assessments.questionDefaults.personal')
            : i18n.t('assessments.questionDefaults.summary', {
              points: questionPointsInputText(pointEdit.confirmed, i18n.locale),
            })}
        >
          <AssessmentPointDefaultForm assessmentId={props.assessment.id} edit={pointEdit} />
        </SettingsDisclosure>
      )}
      {failed && (
        <Alert tone='neutral' role='alert'>
          <div>
            <p>{i18n.t(`assessments.settings.${edit.status}`)}</p>
            {edit.status === 'uncertain' && (
              <Button type='button' onClick={uiEvent(edit.save)}>
                {i18n.t('assessments.builder.tool.retry')}
              </Button>
            )}
            <Button type='button' onClick={uiEvent(() => navigate(globalThis.location.href))}>
              {i18n.t('assessments.arrange.reloadSaved')}
            </Button>
          </div>
        </Alert>
      )}
      <SettingsDisclosure
        title={i18n.t('assessments.settings.structure')}
        summary={i18n.t(
          props.assessment.adaptivePlan
            ? 'assessments.settings.adaptive'
            : 'assessments.settings.structureSummary',
        )}
      >
        {!props.assessment.adaptivePlan && (
          <Button
            type='button'
            onClick={uiEvent(() => navigate(`/assessments/${props.assessment.id}/arrange`))}
          >
            {i18n.t('assessments.settings.arrange')}
          </Button>
        )}
        <Button
          type='button'
          onClick={uiEvent(() =>
            navigate(assessmentToolHref(props.assessment.id, ASSESSMENT_TOOL_IDS.plan))
          )}
        >
          {i18n.t('assessments.settings.plan')}
        </Button>
      </SettingsDisclosure>
      {props.assessment.adaptivePlan
        ? <p>{i18n.t('assessments.settings.adaptive')}</p>
        : props.parts.map((part, index) => {
          const draft = edit.draftFor(part);
          return (
            <SettingsDisclosure
              key={part.id}
              title={i18n.t('assessments.settings.part', { number: index + 1, title: part.title })}
              summary={partSummary(draft, i18n)}
            >
              <p>{i18n.t('assessments.settings.partScope')}</p>
              <PartSettingsFields draft={draft} onChange={(next) => edit.change(part, next)} />
              <QuestionProtectionFields
                questions={assessmentQuestionPlacements(part.placements).map(
                  (placement, position) => {
                    const item = props.items[placement.id];
                    if (!item) throw new Error('Protected question metadata is missing.');
                    return {
                      id: placement.id,
                      number: `${index + 1}.${position + 1}`,
                      title: item.title,
                      fixed: edit.fixedFor(placement),
                    };
                  },
                )}
                onChange={(id, fixed) => {
                  const placement = part.placements.find((candidate) => candidate.id === id);
                  if (!placement) throw new Error('Protected question placement is missing.');
                  edit.changeFixed(placement, fixed);
                }}
              />
            </SettingsDisclosure>
          );
        })}
      {!props.assessment.adaptivePlan && (
        <AssessmentQuestionOrderPreview
          assessmentId={props.assessment.id}
          parts={props.parts}
          items={props.items}
          blocked={!props.open || edit.blocked || pointEdit.blocked}
          captureOrder={props.captureOrder}
          guardQuestionDraft={props.guardQuestionDraft}
        />
      )}
      <SettingsDisclosure
        title={i18n.t('assessments.settings.delivery')}
        summary={i18n.t(
          props.assessment.delivery
            ? 'assessments.settings.published'
            : 'assessments.settings.unpublished',
        )}
      >
        <p>{i18n.t('assessments.settings.deliveryScope')}</p>
        {props.assessment.delivery?.adminUrl
          ? (
            <>
              <p>
                {i18n.t('assessments.settings.version', {
                  version: props.assessment.delivery.assessmentVersionId,
                })}
              </p>
              <Button href={props.assessment.delivery.adminUrl} target='_blank' rel='noreferrer'>
                {i18n.t('assessments.settings.manageDelivery')}
              </Button>
            </>
          )
          : (
            <>
              <p>
                {i18n.t(
                  props.assessment.delivery
                    ? 'assessments.settings.noHandoff'
                    : 'assessments.settings.publishFirst',
                )}
              </p>
              <Button
                type='button'
                onClick={uiEvent(() =>
                  navigate(assessmentToolHref(props.assessment.id, ASSESSMENT_TOOL_IDS.export))
                )}
              >
                {i18n.t('assessments.settings.publish')}
              </Button>
            </>
          )}
      </SettingsDisclosure>
    </SettingsRail>
  );
}

function partSummary(draft: PartSettingsDraft, i18n: ReturnType<typeof useI18n>): string {
  if (!parsePartSettingsDraft(draft).ok) return i18n.t('assessments.partSettings.options');
  const values = [
    i18n.t(
      draft.shuffleQuestions === true
        ? 'assessments.partSettings.shuffledQuestionOrder'
        : 'assessments.partSettings.authoredQuestionOrder',
    ),
    i18n.t(`assessments.arrange.modal.${draft.navigationMode ?? 'nonlinear'}`),
    i18n.t(`assessments.arrange.modal.${draft.submissionMode ?? 'individual'}`),
    draft.timeLimits?.minTime
      ? i18n.t('assessments.settings.minimum', { seconds: draft.timeLimits.minTime })
      : '',
    draft.timeLimits?.maxTime
      ? i18n.t('assessments.settings.maximum', { seconds: draft.timeLimits.maxTime })
      : i18n.t('assessments.settings.noMaximum'),
    draft.instructionsHtml ? i18n.t('assessments.settings.instructionsSet') : '',
    draft.feedback?.length
      ? i18n.t('assessments.settings.feedbackCount', { count: draft.feedback.length })
      : '',
  ];
  return values.filter(Boolean).join(' · ');
}

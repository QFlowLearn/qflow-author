import type { ComponentChildren } from 'preact';
import Button from './Button.tsx';
import { ASSESSMENT_TOOL_IDS, assessmentToolHref } from '../../lib/assessment_authoring_tool.ts';
import type { AssessmentView } from '../../islands/assessment_builder/types.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import AssessmentPublicationStatus from '../../islands/assessment_builder/AssessmentPublicationStatus.tsx';
import LocalizedTimestamp from '../../islands/LocalizedTimestamp.tsx';
import { useHydrated } from '../../lib/client/use_hydrated.ts';

type Props = {
  readonly assessment: Pick<AssessmentView, 'id' | 'title' | 'delivery' | 'adaptivePlan'>;
  readonly assessmentPlanLabel: string;
  readonly revisionFingerprint?: string;
  readonly onToggleAdd?: () => void;
  readonly onOpenSettings?: (trigger: HTMLElement) => void;
  readonly settingsOpen?: boolean;
  readonly settingsDisabled?: boolean;
  readonly settingsUnsaved?: boolean;
  readonly inspector?: ComponentChildren;
  readonly children?: ComponentChildren;
};

/** Dock assessment settings without covering the mounted authoring canvas. */
export default function AssessmentWorkspace(
  {
    assessment,
    assessmentPlanLabel,
    revisionFingerprint = '',
    onToggleAdd,
    onOpenSettings,
    settingsOpen,
    settingsDisabled,
    settingsUnsaved,
    inspector,
    children,
  }: Props,
) {
  const i18n = useI18n();
  const hydrated = useHydrated();
  return (
    <fieldset
      class='min-w-0 space-y-3'
      disabled={!hydrated}
      aria-busy={!hydrated}
      aria-label={assessment.title}
    >
      <header class='flex flex-wrap items-start justify-between gap-4 border-b border-base-300 pb-5'>
        <div class='min-w-0 flex-1'>
          <h1 class='text-2xl font-semibold break-words'>{assessment.title}</h1>
          <div class='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-base-content/80'>
            {assessment.delivery
              ? (
                <>
                  <span>
                    {Number.isFinite(new Date(assessment.delivery.publishedAt).getTime())
                      ? i18n.rich('list.builder.header.publishedOn', {
                        date: (
                          <LocalizedTimestamp
                            value={assessment.delivery.publishedAt}
                            locale={i18n.locale}
                            showTime={false}
                            dateStyle='numeric'
                          />
                        ),
                      })
                      : i18n.t('list.table.unavailable')}
                  </span>
                  <AssessmentPublicationStatus
                    assessmentId={assessment.id}
                    versionId={assessment.delivery.assessmentVersionId}
                    revisionFingerprint={revisionFingerprint}
                  />
                </>
              )
              : <span>{i18n.t('publication.draft')}</span>}
          </div>
        </div>
        <nav
          class='flex flex-wrap items-center gap-3'
          aria-label={i18n.t('list.builder.header.actions')}
        >
          {onOpenSettings && (
            <Button
              type='button'
              aria-expanded={settingsOpen}
              aria-controls='assessment-settings-panel'
              disabled={settingsDisabled}
              onClick={(event) => onOpenSettings(event.currentTarget)}
            >
              {i18n.t('assessments.settings.title')}
              {settingsUnsaved && ` (${i18n.t('assessments.arrange.unsaved')})`}
            </Button>
          )}
          {onToggleAdd && (
            <Button size='sm' variant='primary' onClick={onToggleAdd}>
              + {i18n.t('list.builder.header.addQuestion')}
            </Button>
          )}
          <Button variant='text' href={assessmentToolHref(assessment.id, ASSESSMENT_TOOL_IDS.plan)}>
            {assessmentPlanLabel}
          </Button>
          <Button
            href={assessment.adaptivePlan
              ? '#assessment-publication'
              : assessmentToolHref(assessment.id, ASSESSMENT_TOOL_IDS.export)}
          >
            {i18n.t('publication.heading')}
          </Button>
          {!assessment.adaptivePlan && assessment.delivery?.previewUrl && (
            <Button href={assessment.delivery.previewUrl} target='_blank' rel='noreferrer'>
              {i18n.t('list.builder.header.launch')}
            </Button>
          )}
          {!assessment.adaptivePlan && assessment.delivery?.adminUrl && (
            <Button href={assessment.delivery.adminUrl} target='_blank' rel='noreferrer'>
              {i18n.t('list.builder.header.manage')}
            </Button>
          )}
        </nav>
      </header>
      <div
        class={settingsOpen ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]' : 'grid'}
      >
        <div
          id='assessment-settings-panel'
          class='order-1 min-w-0 xl:sticky xl:top-24 xl:order-2'
          hidden={!settingsOpen}
        >
          {inspector}
        </div>
        <div class='order-2 min-w-0 space-y-3 xl:order-1'>{children}</div>
      </div>
    </fieldset>
  );
}
